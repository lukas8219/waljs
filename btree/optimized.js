import fs from 'fs';

/*
This is version which has Page cache implemented.
It got 30% faster but much less than I expected it

*/
const PAGE_SIZE = 1024 * 4; 
const MAX_KEYS = 508; // for easier testing, adjust as needed
const HEADER_PAGE = 0;

export class DiskBPlusTree {
  constructor(path) {
    this.path = path;
    this.cache = []
    const exists = fs.existsSync(path);
    this.fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_CREAT);
    if(!exists){
      this.rootPage = 1;
      this.pageCount = 2;
      this._initHeader();
      const buf = this._encodeLeaf([], []);
      this._writePage(this.rootPage, buf);
    } else {
      this._readHeaderMetadata()
    }
  }

  _initHeader() {
    const header = Buffer.allocUnsafe(PAGE_SIZE);
    header.writeUInt32LE(this.rootPage, 0);   // root page
    header.writeUInt32LE(this.pageCount, 4);  // page count
    this._writePage(HEADER_PAGE, header);
  }

  _updateHeader() {
    const header = Buffer.allocUnsafe(PAGE_SIZE);
    header.writeUInt32LE(this.rootPage, 0);
    header.writeUInt32LE(this.pageCount, 4);
    this._writePage(HEADER_PAGE, header);
  }

  _readHeaderMetadata(){
    const headers = Buffer.allocUnsafe(2 * PAGE_SIZE);
    fs.readSync(this.fd, headers, 0, 4)
    fs.readSync(this.fd, headers, 4, 4)
    this.rootPage = headers.readUInt32LE(0, 4)
    this.pageCount = headers.readUInt32LE(4, 4)
  }

  _allocatePage() {
    return this.pageCount++;
  }

  _writePage(pageId, buffer, force=false) {
    if(force){
      fs.writeSync(this.fd, buffer, 0, PAGE_SIZE, pageId * PAGE_SIZE);
      return;
    }
    this.cache[pageId] = { _d: true, buffer }
  }

  flush(){
    if(!this.cache.length){
      return console.log('nothing to flush', this.cache);
    }
    for(const pageId in this.cache){
      const { _d, buffer } = this.cache[pageId] || {}
      if(_d){
        this._writePage(pageId, buffer, true)
      }
    }
  }

  _readPage(pageId) {
    if(this.cache[pageId]){
      return this.cache[pageId].buffer;
    }
    const buffer = Buffer.allocUnsafe(PAGE_SIZE);
    fs.readSync(this.fd, buffer, 0, PAGE_SIZE, pageId * PAGE_SIZE);
    this.cache[pageId] = { _d: false, buffer }
    return buffer;
  }

  _encodeLeaf(keys, values, nextLeaf = 0, numKeys) {
    const buf = Buffer.allocUnsafe(PAGE_SIZE);
    buf.writeUInt8(1, 0); // isLeaf = 1
    buf.writeUInt16LE(numKeys, 1);
    buf.writeUInt32LE(nextLeaf, 3); // 4 bytes for next leaf pointer

    for (let i = 0; i < keys.length; i++) {
      buf.writeUInt32LE(keys[i], 7 + i * 4);
      buf.writeUInt32LE(values[i], 7 + MAX_KEYS * 4 + i * 4);
    }
    return buf;
  }

  _decodeLeaf(buffer) {
    const numKeys = buffer.readUInt16LE(1);
    const nextLeaf = buffer.readUInt32LE(3);
    const keys = new Uint32Array(MAX_KEYS);
    const values = new Uint32Array(MAX_KEYS);
    for (let i = 0; i < numKeys; i++) {
      keys[i] = buffer.readUInt32LE(7 + i * 4);
      values[i] = buffer.readUInt32LE(7 + MAX_KEYS * 4 + i * 4);
    }
    return { keys, values, nextLeaf, numKeys };
  }

  _encodeInternal(keys, children, numKeys) {
    const buf = Buffer.allocUnsafe(PAGE_SIZE);
    buf.writeUInt8(0, 0); // isLeaf = 0
    buf.writeUInt16LE(numKeys, 1);
    for (let i = 0; i < keys.length; i++) {
      buf.writeUInt32LE(keys[i], 3 + i * 4);
    }
    for (let i = 0; i < children.length; i++) {
      buf.writeUInt32LE(children[i], 3 + MAX_KEYS * 4 + i * 4);
    }
    return buf;
  }

  _decodeInternal(buffer) {
    const numKeys = buffer.readUInt16LE(1);
    const keys = new Uint32Array(MAX_KEYS);
    const children = new Uint32Array(MAX_KEYS + 1);
    for (let i = 0; i < numKeys; i++) {
      keys[i] = buffer.readUInt32LE(3 + i * 4)
    }
    for (let i = 0; i < numKeys + 1; i++) {
      children[i] = buffer.readUInt32LE(3 + MAX_KEYS * 4 + i * 4)
    }
    return { keys, children, numKeys };
  }

  insert(key, value) {
    const result = this._insertRecursive(this.rootPage, key, value);
    if (result) {
      const { promotedKey, left, right } = result;
      const newRootId = this._allocatePage();
      const rootBuf = this._encodeInternal([promotedKey], [left, right]);
      this._writePage(newRootId, rootBuf);
      this.rootPage = newRootId;
      this._updateHeader();
    }
  }

  /*
  Only returns something if there was any Node split
   */
  _insertRecursive(pageId, key, value) {
    const buffer = this._readPage(pageId);
    const isLeaf = buffer.readUInt8(0);

    if (isLeaf) {
      let { keys, values, nextLeaf, numKeys } = this._decodeLeaf(buffer);
      let idx = this.#_binarySearch(keys, key, numKeys);

      keys.set(keys.subarray(idx, numKeys), idx);
      values.set(values.subarray(idx, numKeys), idx);
      keys[idx] = key;
      values[idx] = value;
      numKeys++;

      if (numKeys <= MAX_KEYS) {
        const buf = this._encodeLeaf(keys, values, nextLeaf, numKeys);
        this._writePage(pageId, buf);
        return null;
      } else {
        const mid = Math.floor(keys.length / 2);
        const leftKeys = new Uint32Array(mid);
        const leftValues = new Uint32Array(mid);
        const rightKeys = new Uint32Array(keys.length - mid);
        const rightValues = new Uint32Array(values.length - mid);
        leftKeys.set(keys.subarray(0, mid))
        leftValues.set(values.subarray(0, mid))
        rightKeys.set(keys.subarray(0, mid))
        rightValues.set(values.subarray(0, mid))

        const rightPageId = this._allocatePage();
        const rightBuf = this._encodeLeaf(rightKeys, rightValues, nextLeaf);
        const leftBuf = this._encodeLeaf(leftKeys, leftValues, rightPageId);

        this._writePage(pageId, leftBuf);
        this._writePage(rightPageId, rightBuf);

        return {
          promotedKey: rightKeys[0],
          left: pageId,
          right: rightPageId
        };
      }
    } else {
      const { keys: nodeKeys, children, numKeys } = this._decodeInternal(buffer);
      let i = this.#_binarySearch(nodeKeys, key, numKeys);
      const childPage = children[i];

      const result = this._insertRecursive(childPage, key, value);
      if (!result) return null;

      const { promotedKey, right } = result;
      for (let j = numKeys; j > i; j--) {
        nodeKeys[j] = nodeKeys[j - 1];
      }
      for (let j = numKeys + 1; j > i + 1; j--) {
        children[j] = children[j - 1];
      }

      nodeKeys[i] = promotedKey;
      children[i + 1] = right;
      const newKeyCount = numKeys + 1;

      if (newKeyCount <= MAX_KEYS) {
        const buf = this._encodeInternal(nodeKeys, children, newKeyCount);
        this._writePage(pageId, buf);
        return null;
      } else {
        const mid = Math.floor(newKeyCount / 2);
        const promoted = nodeKeys[mid];

        const leftKeys = new Uint32Array(MAX_KEYS);
        const rightKeys = new Uint32Array(MAX_KEYS);
        const leftChildren = new Uint32Array(MAX_KEYS + 1);
        const rightChildren = new Uint32Array(MAX_KEYS + 1);

        leftKeys.set(nodeKeys.subarray(0, mid), 0);
        leftChildren.set(children.subarray(0, mid + 1), 0);
        
        rightKeys.set(nodeKeys.subarray(mid + 1, newKeyCount), 0);
        rightChildren.set(children.subarray(mid + 1, newKeyCount + 1), 0);

        const rightPageId = this._allocatePage();
        const leftBuf = this._encodeInternal(leftKeys, leftChildren, mid);
        const rightBuf = this._encodeInternal(rightKeys, rightChildren, newKeyCount - mid - 1);

        this._writePage(pageId, leftBuf);
        this._writePage(rightPageId, rightBuf);

        return {
          promotedKey: promoted,
          left: pageId,
          right: rightPageId
        };
      }
    }
  }

  get(key) {
    let pageId = this.rootPage;
    while (true) {
      const buffer = this._readPage(pageId);
      const isLeaf = buffer.readUInt8(0);

      if (isLeaf) {
        const { keys, values } = this._decodeLeaf(buffer);
        const idx = keys.indexOf(key);
        return idx !== -1 ? values[idx] : null;
      }

      const { keys, children } = this._decodeInternal(buffer);
      let i = 0;
      while (i < keys.length && key >= keys[i]) i++;
      pageId = children[i];
    }
  }

  #_binarySearch(arr, key, len) {
    let lo = 0, hi = len;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  close() {
    fs.closeSync(this.fd);
  }
}
