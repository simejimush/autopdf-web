import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ADMIN_EMAIL = "sencho96@gmail.com";

type AiUsageLogRow = {
  id: string;
  user_id: string | null;
  rule_id: string | null;
  run_id: string | null;
  feature: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  status: string | null;
  error_code: string | null;
  created_at: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";

  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatNumber(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ja-JP");
}

function formatUsd(value: number | null | undefined) {
  if (value == null) return "-";

  return `$${value.toFixed(6)}`;
}

function getTodayStartIso() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const today = formatter.format(now);
  return `${today}T00:00:00+09:00`;
}

function getSevenDaysAgoIso() {
  const now = new Date();
  now.setDate(now.getDate() - 7);

  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const date = formatter.format(now);
  return `${date}T00:00:00+09:00`;
}

export default async function AdminAiUsagePage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (user.email !== ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  const todayStartIso = getTodayStartIso();
  const sevenDaysAgoIso = getSevenDaysAgoIso();

  const { data, error } = await supabaseAdmin
    .from("ai_usage_logs")
    .select(
      "id, user_id, rule_id, run_id, feature, provider, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, status, error_code, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data ?? []) as AiUsageLogRow[];

  const totalLogs = rows.length;
  const successLogs = rows.filter((row) => row.status === "success").length;
  const errorLogs = rows.filter((row) => row.status === "error").length;
  const totalTokens = rows.reduce(
    (sum, row) => sum + Number(row.total_tokens ?? 0),
    0,
  );
  const totalEstimatedCostUsd = rows.reduce(
    (sum, row) => sum + Number(row.estimated_cost_usd ?? 0),
    0,
  );

  const todayRows = rows.filter((row) => {
    if (!row.created_at) return false;
    return new Date(row.created_at) >= new Date(todayStartIso);
  });

  const sevenDayRows = rows.filter((row) => {
    if (!row.created_at) return false;
    return new Date(row.created_at) >= new Date(sevenDaysAgoIso);
  });

  const todayTokens = todayRows.reduce(
    (sum, row) => sum + Number(row.total_tokens ?? 0),
    0,
  );

  const sevenDayTokens = sevenDayRows.reduce(
    (sum, row) => sum + Number(row.total_tokens ?? 0),
    0,
  );

  const byFeature = rows.reduce<Record<string, { count: number; tokens: number }>>(
    (acc, row) => {
      const key = row.feature ?? "unknown";
      acc[key] ??= { count: 0, tokens: 0 };
      acc[key].count += 1;
      acc[key].tokens += Number(row.total_tokens ?? 0);
      return acc;
    },
    {},
  );

  const featureRows = Object.entries(byFeature).sort(
    (a, b) => b[1].tokens - a[1].tokens,
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 20px",
        background: "var(--bg)",
        color: "var(--fg)",
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <Link
          href="/admin"
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            fontWeight: 700,
          }}
        >
          ← 管理メニューへ戻る
        </Link>

        <div style={{ marginTop: 24, marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>AI使用量・コスト監視</h1>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>
            ai_usage_logs の最新100件をもとに、AI利用量を集計表示しています。
          </p>
        </div>

        {error ? (
          <section
            style={{
              padding: 20,
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "#ef4444",
              fontWeight: 700,
            }}
          >
            AI使用量ログの取得に失敗しました。
          </section>
        ) : (
          <>
            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <SummaryCard label="最新ログ件数" value={`${totalLogs}件`} />
              <SummaryCard label="成功" value={`${successLogs}件`} />
              <SummaryCard label="エラー" value={`${errorLogs}件`} />
              <SummaryCard label="総トークン" value={formatNumber(totalTokens)} />
              <SummaryCard label="今日のトークン" value={formatNumber(todayTokens)} />
              <SummaryCard label="直近7日のトークン" value={formatNumber(sevenDayTokens)} />
              <SummaryCard
                label="推定コスト"
                value={formatUsd(totalEstimatedCostUsd)}
              />
            </section>

            <section
              style={{
                padding: 20,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                marginBottom: 20,
              }}
            >
              <h2 style={{ marginTop: 0, fontSize: 18 }}>機能別集計</h2>

              {featureRows.length === 0 ? (
                <p style={{ color: "var(--muted)", marginBottom: 0 }}>
                  AI使用量ログはまだありません。
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 14,
                    }}
                  >
                    <thead>
                      <tr>
                        <Th>feature</Th>
                        <Th>件数</Th>
                        <Th>total_tokens</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {featureRows.map(([feature, summary]) => (
                        <tr key={feature}>
                          <Td>
                            <code>{feature}</code>
                          </Td>
                          <Td>{formatNumber(summary.count)}</Td>
                          <Td>{formatNumber(summary.tokens)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section
              style={{
                padding: 20,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              <h2 style={{ marginTop: 0, fontSize: 18 }}>最新ログ</h2>

              {rows.length === 0 ? (
                <p style={{ color: "var(--muted)", marginBottom: 0 }}>
                  AI使用量ログはまだありません。
                </p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                      minWidth: 1100,
                    }}
                  >
                    <thead>
                      <tr>
                        <Th>日時</Th>
                        <Th>feature</Th>
                        <Th>provider</Th>
                        <Th>model</Th>
                        <Th>input</Th>
                        <Th>output</Th>
                        <Th>total</Th>
                        <Th>cost</Th>
                        <Th>status</Th>
                        <Th>error_code</Th>
                        <Th>user_id</Th>
                        <Th>rule_id</Th>
                        <Th>run_id</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <Td>{formatDateTime(row.created_at)}</Td>
                          <Td>
                            <code>{row.feature ?? "-"}</code>
                          </Td>
                          <Td>{row.provider ?? "-"}</Td>
                          <Td>{row.model ?? "-"}</Td>
                          <Td>{formatNumber(row.input_tokens)}</Td>
                          <Td>{formatNumber(row.output_tokens)}</Td>
                          <Td>{formatNumber(row.total_tokens)}</Td>
                          <Td>{formatUsd(row.estimated_cost_usd)}</Td>
                          <Td>{row.status ?? "-"}</Td>
                          <Td>
                            <code>{row.error_code ?? "-"}</code>
                          </Td>
                          <Td>
                            <code>{row.user_id ?? "-"}</code>
                          </Td>
                          <Td>
                            <code>{row.rule_id ?? "-"}</code>
                          </Td>
                          <Td>
                            <code>{row.run_id ?? "-"}</code>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 16,
        border: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <div style={{ color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ marginTop: 8, fontSize: 24, fontWeight: 800 }}>
        {value}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 8px",
        borderBottom: "1px solid var(--border)",
        color: "var(--muted)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: "10px 8px",
        borderBottom: "1px solid var(--border)",
        verticalAlign: "top",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}