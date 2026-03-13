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
```

## Run Execution Flow

Rule実行の処理フロー

Rule Run
↓
Gmail検索 (gmail_query)
↓
メール取得 (Gmail API)
↓
PDF生成 (pdf-lib)
↓
Google Drive保存
↓
processed_emails記録
↓
runs更新
