import { DiskBPlusTree } from './simple.js';

const tree = new DiskBPlusTree('./tree');

for(const index of [...Array(20).keys()]){
  const value = Math.floor(Math.random() * 1 * 5000)
  console.log(index, value);
  tree.insert(index, value);
}
const value = tree.get(5);
console.log(value);
tree.close();
