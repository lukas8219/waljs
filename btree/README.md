### Simple
Simple implementation of BTree with only insert/read operations.
No optimizations, one syscall per write.

### Cached
Adding Page cache, doing all operations in-memory and exposing method to flush in case needed.

### Optimized [WIPf]
After running profiles, fsync all the 1_000_000 writes took less than 100ms leading all the 6s performance to JS code.
The --trace-gc flag exposed VERY frequent minor GC's
It is possibly because of
- Buffer alloc (seems like we are not really using the Pooled buffers)
- Arrays poorly optimized (new arrays and not using Uint32Array) OR too many allocs
- Arrays operations like  findIndex and related stuff being sync. We need a BTree for the `keys` when we insert sorted

The goal is to reach <2 to write the 1_000_000 keys
