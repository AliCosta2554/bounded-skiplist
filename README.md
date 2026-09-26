# bounded-skiplist

A small, zero-dependency skip list that maintains an ordered **set** of keys with logarithmic-ish `insert`, `delete`, and `contains`. Duplicate keys are rejected. Level promotion uses a deterministic, seedable PRNG so the same sequence of inserts produces the same structure every time.

## Usage

```js
import { SkipList } from 'bounded-skiplist';

const sl = new SkipList();           // default: numeric ascending, maxLevel 16, seed 1
sl.insert(3);
sl.insert(1);
sl.insert(2);
sl.contains(2);   // true
sl.toArray();     // [1, 2, 3]
sl.delete(2);     // true
sl.size;          // 2
```

Custom comparator and explicit seed:

```js
import { SkipList } from 'bounded-skiplist';

const desc = new SkipList({
  compare: (a, b) => (a < b ? 1 : a > b ? -1 : 0),
  maxLevel: 24,
  seed: 42,
});
```

Exported names: `SkipList` (the only export, from `src/index.js`).

## Why this exists

You need an ordered set and a balanced BST is more machinery than the job warrants, but a plain sorted array gives linear `insert`/`delete`. A skip list gives probabilistic balancing with pointer-splicing instead of rebalancing rotations — simpler code, same expected complexity. The trade-off: operations are *expected* O(log n), not *guaranteed*; worst case is linear. For in-memory indexes at modest sizes that is the right call.

The PRNG is a fixed-seed xorshift32 by default. This is deliberate: deterministic structure makes behavior reproducible across runs and across the test suite. If you want randomized structure, pass your own `seed`.

## Edge you will hit

This is an ordered **set**, not a multiset. Inserting a key equal (per your comparator) to an existing one is rejected and returns `false` — the existing element is **not** updated or replaced. If you need to update a value, `delete` then `insert`. Comparators are total orders over keys only; mixing incomparable types in one list is your problem, not the library's.
