/*
 * Benchmarks to test the simplesmente BTree implementation using pure, raw sync syscalls read/write.
Pay attention into how fast the reads (cached from OS) is versus manually doing `write/sync`
To write the 1_000_000 keys it takes us 10s (0.000006 seconds per insert)
To read a single single within those 1million takes less than 1ms
*/
import { DiskBPlusTree } from './optimized.js';
import { it, describe, after } from 'node:test'
import fs from 'fs'

const newTreeName = './new-tree-optimized';
const newTree = new DiskBPlusTree(newTreeName)
const populatedNonCachedTree = new DiskBPlusTree('./non-cached-tree-optimized')

function bench(fn){
  const before = Date.now();
  fn()
  return Date.now() - before;
}

const keysWithDifferentValues = new Set([1, 1000, 5000, 120_000, 333_333, 500_000, 888_000, 999_999])
const MOCK_VALUES = 4294967295;
const valueToBeTested = 999;

const thresholds = {
  insert: { duration: 15_000, keys: 1_000_000 },
  read: { duration: 2 }
}

describe('Optimized Implementation', () => {
  it(`should insert ${thresholds.insert.keys} under ${thresholds.insert.duration}ms`, (t) => {
    const indexes = [...Array(thresholds.insert.keys).keys()].map((i) => keysWithDifferentValues.has(i) ? valueToBeTested : MOCK_VALUES);
    const timeElapsed = bench(() => {
      for(const [index, value] of indexes.entries()){
        newTree.insert(index,value)
      }
      newTree.flush();
    })
    t.assert.equal(timeElapsed < thresholds.insert.duration, true)
  })

  it('should query B+Tree with more than 1_000_000 under 2ms', { timeout: 2000 }, (t) => {
    for(const index of keysWithDifferentValues.keys()){
      const benchResult = bench(() => {
        const value = populatedNonCachedTree.get(index)
        t.assert.equal(value, valueToBeTested);
      });
      t.assert.equal(benchResult < thresholds.read.duration, true)
    }
  })

  after(() => fs.rmSync(newTreeName))
})

