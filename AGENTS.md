# AutoPDF Agent Instructions

This is a production SaaS project.
Security, RLS correctness, and auditability are higher priority than speed of implementation.

The project MUST follow the rules defined in:
/docs/quality-rules.md

If there is any conflict, security and data isolation rules take precedence.

---

# Core Principles

1. Never break user data isolation.
2. Never bypass RLS assumptions.
3. Never swallow errors silently.
4. Always record important operations in `runs`.

---

# Database Rules

- All user data must be tied to `user_id`.
- All queries must assume RLS is active.
- Do not introduce tables without user ownership unless explicitly public.
- Never expose cross-user data.

---

# API Rules

- All APIs must validate authentication.
- Unauthorized access must return 401.
- Input must be validated before DB access.
- Do not trust query parameters blindly.

---

# Cron Rules

- Cron endpoints must require a secret.
- Cron should delegate to shared execution logic.
- Cron must never expose internal state.

---

# Google API Rules

- Assume Google API calls can fail at any time.
- Do not log tokens or secrets.
- Handle token expiration gracefully.
- All failures must update `runs` with `status=error` and a clear `error_code`.

---

# Logging Rules

- Critical operations must be recorded in `runs`.
- Error messages must not contain secrets.
- Avoid console.log for sensitive data.

---

# Code Structure Rules

- Avoid duplicating business logic.
- Keep Route handlers thin.
- Put core logic into reusable functions under `/lib`.

---

# Performance Rules

- Avoid `SELECT *`.
- Fetch only required fields.
- Assume `runs` table will grow large.

---

# UI / Frontend Rules

- This project does NOT use Tailwind.
- Use CSS Modules for styling.
- Prefer Japanese UI labels when possible.
- Avoid large UI refactors.
- Do not introduce new UI frameworks.

---

# AI Development Workflow (CRITICAL)

To prevent wasted time, repeated suggestions, and incorrect assumptions,
AI must follow the workflow below.

---

## 1. Inspect before proposing changes

AI must **inspect real code or screenshots first**.

Never propose speculative fixes.

Incorrect workflow:
