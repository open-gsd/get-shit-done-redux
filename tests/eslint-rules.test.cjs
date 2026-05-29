'use strict';

/**
 * eslint-rules.test.cjs
 *
 * RuleTester unit tests for the three local ESLint rules:
 *   - local/no-source-grep
 *   - local/no-magic-sleep-in-tests
 *   - local/no-elapsed-assertion
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { RuleTester } = require('eslint');

const noSourceGrep = require('../eslint-rules/no-source-grep.cjs');
const noMagicSleepInTests = require('../eslint-rules/no-magic-sleep-in-tests.cjs');
const noElapsedAssertion = require('../eslint-rules/no-elapsed-assertion.cjs');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
  },
});

// ─── no-source-grep ──────────────────────────────────────────────────────────

describe('no-source-grep rule', () => {
  test('valid: readFileSync on .md file is allowed', () => {
    ruleTester.run('no-source-grep', noSourceGrep, {
      valid: [
        {
          code: `
            const fs = require('fs');
            const path = require('path');
            const content = fs.readFileSync(path.join(__dirname, '..', 'docs', 'readme.md'), 'utf-8');
            content.includes('hello');
          `,
          filename: 'tests/foo.test.cjs',
        },
        {
          code: `
            const fs = require('fs');
            const path = require('path');
            const content = fs.readFileSync(path.join(__dirname, '..', 'get-shit-done', 'workflows', 'config.json'), 'utf-8');
            content.includes('key');
          `,
          filename: 'tests/foo.test.cjs',
        },
      ],
      invalid: [],
    });
    assert.ok(true, 'no-source-grep valid cases passed');
  });

  test('invalid: readFileSync on .cjs source file followed by .includes()', () => {
    ruleTester.run('no-source-grep', noSourceGrep, {
      valid: [],
      invalid: [
        {
          code: `
            const fs = require('fs');
            const path = require('path');
            const src = fs.readFileSync(path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib', 'core.cjs'), 'utf-8');
            src.includes('someFunction');
          `,
          filename: 'tests/foo.test.cjs',
          errors: [{ messageId: 'noSourceGrep' }],
        },
      ],
    });
    assert.ok(true, 'no-source-grep invalid case detected');
  });

  test('invalid: readFileSync on .cjs source file followed by .match()', () => {
    ruleTester.run('no-source-grep', noSourceGrep, {
      valid: [],
      invalid: [
        {
          code: `
            const fs = require('fs');
            const path = require('path');
            const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'foo.cjs'), 'utf-8');
            src.match(/pattern/);
          `,
          filename: 'tests/foo.test.cjs',
          errors: [{ messageId: 'noSourceGrep' }],
        },
      ],
    });
    assert.ok(true, 'no-source-grep match case detected');
  });

  test('valid: file with allow-test-rule annotation is exempt', () => {
    ruleTester.run('no-source-grep', noSourceGrep, {
      valid: [
        {
          // The allow annotation exempts the whole file
          code: `
            // allow-test-rule: pending migration
            const fs = require('fs');
            const path = require('path');
            const src = fs.readFileSync(path.join(__dirname, '..', 'get-shit-done', 'bin', 'lib', 'core.cjs'), 'utf-8');
            src.includes('someFunction');
          `,
          filename: 'tests/foo.test.cjs',
        },
      ],
      invalid: [],
    });
    assert.ok(true, 'no-source-grep allow-test-rule annotation works');
  });

  test('valid: require() of a .cjs file is allowed (not readFileSync)', () => {
    ruleTester.run('no-source-grep', noSourceGrep, {
      valid: [
        {
          code: `
            const mod = require('../get-shit-done/bin/lib/core.cjs');
            mod.someMethod();
          `,
          filename: 'tests/foo.test.cjs',
        },
      ],
      invalid: [],
    });
    assert.ok(true, 'no-source-grep require() is allowed');
  });
});

// ─── no-magic-sleep-in-tests ─────────────────────────────────────────────────

describe('no-magic-sleep-in-tests rule', () => {
  test('valid: setTimeout used outside tests (no-op since rule only applies to *.test.cjs)', () => {
    // Rule only applies to *.test.cjs files; a non-test filename is always valid
    ruleTester.run('no-magic-sleep-in-tests', noMagicSleepInTests, {
      valid: [
        {
          code: `
            const delay = new Promise(resolve => setTimeout(resolve, 100));
          `,
          filename: 'scripts/some-script.cjs',
        },
      ],
      invalid: [],
    });
    assert.ok(true, 'no-magic-sleep-in-tests does not apply outside test files');
  });

  test('invalid: Atomics.wait() in test file', () => {
    ruleTester.run('no-magic-sleep-in-tests', noMagicSleepInTests, {
      valid: [],
      invalid: [
        {
          code: `
            const shared = new SharedArrayBuffer(4);
            const arr = new Int32Array(shared);
            Atomics.wait(arr, 0, 0, 100);
          `,
          filename: 'tests/some.test.cjs',
          errors: [{ messageId: 'atomicsWaitSleep' }],
        },
      ],
    });
    assert.ok(true, 'no-magic-sleep-in-tests flags Atomics.wait()');
  });

  test('invalid: setTimeout used for synchronization in Promise in test file', () => {
    ruleTester.run('no-magic-sleep-in-tests', noMagicSleepInTests, {
      valid: [],
      invalid: [
        {
          code: `
            async function waitABit() {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          `,
          filename: 'tests/some.test.cjs',
          errors: [{ messageId: 'setTimeoutSync' }],
        },
      ],
    });
    assert.ok(true, 'no-magic-sleep-in-tests flags setTimeout in Promise');
  });

  test('valid: setTimeout with callback (not synchronization pattern) in test file', () => {
    // A setTimeout with no second arg or with a callback that does real work
    // is allowed. The rule only flags the await-new-Promise(setTimeout) pattern.
    ruleTester.run('no-magic-sleep-in-tests', noMagicSleepInTests, {
      valid: [
        {
          code: `
            function doSomethingLater(cb) {
              setTimeout(cb, 100);
            }
          `,
          filename: 'tests/some.test.cjs',
        },
      ],
      invalid: [],
    });
    assert.ok(true, 'no-magic-sleep-in-tests allows simple callback setTimeout');
  });
});

// ─── no-elapsed-assertion ─────────────────────────────────────────────────────

describe('no-elapsed-assertion rule', () => {
  test('valid: assert on non-timing property', () => {
    ruleTester.run('no-elapsed-assertion', noElapsedAssertion, {
      valid: [
        {
          code: `
            const assert = require('node:assert/strict');
            const result = { count: 5 };
            assert.equal(result.count, 5);
          `,
          filename: 'tests/foo.test.cjs',
        },
        {
          code: `
            const assert = require('node:assert/strict');
            assert.ok(result.success);
          `,
          filename: 'tests/foo.test.cjs',
        },
      ],
      invalid: [],
    });
    assert.ok(true, 'no-elapsed-assertion valid cases passed');
  });

  test('invalid: assert on .elapsed property', () => {
    ruleTester.run('no-elapsed-assertion', noElapsedAssertion, {
      valid: [],
      invalid: [
        {
          code: `
            const assert = require('node:assert/strict');
            const result = { elapsed: 150 };
            assert.ok(result.elapsed < 200);
          `,
          filename: 'tests/foo.test.cjs',
          errors: [{ messageId: 'noElapsedAssertion' }],
        },
      ],
    });
    assert.ok(true, 'no-elapsed-assertion flags assert on .elapsed');
  });

  test('invalid: assert on .duration property', () => {
    ruleTester.run('no-elapsed-assertion', noElapsedAssertion, {
      valid: [],
      invalid: [
        {
          code: `
            const assert = require('node:assert/strict');
            assert.equal(stats.duration, 100);
          `,
          filename: 'tests/foo.test.cjs',
          errors: [{ messageId: 'noElapsedAssertion' }],
        },
      ],
    });
    assert.ok(true, 'no-elapsed-assertion flags assert on .duration');
  });

  test('invalid: assert on .took property', () => {
    ruleTester.run('no-elapsed-assertion', noElapsedAssertion, {
      valid: [],
      invalid: [
        {
          code: `
            const assert = require('node:assert/strict');
            assert.ok(result.took < 500);
          `,
          filename: 'tests/foo.test.cjs',
          errors: [{ messageId: 'noElapsedAssertion' }],
        },
      ],
    });
    assert.ok(true, 'no-elapsed-assertion flags assert on .took');
  });

  test('invalid: assert on .ms property', () => {
    ruleTester.run('no-elapsed-assertion', noElapsedAssertion, {
      valid: [],
      invalid: [
        {
          code: `
            const assert = require('node:assert/strict');
            assert.ok(result.ms > 0);
          `,
          filename: 'tests/foo.test.cjs',
          errors: [{ messageId: 'noElapsedAssertion' }],
        },
      ],
    });
    assert.ok(true, 'no-elapsed-assertion flags assert on .ms');
  });

  test('invalid: assert.equal with timing comparison', () => {
    ruleTester.run('no-elapsed-assertion', noElapsedAssertion, {
      valid: [],
      invalid: [
        {
          code: `
            const assert = require('node:assert/strict');
            assert.equal(result.elapsed > 0, true);
          `,
          filename: 'tests/foo.test.cjs',
          errors: [{ messageId: 'noElapsedAssertion' }],
        },
      ],
    });
    assert.ok(true, 'no-elapsed-assertion flags assert.equal with timing comparison');
  });
});
