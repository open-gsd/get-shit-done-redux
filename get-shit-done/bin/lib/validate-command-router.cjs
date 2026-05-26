'use strict';

const { VALIDATE_SUBCOMMANDS } = require('./command-aliases.cjs');
const { formatGsdSlash, resolveRuntime } = require('./runtime-slash.cjs');
const { routeCjsCommandFamily } = require('./cjs-command-router-adapter.cjs');

/**
 * Manifest-backed validate subcommand router.
 * Keeps gsd-tools.cjs thin while preserving existing command semantics.
 */
function routeValidateCommand({ verify, args, cwd, raw, parseNamedArgs, output: outputFn, error }) {
  routeCjsCommandFamily({
    args,
    subcommands: VALIDATE_SUBCOMMANDS,
    unsupported: {},
    error,
    unknownMessage: (_subcommand, available) => `Unknown validate subcommand. Available: ${available.join(', ')}`,
    handlers: {
      consistency: () => verify.cmdValidateConsistency(cwd, raw),
      // Keep health on CJS for now so fix hints are rendered via runtime-slash
      // helpers (codex expects $gsd-* command shape).
      health: () => {
        const repairFlag = args.includes('--repair');
        const backfillFlag = args.includes('--backfill');
        verify.cmdValidateHealth(cwd, { repair: repairFlag, backfill: backfillFlag }, raw);
      },
      agents: () => verify.cmdValidateAgents(cwd, raw),
      context: () => {
        const opts = parseNamedArgs(args, ['tokens-used', 'context-window']);
        if (opts['tokens-used'] === null) {
          error('--tokens-used <integer> is required for `validate context`');
          return;
        }
        if (opts['context-window'] === null) {
          error('--context-window <integer> is required for `validate context`');
          return;
        }
        const { classifyContextUtilization, STATES } = require('./context-utilization.cjs');
        const threadCmd = formatGsdSlash('thread', resolveRuntime(cwd));
        const RECOMMENDATIONS = {
          [STATES.HEALTHY]: null,
          [STATES.WARNING]: `Context is approaching the fracture zone — consider ${threadCmd} to continue in a fresh window.`,
          [STATES.CRITICAL]: `Reasoning quality may degrade past 70% utilization (fracture point). Run ${threadCmd} now to preserve output quality.`,
        };
        let classified;
        try {
          classified = classifyContextUtilization(Number(opts['tokens-used']), Number(opts['context-window']));
        } catch (e) {
          const flag = /tokensUsed/.test(e.message) ? '--tokens-used' : '--context-window';
          error(`${flag} must be a non-negative integer (window > 0), got the values supplied`);
          return;
        }
        const result = { ...classified, recommendation: RECOMMENDATIONS[classified.state] };
        if (args.includes('--json')) {
          outputFn(result, raw);
        } else {
          const lines = [`Context utilization: ${result.percent}% (${result.state})`];
          if (result.recommendation) lines.push(result.recommendation);
          outputFn(result, true, lines.join('\n'));
        }
      },
    },
  });
}

module.exports = {
  routeValidateCommand,
};
