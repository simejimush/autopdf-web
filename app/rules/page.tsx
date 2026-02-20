import { getRuleStatus } from "../../src/lib/rules/status";
import RunButton from "./RunButton";
import { headers } from "next/headers";

type Run = {
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
  runs?: Run[]; // ← ? を付ける
};

function normalizeQuery(q: unknown) {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s || s === "-") return null;
  return s;
}

function truncate(s: string, max = 80) {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export default async function RulesPage() {
  const h = await headers();
  const host = h.get("host");
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const baseUrl = `${protocol}://${host}`;

  const res = await fetch(`${baseUrl}/api/rules`, {
    cache: "no-store",
  });

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

  const latestRes = await fetch(`${baseUrl}/api/runs/latest`, {
    cache: "no-store",
  });

  const latestJson = await latestRes.json();
  const latestByRule = latestJson?.data ?? {};

  return (
    <main style={{ padding: 24 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
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
              const status = getRuleStatus(r);
              const isMissing = status.status === "needs_setup";
              const displayQuery = q ?? "(generated)";
              const lastRun = r.runs?.[0] ?? null;

              return (
                <tr key={r.id} style={{ opacity: isMissing ? 0.55 : 1 }}>
                  <td style={td}>
                    {isMissing ? "OFF" : r.is_active ? "ON" : "OFF"}

                    {status.status === "disabled" && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "2px 8px",
                          fontSize: 11,
                          borderRadius: 999,
                          background: "#444",
                          color: "#fff",
                        }}
                      >
                        disabled
                      </span>
                    )}
                  </td>

                  <td style={td}>{r.run_timing ?? "-"}</td>

                  {/* ここが置き換えた gmail_query の td */}
                  <td style={tdMono}>
                    {(() => {
                      if (isMissing) {
                        const reasonText =
                          status.status === "needs_setup"
                            ? status.reasons.join(" / ")
                            : "";

                        return (
                          <span
                            title={reasonText}
                            style={{
                              color: "#f59e0b",
                              fontWeight: 700,
                              cursor: "help",
                            }}
                          >
                            ⚠ 未設定{reasonText ? `（${reasonText}）` : ""}
                          </span>
                        );
                      }

                      return (
                        <span title={displayQuery} style={{ cursor: "help" }}>
                          {truncate(displayQuery, 90)}
                        </span>
                      );
                    })()}
                  </td>

                  <td style={tdMono}>{r.drive_folder_id ?? "-"}</td>
                  <td
                    style={{
                      ...td,
                      fontWeight: 700,
                      color:
                        lastRun?.status === "success"
                          ? "#22c55e"
                          : lastRun?.status === "error"
                          ? "#ef4444"
                          : "#e5e7eb",
                    }}
                  >
                    {lastRun
                      ? `${lastRun.status} ${
                          lastRun.finished_at
                            ? new Date(lastRun.finished_at).toLocaleString(
                                "ja-JP",
                                {
                                  timeZone: "Asia/Tokyo",
                                }
                              )
                            : ""
                        } ${lastRun.message ?? ""}`.trim()
                      : "-"}
                  </td>

                  <td style={td}>{r.updated_at ?? "-"}</td>
                  <td style={td}>
                    <RunButton
                      ruleId={r.id}
                      disabled={status.status !== "ready"}
                    />

                    <a href={`/rules/${r.id}`}>Edit</a>
                  </td>
                </tr>
              );
            })}

            {rules.length === 0 && (
              <tr>
                <td style={td} colSpan={6}>
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
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  whiteSpace: "nowrap",
};
