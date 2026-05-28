/**
 * Regression test for perf #407 — withPlanningLock allocates a fresh
 * SharedArrayBuffer on every retry iteration.
 *
 * The fix: hoist the sleep buffer allocation to once before the retry loop.
 * The buffer is never mutated and never escapes — Atomics.wait(buf,0,0,delay)
 * always sees 0 whether the buffer is fresh or reused, so the behavior is
 * identical.
 *
 * Observable invariant (POST-FIX): exactly ONE SharedArrayBuffer is allocated
 * per withPlanningLock call, regardless of retry count.
 *
 * RED (pre-fix):  sabCount >= 2 when >= 1 retry occurs.
 * GREEN (post-fix): sabCount === 1.
 *
 * Strategy: two Worker threads run in parallel.
 *   Worker A (lock holder): writes the lock file with the current process pid,
 *     sleeps 400ms via Atomics.wait, then removes the lock.
 *   Worker B (writer): installs a counting SharedArrayBuffer stub, then calls
 *     withPlanningLock — which retries until A releases.
 *     Reports sabCount via postMessage.
 *
 * Using Worker threads (not child processes) avoids the node --test subprocess-
 * detection hang that occurs with spawn() inside a test runner worker context.
 *
 * Total test wall-time: ~400-600ms.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PLANNING_WORKSPACE_CJS_PATH = path.join(
  __dirname, '..', 'get-shit-done', 'bin', 'lib', 'planning-workspace.cjs'
);

// Worker A: holds the planning lock file for holdMs, then removes it.
// workerData: { lockPath, holdMs }
const HOLDER_WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
// Write pid to lock file so withPlanningLock sees a live pid and retries.
const lockContent = JSON.stringify({ pid: process.pid, cwd: '/tmp', acquired: new Date().toISOString() });
fs.writeFileSync(workerData.lockPath, lockContent);
parentPort.postMessage({ pid: process.pid });
// Synchronous sleep — blocks this worker thread for holdMs ms.
const buf = new Int32Array(new SharedArrayBuffer(4));
Atomics.wait(buf, 0, 0, workerData.holdMs);
// Release the lock.
try { fs.unlinkSync(workerData.lockPath); } catch { /* already gone */ }
parentPort.postMessage({ done: true });
`;

// Worker B: stubs global.SharedArrayBuffer with a counting call-through wrapper,
// then calls withPlanningLock, and reports sabCount.
// workerData: { planningWorkspaceCjsPath, cwd }
const WRITER_WORKER_CODE = `
const { parentPort, workerData } = require('worker_threads');
const RealSAB = global.SharedArrayBuffer;
let sabCount = 0;
// Stub: increments sabCount, calls through so Atomics.wait gets a real SAB-backed buffer.
function StubSAB(...args) {
  sabCount++;
  return new RealSAB(...args);
}
StubSAB.prototype = RealSAB.prototype;
global.SharedArrayBuffer = StubSAB;

// Delete cache entry to ensure a fresh require picks up the stubbed constructor.
// (The inline "new SharedArrayBuffer(4)" in withPlanningLock reads the global at
// call time, so even a cached require would use our stub — but deleting avoids
// any module-level SAB allocations from a prior require contaminating sabCount.)
delete require.cache[workerData.planningWorkspaceCjsPath];
const { withPlanningLock } = require(workerData.planningWorkspaceCjsPath);

let callErr = null;
try {
  withPlanningLock(workerData.cwd, () => {});
} catch (e) {
  callErr = (e && e.message) ? e.message : String(e);
}
parentPort.postMessage({ sabCount, callErr });
`;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-407-'));
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  return dir;
}

function removeTempDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────────────────────────────────────

describe('perf #407: withPlanningLock hoists sleep buffer — exactly one SAB per call', () => {
  let tmpDir;
  let lockPath;

  beforeEach(() => {
    tmpDir = makeTempDir();
    lockPath = path.join(tmpDir, '.planning', '.lock');
  });

  afterEach(() => {
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    removeTempDir(tmpDir);
  });

  test(
    'sabCount === 1 after a call that undergoes >= 1 retry (post-fix assertion)',
    { timeout: 8000 },
    async () => {
      // ── Worker A: hold the lock for 400ms ──────────────────────────────────
      // The retry loop waits 100ms per spin, so >= 1 retry fires before
      // Worker A releases at 400ms.
      const holdMs = 400;
      let holderWorker;
      const holderDone = new Promise((resolve, reject) => {
        holderWorker = new Worker(HOLDER_WORKER_CODE, {
          eval: true,
          workerData: { lockPath, holdMs },
        });
        holderWorker.on('message', (msg) => { if (msg.done) resolve(); });
        holderWorker.on('error', reject);
        holderWorker.on('exit', (code) => {
          if (code !== 0) reject(new Error('Holder worker exit code: ' + code));
        });
      });

      // Give Worker A 80ms to write the lock file before starting Worker B.
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.ok(fs.existsSync(lockPath), 'Worker A must have written the lock file');

      // ── Worker B: call withPlanningLock, measure SAB allocations ───────────
      const writeResult = await new Promise((resolve, reject) => {
        const writer = new Worker(WRITER_WORKER_CODE, {
          eval: true,
          workerData: {
            planningWorkspaceCjsPath: PLANNING_WORKSPACE_CJS_PATH,
            cwd: tmpDir,
          },
        });
        writer.on('message', resolve);
        writer.on('error', reject);
        writer.on('exit', (code) => {
          if (code !== 0) reject(new Error('Writer worker exit code: ' + code));
        });
      });

      // Wait for Worker A to finish releasing
      await holderDone;

      // ── Assertions ─────────────────────────────────────────────────────────
      assert.ok(
        writeResult.callErr === null,
        'withPlanningLock must succeed once the lock is released — error: ' + writeResult.callErr
      );

      assert.ok(
        writeResult.sabCount >= 1,
        'at least one SharedArrayBuffer must be allocated (the sleep buffer must exist)'
      );

      // THE KEY INVARIANT:
      //   POST-FIX: sabCount === 1  (buffer allocated once, before the retry loop)
      //   PRE-FIX:  sabCount >= 2   (new buffer on EVERY retry iteration)
      //
      // With a 400ms hold and 100ms per-spin wait, the pre-fix code observes sabCount >= 2.
      assert.strictEqual(
        writeResult.sabCount,
        1,
        'post-fix: exactly one SharedArrayBuffer must be allocated per withPlanningLock call ' +
          '(buffer hoisted before retry loop). Got: ' + writeResult.sabCount
      );
    }
  );
});
