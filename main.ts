import fs, { constants } from 'fs';
import { open } from 'fs/promises';
import http from 'http';
import { promisify } from 'util';
import readline from 'readline'
import { stdin, stdout } from 'process';

const writeAsync = promisify(fs.write).bind(fs)
const DEFAULT_WAL_BUFFER = 1; //1024 * 1024 * 16; //16mb
const rl = readline.createInterface({ input: stdin, output: stdout })

type WalRecord = {
  wal: WAL;
  lastFlush: number;
}

class WalStore {
  private readonly store = new Map<number, WalRecord>(); //Maybe a MinHeap makes sense here to flush?
  private readonly WalFlagsAndMode = constants.O_APPEND | constants.O_RDWR;

  async get(filename: string): Promise<WAL> {
    const fileHandle = await open(filename, this.WalFlagsAndMode);
    const fd = fileHandle.fd;
    const wal = new WAL(fd);
    this.store.set(fd, { wal, lastFlush: 0 })
    return wal;
  }
}

//Does WAL need any metadata? if so, which?
//Something outside of WAL should actually control the flushing
class WAL {
  private offset: number = 0;
  private buffer = Buffer.allocUnsafe(DEFAULT_WAL_BUFFER);

  constructor(private readonly fd: number){} 

  //This should go to Memory -> Disk at each ~250ms
  async append(data: Buffer){
    let copiedBytes = await this.append0(data);
    while(copiedBytes !== data.byteLength){
      copiedBytes += await this.append0(data, copiedBytes);
    }
  }

  async append0(data: Buffer, sourceStart = 0){
    //ensure it is copying the entire buffer.
    if (this.buffer.byteLength + data.byteLength >= DEFAULT_WAL_BUFFER){
      await this.flush();
    }
    const copiedBytes = data.copy(this.buffer, this.offset, sourceStart)
    this.offset += copiedBytes;
    return copiedBytes;
  }

  //How do we flush into WAL with 100% sure on Application error?
  async flush(){
    console.log('flushing to disk')
    await writeAsync(this.fd, this.buffer);
    this.buffer = Buffer.allocUnsafe(DEFAULT_WAL_BUFFER);
    this.offset = 0;
  }

  async close(){
    fs.closeSync(this.fd);
  }

}

async function start(){
  const store = new WalStore();
  const wal = await store.get('myfile.wal');
  console.log(wal);

  await wal.append(Buffer.from("message 1"));
  await wal.append(Buffer.from("message 2"));
  rl.question("Have you checked the contents?", async () => {
    await wal.flush();
    rl.question("Check it again", async () => {
      await wal.close();
      process.exit(0);
    })
  })
}

start();
