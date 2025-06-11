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

  _spliceUint(array, index, deleteCount, ...items){
    const before = array.slice(0, index);
    const after = array.slice(index + deleteCount);
    const insert = Uint32Array.from(items);

    const result = new Uint32Array(before.length + insert.length + after.length);
    result.set(before, 0);
    result.set(insert, before.length);
    result.set(after, before.length + insert.length);

    return result;
  }

  _encodeLeaf(keys, values, nextLeaf = 0, numKeys) {
    const leaf = new Uint32Array(PAGE_SIZE / 4);

    leaf[0] = 1;                // isLeaf (equivalente ao buf.writeUInt8)
    leaf[1] = numKeys;      // key count (equivalente ao buf.writeUInt16LE)
    leaf[3] = nextLeaf;         // skip [2] to preserve offset = 3

    const valuesOffset = 4;
    const keysOffset = valuesOffset + MAX_KEYS;

    leaf.set(values, valuesOffset)
    leaf.set(keys, keysOffset)

    return Buffer.from(leaf.buffer, 0, PAGE_SIZE);
  }

  _decodeLeaf(buffer) {
    const view = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

    const numKeys = view[1];
    const nextLeaf = view[3];

    const valuesOffset = 4;
    const keysOffset = valuesOffset + MAX_KEYS;

    const keys = view.subarray(keysOffset, numKeys);
    const values = view.subarray(valuesOffset, numKeys);

    return { keys, values, nextLeaf, numKeys };
  }

  _decodeInternal(buffer) {
    const internal = new Uint32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    const numKeys = internal[1];

    const keysOffset = 3;
    const childrenOffset = keysOffset + MAX_KEYS;

    const keys = new Array(numKeys);
    const children = new Array(numKeys + 1);

    for (let i = 0; i < numKeys; i++) {
      keys[i] = internal[keysOffset + i];
      children[i] = internal[childrenOffset + i];
    }

    children[numKeys] = internal[childrenOffset + numKeys];

    return { keys, children };
  }

  _encodeInternal(keys, children) {
    const internalNode = new Uint32Array(PAGE_SIZE / 4);
    internalNode[0] = 0;
    internalNode[1] = keys.length;
    const keysOffset = 3; //might be 3?
    const childrenOffset = keysOffset + MAX_KEYS;

    internalNode.set(keys, keysOffset)
    internalNode.set(children, childrenOffset)

    return Buffer.from(internalNode.buffer, 0, PAGE_SIZE);
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
      let idx = this._binarySearch(keys, key, numKeys);
      if (idx === -1) idx = numKeys;
      keys = this._spliceUint(keys, idx, 0, key)
      values = this._spliceUint(values, idx, 0, value);
      numKeys++;

      if (numKeys <= MAX_KEYS) {
        const buf = this._encodeLeaf(keys, values, nextLeaf, numKeys);
        this._writePage(pageId, buf);
        return null;
      } else {
        const mid = Math.floor(numKeys / 2);
        const leftKeys = keys.slice(0, mid);
        const leftValues = values.slice(0, mid);
        const rightKeys = keys.slice(mid);
        const rightValues = values.slice(mid);

        const rightPageId = this._allocatePage();
        const rightBuf = this._encodeLeaf(rightKeys, rightValues, nextLeaf, mid);
        const leftBuf = this._encodeLeaf(leftKeys, leftValues, rightPageId, mid);

        this._writePage(pageId, leftBuf);
        this._writePage(rightPageId, rightBuf);

        return {
          promotedKey: rightKeys[0],
          left: pageId,
          right: rightPageId
        };
      }
    } else {
      const { keys: nodeKeys, children } = this._decodeInternal(buffer);
      let i = this._binarySearch(nodeKeys, key, nodeKeys.length);
      const childPage = children[i];

      const result = this._insertRecursive(childPage, key, value);
      if (!result) return null;

      const { promotedKey, right } = result;
      nodeKeys.splice(i, 0, promotedKey);
      children.splice(i + 1, 0, right);

      if (nodeKeys.length <= MAX_KEYS) {
        const buf = this._encodeInternal(nodeKeys, children);
        this._writePage(pageId, buf);
        return null;
      } else {
        const mid = Math.floor(nodeKeys.length / 2);
        const leftKeys = nodeKeys.slice(0, mid);
        const rightKeys = nodeKeys.slice(mid + 1);
        const promoted = nodeKeys[mid];

        const leftChildren = children.slice(0, mid + 1);
        const rightChildren = children.slice(mid + 1);

        const rightPageId = this._allocatePage();
        const rightBuf = this._encodeInternal(rightKeys, rightChildren);
        const leftBuf = this._encodeInternal(leftKeys, leftChildren);

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
        const { keys, values, numKeys } = this._decodeLeaf(buffer);
        const idx = this._binarySearch(keys, key, numKeys);
        return idx !== -1 ? values[idx] : null;
      }

      const { keys, children } = this._decodeInternal(buffer);
      let i = this._binarySearch(keys, key, keys.length);
      pageId = children[i];
    }
  }

  close() {
    fs.closeSync(this.fd);
  }

  _binarySearch(arr, key, len) {
    let lo = 0, hi = len;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
