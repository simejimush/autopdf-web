// app/rules/page.tsx
import React from "react";
import { getRuleStatus } from "../../src/lib/rules/status";
import RunButton from "./RunButton";
import CopyButton from "./CopyButton";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

type RunLite = {
  id: string;
  status: string;
  message: string | null;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
  saved_count: number;
  processed_count: number;
};

type Rule = {
  id: string;
  is_active: boolean;
  run_timing: string | null;
  drive_folder_id: string | null;
  gmail_query: string | null;
  updated_at: string | null;
  // ✅ 一覧は runs を持たない（重くなるので）
  runs?: never;
};

// ---- 日本語ラベル（固定）----
const LABEL = {
  title: "ルール",
  newRule: "＋ ルールを作成",
  active: "有効",
  runTiming: "実行タイミング",
  gmailQuery: "検索条件",
  driveFolder: "保存先フォルダ",
  lastRun: "最終実行",
  updated: "更新日時",
  action: "操作",
  edit: "編集",
  run: "実行",
  copy: "コピー",
  none: "まだルールがありません",
} as const;

function normalizeQuery(q: unknown) {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s || s === "-") return null;
  return s;
}

function truncate(s: string, max = 80) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function fmtTokyo(iso: string | null | undefined) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  } catch {
    return iso;
  }
}

function statusJa(s: string) {
  if (s === "ready") return "準備完了";
  if (s === "disabled") return "無効";
  if (s === "needs_setup") return "未設定";
  if (s === "success") return "成功";
  if (s === "error") return "エラー";
  return s;
}

function reasonsTextOf(status: unknown) {
  if (
    status &&
    typeof status === "object" &&
    "reasons" in status &&
    Array.isArray((status as any).reasons)
  ) {
    const arr = (status as any).reasons as string[];
    return arr.length ? arr.join(" / ") : "";
  }
  return "";
}

function pill(kind: "muted" | "warn" | "ok" | "err") {
  const base: React.CSSProperties = {
    padding: "2px 10px",
    fontSize: 12,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    lineHeight: 1.6,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    whiteSpace: "nowrap",
  };
  if (kind === "warn")
    return { ...base, borderColor: "#f59e0b", color: "#b45309" };
  if (kind === "ok")
    return { ...base, borderColor: "#22c55e", color: "#15803d" };
  if (kind === "err")
    return { ...base, borderColor: "#ef4444", color: "#b91c1c" };
  return base;
}

export default async function RulesPage() {
  // ---- rules ----
  const h = await headers();
  const host = h.get("host");
  if (!host && !process.env.APP_URL && !process.env.VERCEL_URL) {
    throw new Error("Missing host/APP_URL/VERCEL_URL");
  }
  const proto =
    h.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");

  const baseUrl =
    process.env.APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `${proto}://${host}`);

  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${baseUrl}/api/rules`, {
    cache: "no-store",
    headers: { cookie },
  });

  if (res.status === 401) redirect("/login");

  let json: { data: Rule[]; error?: string };
  try {
    json = await res.json();
  } catch {
    json = { data: [], error: "Invalid JSON response" };
  }

  if (json.error) {
    return (
      <main className="page">
        <style>{styles}</style>
        <div className="container">
          <h1 className="h1">{LABEL.title}</h1>
          <pre className="error">error: {json.error}</pre>
        </div>
      </main>
    );
  }

  const rules = json.data ?? [];

  // ---- latest runs (per rule) ----
  const latestRes = await fetch(`${baseUrl}/api/runs/latest`, {
    cache: "no-store",
    headers: { cookie },
  });
  const latestJson = await latestRes.json();
  const latestByRule: Record<string, RunLite | null> = latestJson?.data ?? {};

  return (
    <main className="page">
      <style>{styles}</style>

      <div className="container">
        <div className="header">
          <h1 className="h1">{LABEL.title}</h1>
          <a className="btnPrimary" href="/rules/new">
            {LABEL.newRule}
          </a>
        </div>

        {/* PC: テーブル */}
        <div className="onlyDesktop">
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{LABEL.active}</th>
                  <th>{LABEL.runTiming}</th>
                  <th>{LABEL.gmailQuery}</th>
                  <th>{LABEL.driveFolder}</th>
                  <th>{LABEL.lastRun}</th>
                  <th>{LABEL.updated}</th>
                  <th>{LABEL.action}</th>
                </tr>
              </thead>

              <tbody>
                {rules.map((r) => {
                  const q = normalizeQuery(r.gmail_query);
                  const displayQuery = q ?? "(generated)";
                  const status = getRuleStatus(r);
                  const reasonsText = reasonsTextOf(status);

                  const isMissing = status.status === "needs_setup";
                  const lastRun = latestByRule[r.id] ?? null;

                  const lastRunText = lastRun
                    ? [
                        statusJa(lastRun.status),
                        lastRun.finished_at
                          ? fmtTokyo(lastRun.finished_at)
                          : null,
                        lastRun.processed_count || lastRun.saved_count
                          ? `${lastRun.saved_count}/${lastRun.processed_count}`
                          : null,
                        lastRun.message ? truncate(lastRun.message, 30) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "-";

                  const lastRunTitle = lastRun
                    ? [
                        statusJa(lastRun.status),
                        lastRun.finished_at
                          ? fmtTokyo(lastRun.finished_at)
                          : null,
                        lastRun.processed_count || lastRun.saved_count
                          ? `${lastRun.saved_count}/${lastRun.processed_count}`
                          : null,
                        lastRun.message ? lastRun.message : null,
                        lastRun.error_code
                          ? `code=${lastRun.error_code}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "-";

                  const lastRunKind =
                    lastRun?.status === "success"
                      ? "ok"
                      : lastRun?.status === "error"
                      ? "err"
                      : "muted";

                  const readyKind =
                    status.status === "ready"
                      ? "ok"
                      : status.status === "needs_setup"
                      ? "warn"
                      : "muted";

                  return (
                    <tr key={r.id} className={isMissing ? "rowDim" : ""}>
                      <td>
                        <span
                          style={
                            r.is_active && !isMissing
                              ? pill("ok")
                              : pill("muted")
                          }
                        >
                          {r.is_active && !isMissing ? "有効" : "無効"}
                        </span>

                        <span style={pill(readyKind)} title={reasonsText}>
                          {statusJa(status.status)}
                        </span>
                      </td>

                      <td className="mono">{r.run_timing ?? "-"}</td>

                      <td className="mono">
                        {isMissing ? (
                          <span title={reasonsText} className="warnText">
                            ⚠ 未設定
                            {reasonsText ? `（${reasonsText}）` : ""}
                          </span>
                        ) : (
                          <span title={displayQuery} className="help">
                            {truncate(displayQuery, 90)}
                          </span>
                        )}
                      </td>

                      <td className="mono" title={r.drive_folder_id ?? ""}>
                        {r.drive_folder_id
                          ? truncate(r.drive_folder_id, 24)
                          : "-"}
                      </td>

                      <td title={lastRunTitle}>
                        <span style={pill(lastRunKind)}>{lastRunText}</span>
                      </td>

                      <td title={r.updated_at ?? ""} className="muted">
                        {fmtTokyo(r.updated_at)}
                      </td>

                      <td>
                        <div className="actions">
                          <RunButton
                            ruleId={r.id}
                            disabled={status.status !== "ready"}
                          />
                          <a className="link" href={`/rules/${r.id}`}>
                            {LABEL.edit}
                          </a>
                          <CopyButton text={displayQuery} />
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {rules.length === 0 && (
                  <tr>
                    <td colSpan={7} className="emptyCell">
                      {LABEL.none}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* スマホ: カード */}
        <div className="onlyMobile">
          <div className="cards">
            {rules.map((r) => {
              const q = normalizeQuery(r.gmail_query);
              const displayQuery = q ?? "(generated)";
              const status = getRuleStatus(r);
              const reasonsText = reasonsTextOf(status);

              const isMissing = status.status === "needs_setup";
              const lastRun = latestByRule[r.id] ?? null;

              const lastRunText = lastRun
                ? [
                    statusJa(lastRun.status),
                    lastRun.finished_at ? fmtTokyo(lastRun.finished_at) : null,
                    lastRun.processed_count || lastRun.saved_count
                      ? `${lastRun.saved_count}/${lastRun.processed_count}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "-";

              const readyKind =
                status.status === "ready"
                  ? "ok"
                  : status.status === "needs_setup"
                  ? "warn"
                  : "muted";

              const runKind =
                lastRun?.status === "success"
                  ? "ok"
                  : lastRun?.status === "error"
                  ? "err"
                  : "muted";

              return (
                <div
                  key={r.id}
                  className={`card ${isMissing ? "cardDim" : ""}`}
                >
                  <div className="cardTop">
                    <div className="cardPills">
                      <span
                        style={
                          r.is_active && !isMissing ? pill("ok") : pill("muted")
                        }
                      >
                        {r.is_active && !isMissing ? "有効" : "無効"}
                      </span>
                      <span style={pill(readyKind)} title={reasonsText}>
                        {statusJa(status.status)}
                      </span>
                    </div>
                    <div className="cardMeta">
                      <div className="metaLine">
                        <span className="metaKey">{LABEL.lastRun}</span>
                        <span style={pill(runKind)}>{lastRunText}</span>
                      </div>
                      <div className="metaLine">
                        <span className="metaKey">{LABEL.updated}</span>
                        <span className="muted">{fmtTokyo(r.updated_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="cardBody">
                    <div className="field">
                      <div className="fieldKey">{LABEL.runTiming}</div>
                      <div className="fieldVal mono">{r.run_timing ?? "-"}</div>
                    </div>

                    <div className="field">
                      <div className="fieldKey">{LABEL.gmailQuery}</div>
                      <div className="fieldVal mono">
                        {isMissing ? (
                          <span title={reasonsText} className="warnText">
                            ⚠ 未設定
                            {reasonsText ? `（${reasonsText}）` : ""}
                          </span>
                        ) : (
                          <span title={displayQuery} className="help">
                            {truncate(displayQuery, 120)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="field">
                      <div className="fieldKey">{LABEL.driveFolder}</div>
                      <div
                        className="fieldVal mono"
                        title={r.drive_folder_id ?? ""}
                      >
                        {r.drive_folder_id
                          ? truncate(r.drive_folder_id, 40)
                          : "-"}
                      </div>
                    </div>
                  </div>

                  <div className="cardActions">
                    <RunButton
                      ruleId={r.id}
                      disabled={status.status !== "ready"}
                    />
                    <a className="btnGhost" href={`/rules/${r.id}`}>
                      {LABEL.edit}
                    </a>
                    <CopyButton text={displayQuery} />
                  </div>
                </div>
              );
            })}

            {rules.length === 0 && (
              <div className="emptyCard">{LABEL.none}</div>
            )}
          </div>
        </div>

        <p className="footnote">
          ※ いまは service role で取得（ログイン導線は後で置き換え）
        </p>
      </div>
    </main>
  );
}

const styles = `
:root{
  --bg:#f7f8fb;
  --surface:#ffffff;
  --border:#e5e7eb;
  --text:#111827;
  --muted:#6b7280;
  --primary:#2563eb;
}

.page{
  min-height:100vh;
  background:var(--bg);
  color:var(--text);
}

.container{
  max-width:1100px;
  margin:0 auto;
  padding:24px 16px 40px;
}

.header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}

.h1{
  margin:0;
  font-size:22px;
  letter-spacing:-0.02em;
}

.btnPrimary{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:10px 12px;
  border-radius:12px;
  background:var(--primary);
  color:#fff;
  font-weight:700;
  text-decoration:none;
  border:1px solid rgba(0,0,0,0.08);
}

.tableWrap{
  margin-top:16px;
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:14px;
  overflow:auto;
  box-shadow:0 1px 2px rgba(0,0,0,0.04);
}

.table{
  width:100%;
  border-collapse:separate;
  border-spacing:0;
  min-width:980px;
}

.table thead th{
  text-align:left;
  padding:12px 12px;
  font-size:12px;
  color:var(--muted);
  font-weight:700;
  border-bottom:1px solid var(--border);
  background:var(--surface);
  position:sticky;
  top:0;
}

.table tbody td{
  padding:12px 12px;
  border-bottom:1px solid var(--border);
  vertical-align:top;
}

.rowDim{ opacity:0.65; }

.actions{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
}

.link{
  color:var(--primary);
  font-weight:700;
  text-decoration:none;
}

.link:hover{ text-decoration:underline; }

.mono{
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size:12px;
  white-space:nowrap;
}

.muted{ color:var(--muted); }

.help{ cursor:help; }

.warnText{
  color:#b45309;
  font-weight:700;
}

.emptyCell{
  padding:16px 12px;
  color:var(--muted);
}

.cards{
  margin-top:16px;
  display:flex;
  flex-direction:column;
  gap:12px;
}

.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:14px;
  padding:14px;
  box-shadow:0 1px 2px rgba(0,0,0,0.04);
}

.cardDim{ opacity:0.7; }

.cardTop{
  display:flex;
  flex-direction:column;
  gap:10px;
}

.cardPills{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}

.cardMeta{
  display:flex;
  flex-direction:column;
  gap:6px;
}

.metaLine{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}

.metaKey{
  color:var(--muted);
  font-size:12px;
  font-weight:700;
  white-space:nowrap;
}

.cardBody{
  margin-top:12px;
  display:flex;
  flex-direction:column;
  gap:10px;
}

.field{
  display:flex;
  flex-direction:column;
  gap:4px;
}

.fieldKey{
  color:var(--muted);
  font-size:12px;
  font-weight:700;
}

.fieldVal{
  font-size:13px;
  line-height:1.5;
}

.cardActions{
  margin-top:14px;
  display:flex;
  gap:10px;
  flex-wrap:wrap;
}

.btnGhost{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:10px 12px;
  border-radius:12px;
  background:var(--surface);
  border:1px solid var(--border);
  color:var(--primary);
  font-weight:800;
  text-decoration:none;
}

.btnGhost:hover{ background:#f3f4f6; }

.emptyCard{
  background:var(--surface);
  border:1px dashed var(--border);
  border-radius:14px;
  padding:18px;
  color:var(--muted);
  text-align:center;
}

.footnote{
  margin-top:12px;
  opacity:0.7;
  font-size:12px;
}

.error{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:12px;
  padding:12px;
  margin-top:12px;
  overflow:auto;
}

/* --- responsive --- */
.onlyDesktop{ display:block; }
.onlyMobile{ display:none; }

@media (max-width: 768px){
  .onlyDesktop{ display:none; }
  .onlyMobile{ display:block; }
  .container{ padding:18px 12px 32px; }
  .h1{ font-size:20px; }
}
`;
