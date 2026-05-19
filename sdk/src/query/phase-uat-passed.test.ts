/**
 * Unit tests for isPhaseUatPassed — walking skeleton (cycle 1 of ~15).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isPhaseUatPassed, REASON_CODE } from './phase-uat-passed.js';

const UAT_PASS_CONTENT = `---
status: complete
phase: 5
source: roadmap
started: 2026-05-18T00:00:00Z
updated: 2026-05-18T00:00:00Z
---

### 1. First item
expected: thing should happen
result: pass
`;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gsd-uat-passed-'));
  const phaseDir = join(tmpDir, '.planning', 'phases', '05-walking-skeleton');
  await mkdir(phaseDir, { recursive: true });
  await writeFile(join(phaseDir, '05-HUMAN-UAT.md'), UAT_PASS_CONTENT);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('isPhaseUatPassed', () => {
  it('returns passed=true when a single UAT file contains one pass result', async () => {
    const result = await isPhaseUatPassed(tmpDir, '5');
    expect(result.passed).toBe(true);
    expect(result.items.length).toBe(1);
    expect(result.items[0].result).toBe('pass');
    expect(result.reasons.length).toBe(0);
  });

  it('returns passed=false with NO_UAT_FILES reason when phase dir has no UAT files', async () => {
    const localTmp = await mkdtemp(join(tmpdir(), 'gsd-uat-c4-'));
    try {
      const phaseDir = join(localTmp, '.planning', 'phases', '05-empty');
      await mkdir(phaseDir, { recursive: true });
      // Write a non-UAT file to ensure the dir exists but has no *-HUMAN-UAT.md
      await writeFile(join(phaseDir, '05-PLAN.md'), '# Plan\nNothing here.\n');

      const result = await isPhaseUatPassed(localTmp, '5');
      expect(result.passed).toBe(false);
      expect(result.items.length).toBe(0);
      expect(result.reasons.length).toBe(1);
      expect(result.reasons[0].code).toBe(REASON_CODE.NO_UAT_FILES);
    } finally {
      await rm(localTmp, { recursive: true, force: true });
    }
  });

  it('returns passed=false with NO_PHASE_DIR reason when phase has no directory', async () => {
    const localTmp = await mkdtemp(join(tmpdir(), 'gsd-uat-c3-'));
    try {
      const otherPhaseDir = join(localTmp, '.planning', 'phases', '06-other');
      await mkdir(otherPhaseDir, { recursive: true });
      await writeFile(join(otherPhaseDir, '06-HUMAN-UAT.md'), UAT_PASS_CONTENT);

      // Query phase 5 which has NO directory in this fixture
      const result = await isPhaseUatPassed(localTmp, '5');
      expect(result.passed).toBe(false);
      expect(result.items.length).toBe(0);
      expect(result.reasons.length).toBe(1);
      expect(result.reasons[0].code).toBe(REASON_CODE.NO_PHASE_DIR);
    } finally {
      await rm(localTmp, { recursive: true, force: true });
    }
  });

  it('returns passed=false with NON_PASS_RESULT reason when single UAT item has result: issue', async () => {
    const nonPassContent = `---
status: complete
phase: 5
source: roadmap
started: 2026-05-18T00:00:00Z
updated: 2026-05-18T00:00:00Z
---

### 1. Some item
expected: thing happens
result: issue
`;
    const localTmp = await mkdtemp(join(tmpdir(), 'gsd-uat-c2-'));
    try {
      const phaseDir = join(localTmp, '.planning', 'phases', '05-non-pass');
      await mkdir(phaseDir, { recursive: true });
      await writeFile(join(phaseDir, '05-HUMAN-UAT.md'), nonPassContent);

      const result = await isPhaseUatPassed(localTmp, '5');
      expect(result.passed).toBe(false);
      expect(result.items.length).toBe(1);
      expect(result.reasons.length).toBe(1);
      expect(result.reasons[0].code).toBe(REASON_CODE.NON_PASS_RESULT);
      expect(result.reasons[0].capturedValue).toBe('issue');
      expect(result.reasons[0].itemName).toBe('Some item');
    } finally {
      await rm(localTmp, { recursive: true, force: true });
    }
  });

  it('ignores ### item content inside YAML frontmatter region', async () => {
    const localTmp = await mkdtemp(join(tmpdir(), 'gsd-uat-c5-'));
    try {
      const phaseDir = join(localTmp, '.planning', 'phases', '05-frontmatter-injection');
      await mkdir(phaseDir, { recursive: true });
      const content = `---
status: complete
phase: 5
source: roadmap
started: 2026-05-18T00:00:00Z
updated: 2026-05-18T00:00:00Z
malicious_demo: |
### 1. Frontmatter-injected item
expected: nothing
result: pass
---

### 1. Real item
expected: real thing
result: pass
`;
      await writeFile(join(phaseDir, '05-HUMAN-UAT.md'), content);

      const result = await isPhaseUatPassed(localTmp, '5');
      expect(result.passed).toBe(true);
      expect(result.items.length).toBe(1);
      expect(result.items[0].name).toBe('Real item');
    } finally {
      await rm(localTmp, { recursive: true, force: true });
    }
  });
});
