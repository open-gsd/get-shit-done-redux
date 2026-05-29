'use strict';

/**
 * Deterministic clock seam for lock modules (issue #453).
 *
 * Production code uses `realClock` (the default). Test code passes in a
 * `makeFakeClock()` instance to drive lock timing without real wall-clock
 * waits or Atomics.wait calls.
 *
 * Both methods in realClock use exactly the same system primitives that
 * acquireStateLock and withPlanningLock used inline before the seam was
 * introduced:
 *   - now()   → Date.now()
 *   - sleep() → Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
 */

// Module-level Atomics.wait buffer reused across every realClock.sleep() call.
// The buffer value is always 0 (never written), so reuse is semantically
// identical to allocating a fresh buffer each time.
const _realSleepBuf = new Int32Array(new SharedArrayBuffer(4));

const realClock = {
  /** Return current epoch milliseconds (same as the inline Date.now() calls in state.cjs). */
  now() {
    return Date.now();
  },

  /**
   * Synchronous sleep via Atomics.wait.
   * This is the identical primitive acquireStateLock and withPlanningLock used
   * inline before the seam.  Atomics.wait on a shared buffer that is never
   * notified times out after exactly `ms` milliseconds without spinning the CPU.
   *
   * @param {number} ms - milliseconds to sleep
   */
  sleep(ms) {
    Atomics.wait(_realSleepBuf, 0, 0, ms);
  },
};

module.exports = { realClock };
