import Link from "next/link";

export default function BillingCancelPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "56px 20px",
      }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          marginBottom: 12,
          color: "#0f172a",
        }}
      >
        決済は完了していません
      </h1>

      <p
        style={{
          color: "#475569",
          lineHeight: 1.8,
          marginBottom: 24,
        }}
      >
        決済がキャンセルされました。
        <br />
        再度お試しいただくか、そのままご利用を続けることもできます。
      </p>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <Link href="/billing">もう一度試す</Link>
        <Link href="/dashboard">ダッシュボードへ</Link>
      </div>
    </main>
  );
}
