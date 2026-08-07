# AutoPDF verification matrix

Select every row touched by the diff. Add checks when a shared dependency crosses rows.

| Changed area                                       | Required focused checks                                                                                            | Escalate when                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| UI copy, toast, or presentation-only helper        | Direct UI/helper spec, targeted ESLint, TypeScript, Prettier                                                       | Run related page/browser coverage when interaction or state changed                        |
| React interaction, form, button, routing, or state | Component/page specs, targeted ESLint, TypeScript, Prettier                                                        | Run broader Playwright when a common navigation or authenticated flow changed              |
| API route or input validation                      | Matching route spec plus auth, ownership, status, and response-contract cases; TypeScript and ESLint               | Add repository/domain specs when the route delegates to changed logic                      |
| Repository or domain logic                         | Matching repository specs plus success, empty, duplicate/idempotent, and failure cases                             | Add route specs for changed externally visible behavior                                    |
| Manual Run or Cron                                 | Matching manual/cron specs; `runs` fields, `error_code`, idempotency, and notification-secondary-failure contracts | Run both paths when shared execution logic changed                                         |
| Google OAuth, token, Gmail, or Drive               | Matching Google specs; redaction, reauth, user ownership, and credential-version contracts                         | Treat callback, token store, and Drive save as high risk; broaden to all related specs     |
| Billing or Stripe                                  | Checkout/webhook/billing specs; auth, plan limits, idempotency, and sanitized errors                               | Build and broader tests when runtime or dependency/config boundaries changed               |
| Supabase query, RLS, schema, or migration          | Repository specs and migration contract specs; explicit `user_id`, selected columns, rollback/compatibility review | Stop before applying a migration or remote DB write without exact approval                 |
| Monitoring or notifications                        | `error_code` mapping, primary-result preservation, Slack/email secondary-failure tests, sanitized logs             | Add Manual Run and Cron tests when shared monitoring logic changed                         |
| Configuration, dependency, or Next.js runtime      | TypeScript, ESLint as applicable, focused tests, and build                                                         | Dependency changes require prior approval; run build for runtime/deploy boundaries         |
| Docs, `AGENTS.md`, or repo-local Skills only       | Skill validation, link/path review, Prettier or Markdown check if configured, `git diff --check`                   | Do not run app tests, TypeScript, or build unless instructions or code/config also changed |

Always inspect the complete diff, check for unintended migration/environment/secret/dependency changes, and record why full Playwright or build was skipped.
