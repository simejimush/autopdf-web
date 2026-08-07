---
name: autopdf-verify-vercel-preview
description: Safely push an explicitly approved AutoPDF branch and verify its Vercel Preview deployment against an expected commit SHA, environment, URLs, runtime status, and Git synchronization. Use only when the user explicitly asks to push or verify a Preview; never use for Production promotion, Vercel configuration changes, or unapproved external writes.
---

# AutoPDF Vercel Preview Verification

## Overview

Tie one approved branch commit to one non-production deployment without changing service configuration or application data.

## Establish approval and expected state

Require the current request to identify or clearly authorize the branch push. Record the expected branch and commit SHA.

Before push, verify:

- local branch and `HEAD` match the expected values;
- tracked working tree is clean and staged count is zero;
- upstream ahead/behind is understood;
- the commit diff contains no unapproved DB/schema/migration, API, billing, environment, secret, or external-service change;
- required checks for the commit are already passing or are rerun as requested.

Stop if the branch, SHA, diff boundary, or approval is ambiguous.

## Push narrowly

When and only when explicitly authorized, push the current branch normally to the matching `origin` branch. Never force push, rebase, merge, push `main`, or promote a deployment.

After push, confirm local and remote branch SHAs match and ahead/behind is `0/0`.

## Verify deployment

Use an already available read-only path in this order:

1. an installed and connected Vercel tool with read-only deployment access;
2. an already authenticated Vercel CLI without changing login, project link, or configuration;
3. an existing signed-in browser session.

Do not install a plugin, start login or OAuth, expand permissions, link a project, or modify Vercel settings. If none of the read-only paths works, report the exact approval or connection needed and stop.

Confirm all of the following from deployment evidence:

- deployment status is Ready;
- environment is Preview and Production deployment is false;
- deployment commit SHA equals the expected full SHA;
- branch-fixed URL resolves to the latest deployment for the branch;
- commit-specific deployment URL is identified;
- available runtime status shows no deployment-level error.

Do not run Cron, manual Run, OAuth reconnect, billing actions, data deletion, or any other state-changing smoke test unless separately authorized. Do not expose raw logs, provider bodies, tokens, secrets, or identifiers beyond the requested commit and public Preview URLs.

## Report

Include pre-push Git state, verification results, push result, local and remote SHA, deployment status, environment, Production yes/no, branch URL, commit URL, ahead/behind, final working-tree state, and confirmation that no other external change occurred. If blocked, identify the unmet condition without attempting a workaround that expands authority.
