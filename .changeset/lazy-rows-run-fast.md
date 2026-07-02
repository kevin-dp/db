---
'@tanstack/db': patch
---

Fix O(collection size) work on every single-row write: `recomputeOptimisticState` and `commitPendingTransactions` no longer clone the entire `rowOrigins` map per write (copy-on-write overlay for touched keys instead), and `Transaction.applyMutations` merges mutations through a keyed map instead of a quadratic `findIndex` scan. Single-row incremental updates on large collections are now orders of magnitude faster (e.g. ~9.5ms → ~0.2ms per write at 50k rows).
