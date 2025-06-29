import { DiskBPlusTree } from './optimized.js';
import fs from 'fs'

const name = 'optimized';
const keysWithDifferentValues = new Set([1, 1000, 5000, 120_000, 333_333, 500_000, 888_000, 999_999])
const MOCK_VALUES = 4294967295;
const valueToBeTested = 999;
const indexes = [...Array(1_000_000).keys()].map((i) => keysWithDifferentValues.has(i) ? valueToBeTested : MOCK_VALUES);

try {
  const newTree = new DiskBPlusTree(name)
  for(const [index, value] of indexes.entries()){
    newTree.insert(index,value)
  }
  newTree.flush();
  const value = newTree.get(1000);
  console.log(value);
  const stats = fs.statSync(name);
  console.log(stats);
} finally {
  fs.rmSync(name);
}

