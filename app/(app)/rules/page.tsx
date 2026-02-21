// app/(app)/rules/page.tsx
import { getRuleStatus } from "@/src/lib/rules/status";
import RunButton from "./RunButton";
import CopyButton from "./CopyButton";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import RuleToggle from "./RuleToggle";

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
  runs?: never;
};

const LABEL = {
  rules: "ルール",
  active: "有効",
  runTiming: "実行タイミング",
  gmailQuery: "検索条件",
  driveFolder: "保存先フォルダ",
  lastRun: "最終実行",
  updated: "更新日時",
  action: "操作",
  newRule: "＋ ルールを作成",
  edit: "編集",
  copy: "コピー",
  empty: "まだルールがありません",
  ready: "準備完了",
  disabled: "無効",
  needsSetup: "未設定",
  success: "成功",
  error: "エラー",
};

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
  if (s === "ready") return LABEL.ready;
  if (s === "disabled") return LABEL.disabled;
  if (s === "needs_setup") return LABEL.needsSetup;
  if (s === "success") return LABEL.success;
  if (s === "error") return LABEL.error;
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

function badgeKind(status: ReturnType<typeof getRuleStatus>) {
  if (status.status === "needs_setup") return "warn";
  if (status.status === "ready") return "ok";
  if (status.status === "disabled") return "muted";
  return "muted";
}

export default async function RulesPage() {
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

  const rules = json.data ?? [];

  const latestRes = await fetch(`${baseUrl}/api/runs/latest`, {
    cache: "no-store",
    headers: { cookie },
  });
  const latestJson = await latestRes.json();
  const latestByRule: Record<string, RunLite | null> = latestJson?.data ?? {};

  if (json.error) {
    return (
      <div className="rulesPage">
        <style>{styles}</style>
        <div className="hero">
          <div>
            <h1 className="h1">{LABEL.rules}</h1>
            <p className="sub">自動実行のルールを管理します。</p>
          </div>
          <a className="btnPrimary" href="/rules/new">
            {LABEL.newRule}
          </a>
        </div>

        <div className="error" role="alert">
          <div className="errorTitle">エラー</div>
          <div className="errorMsg">{json.error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="rulesPage">
      <style>{styles}</style>

      <div className="hero">
        <div>
          <h1 className="h1">{LABEL.rules}</h1>
          <p className="sub">自動実行のルールを管理します。</p>
        </div>

        <a className="btnPrimary" href="/rules/new">
          {LABEL.newRule}
        </a>
      </div>

      {/* PC: table */}
      <div className="onlyDesktop">
        <div className="card">
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

                  const lastRunColor =
                    lastRun?.status === "success"
                      ? "var(--ok)"
                      : lastRun?.status === "error"
                        ? "var(--err)"
                        : "var(--muted)";

                  return (
                    <tr key={r.id} className={isMissing ? "rowDim" : ""}>
                      <td>
                        <div className="cellActive">
                          <RuleToggle id={r.id} isActive={r.is_active} />

                          <span
                            className={`pill ${badgeKind(status)}`}
                            title={reasonsText}
                          >
                            {statusJa(status.status)}
                          </span>
                        </div>
                      </td>

                      <td className="mono">{r.run_timing ?? "-"}</td>

                      <td className="mono">
                        {isMissing ? (
                          <span className="warnText" title={reasonsText}>
                            ⚠ {LABEL.needsSetup}
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
                          ? truncate(r.drive_folder_id, 28)
                          : "-"}
                      </td>

                      <td
                        className="lastRun"
                        style={{
                          color: lastRun ? lastRunColor : "var(--muted)",
                        }}
                        title={lastRunTitle}
                      >
                        {lastRunText}
                      </td>

                      <td className="muted" title={r.updated_at ?? ""}>
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
                    <td colSpan={7} className="empty">
                      <div className="emptyTitle">{LABEL.empty}</div>
                      <div className="emptySub">
                        まずはルールを作成してください。
                      </div>
                      <a className="btnGhost" href="/rules/new">
                        {LABEL.newRule}
                      </a>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Mobile: cards */}
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

            return (
              <div key={r.id} className={`card ${isMissing ? "rowDim" : ""}`}>
                <div className="cardTop">
                  <div className="cellActive">
                    <RuleToggle id={r.id} isActive={r.is_active} />
                    <span
                      className={`pill ${badgeKind(status)}`}
                      title={reasonsText}
                    >
                      {statusJa(status.status)}
                    </span>
                  </div>

                  <a className="link" href={`/rules/${r.id}`}>
                    {LABEL.edit}
                  </a>
                </div>

                <div className="kv">
                  <div className="kvRow">
                    <div className="kvKey">{LABEL.runTiming}</div>
                    <div className="kvVal mono">{r.run_timing ?? "-"}</div>
                  </div>

                  <div className="kvRow">
                    <div className="kvKey">{LABEL.gmailQuery}</div>
                    <div className="kvVal">
                      {isMissing ? (
                        <span className="warnText" title={reasonsText}>
                          ⚠ {LABEL.needsSetup}
                          {reasonsText ? `（${reasonsText}）` : ""}
                        </span>
                      ) : (
                        <span className="mono help" title={displayQuery}>
                          {truncate(displayQuery, 90)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="kvRow">
                    <div className="kvKey">{LABEL.driveFolder}</div>
                    <div className="kvVal mono" title={r.drive_folder_id ?? ""}>
                      {r.drive_folder_id
                        ? truncate(r.drive_folder_id, 28)
                        : "-"}
                    </div>
                  </div>

                  <div className="kvRow">
                    <div className="kvKey">{LABEL.lastRun}</div>
                    <div className="kvVal lastRun">{lastRunText}</div>
                  </div>

                  <div className="kvRow">
                    <div className="kvKey">{LABEL.updated}</div>
                    <div className="kvVal muted">{fmtTokyo(r.updated_at)}</div>
                  </div>
                </div>

                <div className="actionsMobile">
                  <RunButton
                    ruleId={r.id}
                    disabled={status.status !== "ready"}
                  />
                  <CopyButton text={displayQuery} />
                </div>
              </div>
            );
          })}

          {rules.length === 0 && (
            <div className="card emptyCard">
              <div className="emptyTitle">{LABEL.empty}</div>
              <div className="emptySub">まずはルールを作成してください。</div>
              <a className="btnPrimary" href="/rules/new">
                {LABEL.newRule}
              </a>
            </div>
          )}
        </div>
      </div>

      <p className="footnote">
        ※ いまは service role で取得（ログイン導線は後で置き換え）
      </p>
    </div>
  );
}

const styles = `
:root{
  --ok:#16a34a;
  --err:#ef4444;
}

.rulesPage{}

/* hero */
.hero{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:12px;
  margin-top:10px;
}

.h1{
  margin:0;
  font-size:22px;
  letter-spacing:-0.02em;
}

.sub{
  margin:6px 0 0;
  color:var(--muted);
  font-size:13px;
  line-height:1.6;
}

.btnPrimary{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:8px 14px;          /* 少し小さく */
  border-radius:999px;       /* 半円 */
  background:var(--primary);
  color:#fff;
  font-weight:900;
  font-size:13px;
  text-decoration:none;
  border:1px solid rgba(0,0,0,0.08);
}

.btnPrimary:hover{
  transform:translateY(-1px);
  box-shadow:0 8px 18px rgba(37,99,235,0.20);
}

.btnGhost{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid var(--border);
  background:var(--surface);
  color:var(--primary);
  font-weight:900;
  text-decoration:none;
}

.btnGhost:hover{ background:#f3f4f6; }

/* card/table */
.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:14px;
  padding:14px;
  box-shadow:0 1px 2px rgba(0,0,0,0.04);
}

.tableWrap{ overflow-x:auto; }

.table{
  width:100%;
  border-collapse:separate;
  border-spacing:0;
  min-width:920px;
}

.table thead th{
  text-align:left;
  font-size:12px;
  color:var(--muted);
  font-weight:900;
  padding:10px 10px;
  border-bottom:1px solid var(--border);
  white-space:nowrap;
}

.table tbody td{
  padding:12px 10px;
  border-bottom:1px solid var(--border);
  vertical-align:top;
  font-size:13px;
}

.table tbody tr:hover{
  background:#fafafa;
}

.rowDim{ opacity:0.6; }

.mono{
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size:12px;
}

.muted{ color:var(--muted); }

.lastRun{
  font-weight:900;
}

.cellActive{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}

.toggle{
  display:inline-flex;
  align-items:center;
  padding:3px 10px;
  border-radius:999px;
  border:1px solid var(--border);
  font-weight:900;
  font-size:12px;
  background:var(--surface);
}

.toggle.on{ color:var(--ok); }
.toggle.off{ color:var(--muted); }

.pill{
  display:inline-flex;
  align-items:center;
  padding:3px 10px;
  border-radius:999px;
  font-weight:900;
  font-size:12px;
  border:1px solid var(--border);
  background:var(--surface);
}

.pill.ok{ color:var(--ok); border-color:rgba(34,197,94,0.35); }
.pill.warn{ color:#b45309; border-color:rgba(245,158,11,0.35); }
.pill.muted{ color:var(--muted); }

.warnText{
  color:#b45309;
  font-weight:900;
}

.help{ cursor:help; }

.actions{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
}

.link{
  color:var(--primary);
  font-weight:900;
  text-decoration:none;
}

.link:hover{ text-decoration:underline; }

/* empty */
.empty{
  padding:26px 10px;
  text-align:center;
}

.emptyTitle{
  font-size:14px;
  font-weight:900;
}

.emptySub{
  margin-top:6px;
  color:var(--muted);
  font-size:12px;
}

/* mobile */
.cards{
  display:flex;
  flex-direction:column;
  gap:12px;
  margin-top:14px;
}

.cardTop{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  margin-bottom:10px;
}

.kv{
  display:flex;
  flex-direction:column;
  gap:10px;
}

.kvRow{
  border:1px solid var(--border);
  border-radius:12px;
  padding:10px 12px;
  background:var(--surface);
}

.kvKey{
  color:var(--muted);
  font-size:12px;
  font-weight:900;
  margin-bottom:4px;
}

.kvVal{
  font-size:13px;
  font-weight:900;
}

.actionsMobile{
  margin-top:12px;
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
}

.emptyCard{
  text-align:center;
}

.footnote{
  margin-top:12px;
  opacity:0.7;
  font-size:12px;
}

/* responsive switches */
.onlyDesktop{ display:block; margin-top:14px; }
.onlyMobile{ display:none; }

@media (max-width: 768px){
  .hero{ flex-direction:column; align-items:stretch; }
  .btnPrimary{ width:100%; }
  .onlyDesktop{ display:none; }
  .onlyMobile{ display:block; }
}
`;
