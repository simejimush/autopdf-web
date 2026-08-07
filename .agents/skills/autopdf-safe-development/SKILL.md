---
name: autopdf-safe-development
description: Safely implement or modify code, tests, or documentation in the AutoPDF repository with autonomous Git preflight, protected-surface checks, scoped verification, explicit approval gates, one-purpose commits, and final status reporting. Use for AutoPDF implementation, fixes, refactors, test additions, or repository workflow changes; do not use for a purely read-only answer or for performing an already-approved deployment check.
---

# AutoPDF Safe Development

Keep repository changes small, reversible, and auditable while avoiding unnecessary confirmation stops.

## Establish the contract

1. Read the repository-root `AGENTS.md` and every instruction file it requires, including `docs/quality-rules.md` and `docs/dev-rules.md`.
2. Treat those files as authoritative for AutoPDF architecture and data-safety rules. This skill supplies procedure and never weakens repository policy.
3. State the files or areas in scope and the protected areas that will remain untouched before a multi-file change.
4. Do not read `.env` files, credentials, tokens, or secret values. File names and placeholder variable names may be inventoried without reading their values.

## Run preflight

Capture and retain for the final report:

- repository root, current branch, exact `HEAD`, and configured upstream;
- working-tree and staged state;
- ahead/behind counts when an upstream exists;
- relevant existing instructions, code, tests, and configuration.

Preserve user-owned changes. If unrelated changes exist, work around them. Ask only when the requested edit overlaps changes that cannot safely be preserved.

## Classify authority

Proceed autonomously with normal repository-local code edits, tests, Markdown, and a one-purpose commit when they are reversible and within the user's goal.

Stop before any of these actions unless the current user request explicitly authorizes the exact action:

- push, merge, rebase, force push, production deployment, or promotion;
- external-service write, login, OAuth consent, permission expansion, or settings change;
- Supabase or other database write, migration apply, destructive data operation, or production access;
- Vercel environment change, Stripe change, Google Cloud or OAuth change, Cron execution, or manual Run against Preview/Production;
- dependency addition or update, `.env` or secret change, file deletion, or large architecture change.

Never broaden a narrow approval. Read-only inspection does not authorize a later write.

## Implement and recover

1. Inspect actual code and tests before editing; do not infer behavior from file names.
2. Make the smallest coherent change and preserve current UI behavior, API contracts, RLS assumptions, `runs` audit behavior, and `error_code` semantics unless explicitly in scope.
3. Do not combine UI layout changes with API, business-logic, or state-management changes.
4. If an in-scope validation failure has an evident cause, diagnose, fix, and rerun without returning for a minor decision.
5. Stop when resolution needs new authority, a materially different product choice, secret access, or an external state change.

## Verify and commit

Use `$autopdf-verify-change` after implementation. Select checks from the actual diff; do not run expensive suites mechanically.

Then:

1. Review the complete diff and confirm protected surfaces were not changed.
2. Stage only explicit intended paths; never use `git add .`.
3. Create one commit for the one stated purpose.
4. Recheck `HEAD`, working tree, staged files, and upstream divergence.
5. Do not push unless the user explicitly requested it.

## Report

Lead with the outcome. Include preflight Git state, changed files, preserved protected areas, checks run and results, skipped checks with reasons, commit SHA, final working-tree state, push status, and any approval boundary reached.
