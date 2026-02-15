# AutoPDF - Architecture Overview

## 1. Tech Stack

- Next.js (App Router)
- Supabase (Auth + Postgres)
- Google APIs (Gmail / Drive)
- Vercel (Hosting + Cron Jobs)

---

## 2. Directory Structure (重要パスのみ)

### API Routes

- app/api/cron/route.ts
- app/api/rules/route.ts
- app/api/rules/[id]/route.ts
- app/api/rules/[id]/run/route.ts
- app/api/google/connect/route.ts

### Google Logic

- lib/google/auth.ts
- lib/google/gmail.ts
- lib/google/drive.ts

### Rules Logic

- src/lib/rules/status.ts

---

## 3. Database Tables (Supabase)

- users
- google_connections
- rules
- runs

---

## 4. Cron Job Configuration

### vercel.json

```json
{
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "0 0 * * *"
    }
  ]
}
