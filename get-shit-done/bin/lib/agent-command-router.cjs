'use strict';

const { output, error, ERROR_REASON } = require('./core.cjs');

const QUOTA_SENTINELS = [
  '429',
  'usage_limit_reached',
  'usage limit',
  'rate limit',
  'rate-limited',
  'rate_limit',
  'resource_exhausted',
  'quota',
  'too many requests',
  'exceeded your',
];

const CLASSIFY_HANDOFF_SENTINEL = 'classifyhandoffifneeded is not defined';

function parseRetryAfter(body) {
  const match = String(body || '').match(/\bretry[-_ ]after[:\s]+(\d+)\b/i);
  if (!match) return undefined;
  const seconds = Number.parseInt(match[1], 10);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function classifyAgentFailure(body) {
  const normalized = String(body || '').toLowerCase();
  if (normalized.trim() === '') {
    return { class: 'unknown-failure' };
  }

  for (const sentinel of QUOTA_SENTINELS) {
    if (normalized.includes(sentinel)) {
      const retryAfterSeconds = parseRetryAfter(body);
      return retryAfterSeconds === undefined
        ? { class: 'quota-exceeded', sentinel }
        : { class: 'quota-exceeded', sentinel, retryAfterSeconds };
    }
  }

  if (normalized.includes(CLASSIFY_HANDOFF_SENTINEL)) {
    return {
      class: 'classify-handoff-bug',
      sentinel: CLASSIFY_HANDOFF_SENTINEL,
    };
  }

  return { class: 'unknown-failure' };
}

function routeAgentCommand({ args, raw }) {
  const subcommand = args[1];
  if (subcommand !== 'classify-failure') {
    error('Unknown agent subcommand. Available: classify-failure', ERROR_REASON.SDK_UNKNOWN_COMMAND);
  }

  const bodyArgs = args.slice(2).filter((arg) => arg !== '--');
  output(classifyAgentFailure(bodyArgs.join(' ')), raw);
}

module.exports = {
  classifyAgentFailure,
  routeAgentCommand,
};
