# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **security@gsd.build** (or DM @glittercowboy on Discord/Twitter if email bounces)

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix timeline**: Depends on severity, but we aim for:
  - Critical: 24-48 hours
  - High: 1 week
  - Medium/Low: Next release

## Scope

Security issues in the GSD codebase that could:
- Execute arbitrary code on user machines
- Expose sensitive data (API keys, credentials)
- Compromise the integrity of generated plans/code

## Recognition

We appreciate responsible disclosure and will credit reporters in release notes (unless you prefer to remain anonymous).

## Org-level security baseline

This file covers how to report individual vulnerabilities. For the broader
org-wide security posture — scanner controls, incident-audit checklists,
ownership model, and rollout plan — see:

[`docs/security/baseline.md`](docs/security/baseline.md)
