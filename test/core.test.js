import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkipList } from '../src/index.js';

// Determinism: every SkipList constructed below uses the default seed (1) so the
// random level heights are reproducible. We never assert on those heights
// directly — we assert on the externally observable ordering and set semantics.

test('starts empty', () => {
  const s = new SkipList();
  assert.equal(s.size, 0);
  assert.deepEqual(s.toArray(), []);
  assert.equal(s.contains(1), false);
});

test('insert returns true for new keys and false for duplicates', () => {
  const s = new SkipList();
  assert.equal(s.insert(5), true);
  assert.equal(s.insert(5), false);
  assert.equal(s.insert(3), true);
  assert.equal(s.size, 2);
});

test('contains finds inserted elements and rejects absent ones', () => {
  const s = new SkipList();
  for (const k of [10, 20, 30, 40, 50]) s.insert(k);
  assert.equal(s.contains(10), true);
  assert.equal(s.contains(35), false);
  assert.equal(s.contains(50), true);
});

test('toArray returns elements in ascending order regardless of insertion order', () => {
  const s = new SkipList();
  const inserted = [42, 7, 19, 100, 3, 88, 55, 1, 200, 14];
  for (const k of inserted) s.insert(k);
  assert.deepEqual(s.toArray(), [...inserted].sort((a, b) => a - b));
});

test('delete removes an element and returns true; returns false when absent', () => {
  const s = new SkipList();
  for (const k of [10, 20, 30, 40, 50]) s.insert(k);
  assert.equal(s.delete(30), true);
  assert.equal(s.contains(30), false);
  assert.equal(s.size, 4);
  assert.equal(s.delete(30), false); // already gone
  assert.equal(s.delete(999), false); // never there
});

test('insert-delete-insert cycle keeps ordering consistent', () => {
  const s = new SkipList();
  for (const k of [5, 1, 9, 3, 7]) s.insert(k);
  s.delete(5);
  s.delete(1);
  s.insert(2);
  s.insert(6);
  assert.deepEqual(s.toArray(), [2, 3, 6, 7, 9]);
});

test('clear empties the list while preserving config', () => {
  const s = new SkipList();
  for (const k of [1, 2, 3]) s.insert(k);
  s.clear();
  assert.equal(s.size, 0);
  assert.deepEqual(s.toArray(), []);
  // Reuse after clear must still work.
  assert.equal(s.insert(42), true);
  assert.equal(s.contains(42), true);
});

test('stress: 1000 sequential integers maintain invariant on every step', () => {
  const s = new SkipList({ maxLevel: 24 });
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    assert.equal(s.insert(i), true);
    seen.add(i);
    assert.equal(s.size, seen.size);
    assert.equal(s.contains(i), true);
  }
  // Now delete every other one and re-insert some.
  for (let i = 0; i < 1000; i += 2) {
    assert.equal(s.delete(i), true);
    seen.delete(i);
  }
  assert.equal(s.size, seen.size);
  const arr = s.toArray();
  assert.equal(arr.length, seen.size);
  for (const v of arr) assert.equal(seen.has(v), true);
  // Ascending check.
  for (let i = 1; i < arr.length; i++) {
    assert.ok(arr[i - 1] < arr[i], `out of order at ${i}`);
  }
});

test('custom comparator is honored (descending numeric)', () => {
  const s = new SkipList({
    compare: (a, b) => (a < b ? 1 : a > b ? -1 : 0),
  });
  for (const k of [3, 1, 4, 1, 5, 9, 2, 6]) s.insert(k);
  // 1 is a duplicate under this comparator too.
  assert.equal(s.size, 7);
  assert.deepEqual(s.toArray(), [9, 6, 5, 4, 3, 2, 1]);
});

test('string keys ordered lexicographically via custom comparator', () => {
  const s = new SkipList({
    compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  });
  for (const k of ['banana', 'apple', 'cherry', 'date']) s.insert(k);
  assert.deepEqual(s.toArray(), ['apple', 'banana', 'cherry', 'date']);
  assert.equal(s.contains('cherry'), true);
  assert.equal(s.contains('grape'), false);
});

test('constructor rejects invalid options', () => {
  assert.throws(() => new SkipList({ maxLevel: 0 }), /maxLevel/);
  assert.throws(() => new SkipList({ maxLevel: 1.5 }), /maxLevel/);
  assert.throws(() => new SkipList({ p: 0 }), /p must/);
  assert.throws(() => new SkipList({ p: 1 }), /p must/);
  assert.throws(() => new SkipList({ seed: 0 }), /seed/);
  assert.throws(() => new SkipList({ seed: 1.5 }), /seed/);
  assert.throws(() => new SkipList({ compare: 'nope' }), /compare/);
});

test('same seed yields the same internal structure across instances', () => {
  // We can't easily observe heights, but we CAN observe that identical sequences
  // of inserts produce identical toArray AND identical size at every step — which
  // is the externally useful consequence of determinism.
  const a = new SkipList({ seed: 12345 });
  const b = new SkipList({ seed: 12345 });
  const seq = [50, 40, 30, 20, 10, 60, 70, 80, 90, 100, 5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
  for (const k of seq) {
    a.insert(k);
    b.insert(k);
    assert.equal(a.size, b.size);
  }
  assert.deepEqual(a.toArray(), b.toArray());
});

test('different seeds still produce correct ordering (determinism is structural, not semantic)', () => {
  const a = new SkipList({ seed: 1 });
  const b = new SkipList({ seed: 2 });
  const seq = Array.from({ length: 100 }, (_, i) => (i * 37) % 101);
  for (const k of seq) {
    a.insert(k);
    b.insert(k);
  }
  assert.deepEqual(a.toArray(), b.toArray());
});
