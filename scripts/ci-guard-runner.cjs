'use strict';
// ci-guard-runner.cjs — Assert the current runner is github-hosted.
// Replaces the inline bash "Guard — require GitHub-hosted runner" step.
// Shell-agnostic: invoked as `node scripts/ci-guard-runner.cjs` from any shell.
//
// Exit 0 = github-hosted runner confirmed.
// Exit 1 = not a github-hosted runner (emits GitHub Actions error annotation).

const env = process.env.RUNNER_ENVIRONMENT || '';

if (env !== 'github-hosted') {
  process.stderr.write(
    `::error::Expected github-hosted runner. RUNNER_ENVIRONMENT=${env || 'unset'}\n`
  );
  process.exit(1);
}
