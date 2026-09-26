/**
 * Public entry point for the bounded-skiplist package.
 *
 * Re-exports the SkipList class from ./core.js so callers depend on the package
 * root, not on internal module paths. Keeping this file thin means we can grow
 * the implementation across more modules later without churning the public API.
 */
export { SkipList } from './core.js';
