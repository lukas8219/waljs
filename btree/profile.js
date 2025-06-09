import { DiskBPlusTree } from './optimized.js';
import fs from 'fs'

const name = 'optimized';
const newTree = new DiskBPlusTree(name)

const keysWithDifferentValues = new Set([1, 1000, 5000, 120_000, 333_333, 500_000, 888_000, 999_999])
const MOCK_VALUES = 4294967295;
const valueToBeTested = 999;

const indexes = [...Array(1_000_000).keys()].map((i) => keysWithDifferentValues.has(i) ? valueToBeTested : MOCK_VALUES);
for(const [index, value] of indexes.entries()){
  newTree.insert(index,value)
}
newTree.flush();
const stats = fs.statSync(name);
console.log(stats);
fs.rmSync(name);
