---
name: autopdf-verify-change
description: Select and run proportionate verification for an AutoPDF repository diff, including targeted Playwright tests, contract checks, TypeScript, ESLint, Prettier, build, diff review, and secret detection. Use after AutoPDF code, test, configuration, Skill, or documentation changes and before committing or handing off; do not use to deploy or mutate external services.
---

# AutoPDF Change Verification

## Overview

Verify the behavior affected by the diff without defaulting to every expensive check.

## Build the verification plan

1. Read `AGENTS.md`, `docs/quality-rules.md`, and `docs/dev-rules.md`.
2. Inspect unstaged, staged, and untracked intended files. Do not assume `HEAD` alone contains the complete change.
3. Read [verification-matrix.md](references/verification-matrix.md) and map every changed area to tests and contract checks.
4. Start with the narrowest reliable checks. Escalate to broader Playwright or build verification only when failures, shared boundaries, release risk, or the matrix justify it.
5. State the selected checks and why omitted expensive checks are unnecessary.

## Execute safely

- Run tests with the repository's existing toolchain and lockfile; do not install or update dependencies.
- Keep Playwright workers at the repository default and avoid unrelated parallel heavy jobs.
- Run TypeScript for TypeScript, TSX, type, route, or configuration changes.
- Run ESLint on changed supported source and test files. Use the full lint command only for broad changes or when targeted lint is unreliable.
- Run Prettier in check mode on changed supported files. Do not reformat unrelated files.
- Run `git diff --check` before commit.
- Scan only intended changed content for secret-like material. Report the file and finding category, never a matched value or raw token.
- Never read `.env` or secret files to perform a scan.

If a selected check fails because of the current change, diagnose, make the smallest in-scope fix, and rerun the failed check plus any newly affected checks. Clearly separate unrelated pre-existing failures.

## Confirm contracts

For sensitive areas, verify behavior rather than only test names:

- authentication and user ownership remain enforced;
- database access remains RLS-compatible and avoids `SELECT *`;
- `runs.status`, `runs.message`, and `error_code` contracts remain intentional;
- Google, Stripe, and provider errors do not expose secrets or raw bodies;
- notification secondary failures do not replace the primary execution result;
- no migration, environment, dependency, or external configuration change slipped into the diff.

## Report

List each command or check, pass/fail and test count when available, fixes made after failures, contract evidence, skipped checks with rationale, `git diff --check`, secret-scan outcome, and remaining risks. Do not claim a check ran when it was only inferred.
