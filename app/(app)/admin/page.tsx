import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ADMIN_EMAIL = "sencho96@gmail.com";

export default async function AdminPage() {
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

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 20px",
        background: "var(--bg)",
        color: "var(--fg)",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>管理メニュー</h1>
          <p style={{ color: "var(--muted)", marginTop: 8 }}>
            AutoPDF の管理者向けページです。
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          <Link
            href="/admin/errors"
            style={{
              display: "block",
              padding: 20,
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--fg)",
              textDecoration: "none",
            }}
          >
            <strong>エラー監視</strong>
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>
              実行エラー、error_code、対象ユーザーを確認します。
            </p>
          </Link>

          <Link
            href="/admin/ai-usage"
            style={{
              display: "block",
              padding: 20,
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--fg)",
              textDecoration: "none",
            }}
          >
            <strong>AI使用量・コスト監視</strong>
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>
              AI利用量とコスト監視ページです。現在は準備中です。
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
