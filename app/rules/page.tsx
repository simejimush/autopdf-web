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

function badgeStyle(kind: "warn" | "muted" | "ok" | "err") {
  const base: React.CSSProperties = {
    marginLeft: 8,
    padding: "2px 8px",
    fontSize: 11,
    borderRadius: 999,
    color: "#fff",
    display: "inline-block",
    lineHeight: 1.6,
  };
  if (kind === "warn") return { ...base, background: "#f59e0b" };
  if (kind === "ok") return { ...base, background: "#22c55e" };
  if (kind === "err") return { ...base, background: "#ef4444" };
  return { ...base, background: "#444" };
}

export default async function RulesPage() {
  const h = headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  const baseUrl = `${proto}://${host}`;

  // ---- rules ----
  const res = await fetch(`${baseUrl}/api/rules`, { cache: "no-store" });
  if (res.status === 401) redirect("/login");

  let json: { data: Rule[]; error?: string };
  try {
    json = await res.json();
  } catch {
    json = { data: [], error: "Invalid JSON response" };
  }

  if (json.error) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Rules</h1>
        <pre>error: {json.error}</pre>
      </main>
    );
  }

  const rules = json.data ?? [];

  // ---- latest runs (per rule) ----
  const latestRes = await fetch(`${baseUrl}/api/runs/latest`, { cache: "no-store" });
  const latestJson = await latestRes.json();
  const latestByRule: Record<string, RunLite | null> = latestJson?.data ?? {};

  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Rules</h1>
        <a href="/rules/new">＋ New rule</a>
      </div>

      <div style={{ marginTop: 16, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Active</th>
              <th style={th}>Run timing</th>
              <th style={th}>Gmail query</th>
              <th style={th}>Drive folder</th>
              <th style={th}>Last run</th>
              <th style={th}>Updated</th>
              <th style={th}>Action</th>
            </tr>
          </thead>

          <tbody>
            {rules.map((r) => {
              const q = normalizeQuery(r.gmail_query);
              const displayQuery = q ?? "(generated)";

              const status = getRuleStatus(r);
              const isMissing = status.status === "needs_setup";
              const lastRun = latestByRule[r.id] ?? null;

              const lastRunText = lastRun
                ? `${lastRun.status}${lastRun.finished_at ? ` · ${fmtTokyo(lastRun.finished_at)}` : ""}${
                    lastRun.processed_count || lastRun.saved_count
                      ? ` · ${lastRun.saved_count}/${lastRun.processed_count}`
                      : ""
                  }${lastRun.message ? ` · ${truncate(lastRun.message, 60)}` : ""}`
                : "-";

              const lastRunColor =
                lastRun?.status === "success" ? "#22c55e" : lastRun?.status === "error" ? "#ef4444" : "#e5e7eb";

              return (
                <tr key={r.id} style={{ opacity: isMissing ? 0.55 : 1 }}>
                  <td style={td}>
                    {isMissing ? "OFF" : r.is_active ? "ON" : "OFF"}

                    {status.status === "needs_setup" && (
                      <span
                        style={badgeStyle("warn")}
                        title={status.reasons?.length ? status.reasons.join(" / ") : ""}
                      >
                        未設定
                      </span>
                    )}

                    {status.status === "disabled" && <span style={badgeStyle("muted")}>disabled</span>}

                    {status.status === "ready" && <span style={badgeStyle("ok")}>ready</span>}
                  </td>

                  <td style={td}>{r.run_timing ?? "-"}</td>

                  <td style={tdMono}>
                    {isMissing ? (
                      <span
                        title={status.reasons?.length ? status.reasons.join(" / ") : ""}
                        style={{ color: "#f59e0b", fontWeight: 700, cursor: "help" }}
                      >
                        ⚠ 未設定{status.reasons?.length ? `（${status.reasons.join(" / ")}）` : ""}
                      </span>
                    ) : (
                      <span title={displayQuery} style={{ cursor: "help" }}>
                        {truncate(displayQuery, 90)}
                      </span>
                    )}
                  </td>

                  <td style={tdMono} title={r.drive_folder_id ?? ""}>
                    {r.drive_folder_id ? truncate(r.drive_folder_id, 24) : "-"}
                  </td>

                  <td style={{ ...td, fontWeight: 700, color: lastRun ? lastRunColor : "#9ca3af" }} title={lastRunText}>
                    {lastRunText}
                  </td>

                  <td style={td} title={r.updated_at ?? ""}>
                    {fmtTokyo(r.updated_at)}
                  </td>

                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <RunButton ruleId={r.id} disabled={status.status !== "ready"} />
                      <a href={`/rules/${r.id}`}>Edit</a>
                      <CopyButton text={displayQuery} />
                    </div>
                  </td>
                </tr>
              );
            })}

            {rules.length === 0 && (
              <tr>
                <td style={td} colSpan={7}>
                  No rules yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 12, opacity: 0.7, fontSize: 12 }}>
        ※ いまは service role で取得（ログイン導線は後で置き換え）
      </p>
    </main>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #333",
  fontWeight: 600,
};

const td: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #222",
  verticalAlign: "top",
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  whiteSpace: "nowrap",
};