import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ADMIN_EMAIL = "sencho96@gmail.com";

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
            OpenAI API などのAI利用量・コストを確認するための管理ページです。
          </p>
        </div>

        <section
          style={{
            padding: 24,
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "var(--surface)",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: 18 }}>準備中</h2>
          <p style={{ color: "var(--muted)", marginBottom: 0 }}>
            現時点ではAI使用量ログの集計テーブルは未実装です。
            今後、ユーザー別・ルール別・日別のAI利用量、推定コスト、異常増加の検知を表示する予定です。
          </p>
        </section>
      </div>
    </main>
  );
}
