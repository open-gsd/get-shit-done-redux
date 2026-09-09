'use strict';

/**
 * tests/agent-skills-compact-variant.test.cjs — ADR-4139, epic #4139, Phase 7 (#4407).
 *
 * `agents/*.compact.md` is a THIRD shape layered onto the variant-swap mechanism Phase 6
 * built (`tests/helpers/compact-content-variant.cjs`): registration, protected-content and
 * size checks apply unchanged, but reachability does not, because an agent variant is
 * selected by a generic, config-driven code construction inside `cmdAgentSkills`
 * (`src/init.cts`'s `#2454` fallback), not by a literal path named in workflow prose. See
 * that helper's module docstring and the `AGENTS_ROOT` constant for why this file does not
 * call `checkReachability`.
 *
 * That code seam is not a per-file property (there is no per-file literal path to search
 * markdown for — one generic construction in `cmdAgentSkills` serves every registered pair),
 * so it is not checked here as a source-shape assertion. It is proven the way this repo
 * requires (`local/no-source-grep`, "behavioral tests are required") by
 * `tests/agent-skills.test.cjs`'s "#4407 compact payload selection" describe block, which
 * actually spawns `gsd_run agent-skills` against a real compact/canonical pair and asserts
 * on the served payload — a test that can only pass if the seam genuinely reads and returns
 * the compact file, which is a stronger guarantee than a string search over source text.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  AGENTS_ROOT,
  discoverRegisteredVariants,
  checkRegistration,
  checkProtectedContentPreserved,
  checkSizeSmaller,
} = require('./helpers/compact-content-variant.cjs');

describe('agent-skills compact variant guard — real repo state (ADR-4139, Phase 7 #4407)', () => {
  test('check 1 (registration): every agents/*.compact.md file has a canonical sibling', () => {
    const pairs = discoverRegisteredVariants([AGENTS_ROOT]);
    const violations = checkRegistration(pairs);
    assert.deepStrictEqual(violations, [], `registration violations: ${JSON.stringify(violations, null, 2)}`);
  });

  test('check 3 (protected content preserved): a canonical agent file\'s gsd:protected blocks, if any, survive in its compact sibling', () => {
    const pairs = discoverRegisteredVariants([AGENTS_ROOT]);
    const violations = checkProtectedContentPreserved(pairs);
    assert.deepStrictEqual(violations, [], `protected-content violations: ${JSON.stringify(violations, null, 2)}`);
  });

  test('check 4 (size smaller): every compact agent file is strictly smaller than its canonical sibling', () => {
    const pairs = discoverRegisteredVariants([AGENTS_ROOT]);
    const violations = checkSizeSmaller(pairs);
    assert.deepStrictEqual(violations, [], `size violations: ${JSON.stringify(violations, null, 2)}`);
  });

  test('every discovered pair is discoverable at all (non-vacuous guard)', () => {
    const pairs = discoverRegisteredVariants([AGENTS_ROOT]);
    assert.ok(pairs.length > 0, 'expected at least one agents/*.compact.md pair — a guard with nothing to check is not yet a guard');
  });
});
