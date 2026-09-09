/**
 * Manifest-backed verify subcommand router.
 * Keeps gsd-tools.cjs thin while preserving existing command semantics.
 *
 * ADR-457 build-at-publish: the hand-written bin/lib/verify-command-router.cjs
 * collapsed to a TypeScript source of truth. Behaviour is preserved byte-for-behaviour
 * from the prior hand-written .cjs; only types are added.
 */

import { VERIFY_SUBCOMMANDS } from './command-aliases.cjs';
import { parseNamedArgsOrExit } from './command-arg-projection.cjs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cjsCommandRouterAdapter = require('./cjs-command-router-adapter.cjs');
const { routeCjsCommandFamily } = cjsCommandRouterAdapter;

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerifyModule {
  cmdVerifyPlanStructure(cwd: string, phase: string | undefined, raw: boolean): void;
  cmdVerifyPhaseCompleteness(cwd: string, phase: string | undefined, raw: boolean): void;
  cmdVerifyReferences(cwd: string, phase: string | undefined, raw: boolean): void;
  cmdVerifyCommits(cwd: string, args: string[], raw: boolean): void;
  cmdVerifyArtifacts(cwd: string, phase: string | undefined, raw: boolean): void;
  cmdVerifyKeyLinks(cwd: string, phase: string | undefined, raw: boolean): void;
  cmdVerifySchemaDrift(cwd: string, phase: string | undefined, skip: boolean, raw: boolean, workstream?: string): void;
  cmdVerifyCodebaseDrift(cwd: string, raw: boolean): void;
  cmdVerifyContextDrift(cwd: string, phase: string | undefined, raw: boolean): void;
}

interface RouteVerifyCommandOptions {
  verify: VerifyModule;
  args: string[];
  cwd: string;
  raw: boolean;
  error: (message: string) => void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

function routeVerifyCommand({ verify, args, cwd, raw, error }: RouteVerifyCommandOptions): void {
  routeCjsCommandFamily({
    args,
    subcommands: VERIFY_SUBCOMMANDS,
    unsupported: {},
    error,
    unknownMessage: (_subcommand: string, available: string[]) => `Unknown verify subcommand. Available: ${available.join(', ')}`,
    handlers: {
      'plan-structure': () => verify.cmdVerifyPlanStructure(cwd, args[2], raw),
      'phase-completeness': () => verify.cmdVerifyPhaseCompleteness(cwd, args[2], raw),
      references: () => verify.cmdVerifyReferences(cwd, args[2], raw),
      commits: () => verify.cmdVerifyCommits(cwd, args.slice(2), raw),
      artifacts: () => verify.cmdVerifyArtifacts(cwd, args[2], raw),
      'key-links': () => verify.cmdVerifyKeyLinks(cwd, args[2], raw),
      'schema-drift': () => {
        const named = parseNamedArgsOrExit(
          args,
          { valueFlags: ['ws'], booleanFlags: ['skip'], positionals: 3 },
          error,
        );
        const workstream = typeof named.ws === 'string' ? named.ws : undefined;
        verify.cmdVerifySchemaDrift(cwd, args[2], named.skip === true, raw, workstream);
      },
      // verify codebase-drift dispatches direct to CJS — drift is out-of-seam
      // per ADR/PRD 3524 §3 / L160 (CJS-only by design). Routing through
      // recursive dispatch would re-enter this router path.
      'codebase-drift': () => verify.cmdVerifyCodebaseDrift(cwd, raw),
      'context-drift': () => verify.cmdVerifyContextDrift(cwd, args[2], raw),
    },
  });
}

export = {
  routeVerifyCommand,
};
