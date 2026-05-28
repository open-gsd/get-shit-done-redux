'use strict';
// ci-smoke-skip.cjs — Set the "skip" output for full-only matrix entries on PR events.
// Replaces the inline bash "Skip full-only matrix entry on PR" step.
// Shell-agnostic: invoked as `node scripts/ci-smoke-skip.cjs` from any shell.
//
// Required environment variables (set by the workflow step's `env:` block):
//   EVENT     — github.event_name value
//   FULL_ONLY — matrix.full_only value ("true" | "false")
//
// Writes to GITHUB_OUTPUT:
//   skip=true   if EVENT == "pull_request" AND FULL_ONLY == "true"
//   skip=false  otherwise

const fs = require('fs');

const event    = process.env.EVENT     || '';
const fullOnly = process.env.FULL_ONLY || '';
const output   = process.env.GITHUB_OUTPUT || '';

const skip = (event === 'pull_request' && fullOnly === 'true') ? 'true' : 'false';

if (output) {
  fs.appendFileSync(output, `skip=${skip}\n`, 'utf-8');
} else {
  // Fallback for local testing without GITHUB_OUTPUT set.
  process.stdout.write(`skip=${skip}\n`);
}
