// src/components/dashboard/StatusSummaryCard.tsx
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
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.7)",
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.7 }}>{props.label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
        {props.value}
      </div>
      {props.hint ? (
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
          {props.hint}
        </div>
      ) : null}
    </div>
  );
}

export function StatusSummaryCard(props: { summary: DashboardSummary }) {
  const { summary } = props;

  const last = summary.lastRunAt ? formatJst(summary.lastRunAt) : "—";

  return (
    <section
      style={{
        borderRadius: 18,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "white",
        padding: 16,
        boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>稼働ステータス</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
            直近7日間のサマリー
          </div>
        </div>

        <div style={{ fontSize: 12, opacity: 0.7, textAlign: "right" }}>
          <div>直近実行</div>
          <div style={{ fontWeight: 700, opacity: 0.9 }}>{last}</div>
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
        <Stat label="処理件数" value={summary.processedTotal7d.toLocaleString()} />
        <Stat label="保存成功数" value={summary.savedTotal7d.toLocaleString()} />
        <Stat label="エラー数" value={summary.errorCount7d.toLocaleString()} />
        <Stat label="期間" value="7日" hint="※変更可能" />
      </div>
    </section>
  );
}