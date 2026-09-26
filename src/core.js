/**
 * Core skip list implementation.
 *
 * Design notes (the WHY):
 *
 * - Comparison is by an externally-supplied comparator (default ascending numeric).
 *   We do not coerce types or special-case strings; callers who want that can pass a
 *   comparator. This avoids the classic "10 sorts before 9" string-coercion bug.
 *
 * - Elements are compared by KEY ONLY. Duplicate keys are rejected on insert and
 *   silently tolerated on delete (delete of a missing key is a no-op returning false).
 *   This matches the "ordered SET" brief: one interpretation, stated plainly.
 *
 * - Level promotion uses a deterministic, injectable PRNG (a 32-bit xorshift) seeded
 *   from an injected number. The default seed is fixed (1) so behavior is reproducible
 *   across runs AND across the test suite — critical because skiplist tests that depend
 *   on random level heights are otherwise flaky. Callers wanting "real" randomness pass
 *   a seed of their choosing. We deliberately do NOT reach for Math.random in the
 *   default path; a library whose default behavior is nondeterministic is a library
 *   whose tests lie.
 *
 * - The forward[] array of each node is a plain Array; V8 packs it efficiently for our
 *   small heights. Using a typed array per node would complicate lifetime management
 *   (each node has a different max level) for no measurable gain at the sizes this
 *   library targets.
 */

/**
 * A node in the skip list. Carries its key and one forward pointer per level.
 */
class SkipNode {
  /**
   * @param {*} key The element value.
   * @param {number} levels How many levels this node participates in (its height).
   */
  constructor(key, levels) {
    this.key = key;
    // `forward[i]` is the next node at level i, or null (set by SkipList).
    this.forward = new Array(levels).fill(null);
  }
}

/**
 * A bounded skip list maintaining an ordered set with logarithmic-ish operations.
 */
export class SkipList {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxLevel=16] Hard cap on node height. With p=0.5 this caps
   *   expected capacity at ~2^16 entries before the list degrades toward linear scans.
   *   Bumping it costs one pointer per level per node, so keep it modest.
 * @param {number} [opts.p=0.5] Promotion probability between adjacent levels.
 * @param {function(*,*):number} [opts.compare] Total order over keys. Defaults to
 *   ascending numeric. Must return negative/zero/positive in the usual way.
 * @param {number} [opts.seed=1] Seed for the level-height PRNG. Fixed by default so
 *   the same sequence of inserts yields the same structure every time.
 */
 constructor(opts = {}) {
    const {
      maxLevel = 16,
      p = 0.5,
      compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      seed = 1,
    } = opts;

    if (!Number.isInteger(maxLevel) || maxLevel < 1) {
      throw new TypeError(`maxLevel must be a positive integer, got ${maxLevel}`);
    }
    if (!(p > 0 && p < 1)) {
      // p=0 makes every node level-1 (degenerate list); p=1 makes every node max-height
      // (also degenerate). Reject both rather than silently misbehave.
      throw new TypeError(`p must satisfy 0 < p < 1, got ${p}`);
    }
    if (typeof compare !== 'function') {
      throw new TypeError('compare must be a function');
    }
    if (!Number.isInteger(seed)) {
      // xorshift32 needs a 32-bit integer seed; non-integers would be silently truncated
      // and surprise users who passed 1.5 expecting something specific.
      throw new TypeError(`seed must be a 32-bit integer, got ${seed}`);
    }

    this._maxLevel = maxLevel;
    this._p = p;
    this._compare = compare;
    this._level = 1; // current top level actually in use; starts at 1.
    this._size = 0;
    // Head node's key is unused; it exists solely to anchor level 0..maxLevel-1.
    this._head = new SkipNode(null, maxLevel);

    // xorshift32 state. Seeded once; never re-seeded. Avoids the zero-state trap
    // by requiring a nonzero seed (enforced above via Number.isInteger, and we also
    // guard explicitly against 0).
    if (seed === 0) {
      throw new TypeError('seed must be nonzero (xorshift32 cannot escape the 0 state)');
    }
    this._rngState = seed >>> 0;
  }

  /**
   * xorshift32 step. Deterministic, fast, good enough for level promotion — we do
   * not need cryptographic quality, only uniform-ish bits and full reproducibility.
   * @returns {number} a 32-bit unsigned pseudo-random integer.
   * @private
   */
  _nextRandom() {
    let x = this._rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._rngState = x >>> 0;
    return this._rngState;
  }

  /**
   * Random level in [1, maxLevel] using the promotion probability p.
   * Uses integer comparison against p * 2^31 to avoid float drift: comparing a
   * uniform float to a threshold float is fine in principle, but integer math is
   * obviously exact and avoids any reader doubt about rounding.
   * @returns {number}
   * @private
   */
  _randomLevel() {
    // Threshold corresponding to p: a uniform u in [0,1) promotes when u < p.
    // We draw u as _nextRandom() / 2^32 and test against p; equivalently test
    // _nextRandom() < p * 2^32. Precompute once.
    const threshold = Math.floor(this._p * 0x100000000); // p * 2^32
    let level = 1;
    // Cap at maxLevel-1 increments so final level is in [1, maxLevel].
    while (level < this._maxLevel && this._nextRandom() < threshold) {
      level++;
    }
    return level;
  }

  /**
   * Number of elements currently stored.
   * @returns {number}
   */
  get size() {
    return this._size;
  }

  /**
   * Insert a key. If an equal key (per the comparator) already exists, the insert is
   * rejected and this returns false — this is an ordered SET, not a multiset.
   * @param {*} key
   * @returns {boolean} true if inserted, false if the key was already present.
   */
  insert(key) {
    const update = new Array(this._maxLevel);
    let node = this._head;

    // Walk down from the current top level, recording the last node at each level
    // whose forward pointer might need updating. Standard Pugh descent.
    for (let i = this._level - 1; i >= 0; i--) {
      while (node.forward[i] !== null && this._compare(node.forward[i].key, key) < 0) {
        node = node.forward[i];
      }
      update[i] = node;
    }

    const successor = node.forward[0];
    if (successor !== null && this._compare(successor.key, key) === 0) {
      // Duplicate. Ordered set semantics: reject.
      return false;
    }

    const lvl = this._randomLevel();
    if (lvl > this._level) {
      // New levels above the previous top have no prior nodes to record; initialize
      // their update slots to the head node so the new node's forward pointers get
      // wired to whatever the head currently points to (null, initially).
      for (let i = this._level; i < lvl; i++) {
        update[i] = this._head;
      }
      this._level = lvl;
    }

    const newNode = new SkipNode(key, lvl);
    for (let i = 0; i < lvl; i++) {
      newNode.forward[i] = update[i].forward[i];
      update[i].forward[i] = newNode;
    }

    this._size++;
    return true;
  }

  /**
   * Delete a key. No-op (returns false) if the key is not present.
   * @param {*} key
   * @returns {boolean} true if an element was removed, false otherwise.
   */
  delete(key) {
    const update = new Array(this._maxLevel);
    let node = this._head;

    for (let i = this._level - 1; i >= 0; i--) {
      while (node.forward[i] !== null && this._compare(node.forward[i].key, key) < 0) {
        node = node.forward[i];
      }
      update[i] = node;
    }

    const target = node.forward[0];
    if (target === null || this._compare(target.key, key) !== 0) {
      return false;
    }

    // Unlink target at every level it participates in. Levels above its height are
    // unaffected (their forward pointers skip over it by construction).
    for (let i = 0; i < target.forward.length; i++) {
      if (update[i].forward[i] === target) {
        update[i].forward[i] = target.forward[i];
      }
    }

    // If we removed the tallest node, drop this._level until the head's top non-null
    // forward is found. This keeps the operational level honest and bounds search cost.
    while (this._level > 1 && this._head.forward[this._level - 1] === null) {
      this._level--;
    }

    this._size--;
    return true;
  }

  /**
   * Test for membership.
   * @param {*} key
   * @returns {boolean}
   */
  contains(key) {
    let node = this._head;
    for (let i = this._level - 1; i >= 0; i--) {
      while (node.forward[i] !== null && this._compare(node.forward[i].key, key) < 0) {
        node = node.forward[i];
      }
    }
    const candidate = node.forward[0];
    return candidate !== null && this._compare(candidate.key, key) === 0;
  }

  /**
   * Return all keys in ascending order (per the comparator) as a fresh array.
   * Implemented as a level-0 walk, which is O(n) and the asymptotic floor for any
   * full traversal.
   * @returns {Array<*>}
   */
  toArray() {
    const out = [];
    for (let node = this._head.forward[0]; node !== null; node = node.forward[0]) {
      out.push(node.key);
    }
    return out;
  }

  /**
   * Remove every element. Keeps maxLevel/p/compare/rng state so the list can be
   * reused; the determinism contract is preserved across clears.
   */
  clear() {
    for (let i = 0; i < this._maxLevel; i++) {
      this._head.forward[i] = null;
    }
    this._level = 1;
    this._size = 0;
  }
}
