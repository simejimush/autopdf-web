"use client";

import type { DashboardSummary } from "@/lib/dashboard/summary";

function formatJst(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat(props: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        border: "1px solid var(--border, rgba(148, 163, 184, 0.2))",
        background: "var(--surface-2, rgba(255,255,255,0.7))",
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: "var(--muted, #64748b)",
        }}
      >
        {props.label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          marginTop: 4,
          color: "var(--fg, #0f172a)",
        }}
      >
        {props.value}
      </div>
      {props.hint ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--muted, #64748b)",
            marginTop: 2,
          }}
        >
          {props.hint}
        </div>
      ) : null}
    </div>
  );
}

export function StatusSummaryCard(props: { summary: DashboardSummary }) {
  const { summary } = props;

  const last = summary.lastRunAt ? formatJst(summary.lastRunAt) : "-";

  return (
    <section
      style={{
        borderRadius: 18,
        border: "1px solid var(--border, rgba(148, 163, 184, 0.2))",
        background: "var(--surface, #ffffff)",
        padding: 16,
        boxShadow: "var(--sh-2, 0 8px 24px rgba(15, 23, 42, 0.06))",
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--fg, #0f172a)",
            }}
          >
            稼働ステータス
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted, #64748b)",
              marginTop: 2,
            }}
          >
            直近7日間のサマリー
          </div>
        </div>

        <div
          style={{
            fontSize: 12,
            color: "var(--muted, #64748b)",
            textAlign: "right",
          }}
        >
          <div>直近実行</div>
          <div
            style={{
              fontWeight: 700,
              color: "var(--fg, #0f172a)",
              marginTop: 2,
            }}
          >
            {last}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 10,
          marginTop: 14,
        }}
      >
        <Stat
          label="処理件数"
          value={summary.processedTotal7d.toLocaleString()}
        />
        <Stat
          label="保存成功数"
          value={summary.savedTotal7d.toLocaleString()}
        />
        <Stat label="エラー数" value={summary.errorCount7d.toLocaleString()} />
        <Stat label="期間" value="7日" hint="※変更可能" />
      </div>
    </section>
  );
}
