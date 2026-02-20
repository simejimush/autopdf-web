"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type User = {
  id: string;
  email?: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // URLの #access_token などを消す（見た目＆事故防止）
    if (typeof window !== "undefined" && window.location.hash) {
      history.replaceState(null, "", window.location.pathname);
    }

    (async () => {
      setErrorMsg(null);
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;

        if (!cancelled) {
          setUser(
            data.user
              ? { id: data.user.id, email: data.user.email ?? undefined }
              : null,
          );
        }
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message ?? "failed to get user");
      } finally {
        if (!cancelled) setLoading(false); // ★必ず下ろす
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    setErrorMsg(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    router.replace("/login");
  };

  if (loading) return <main style={{ padding: 24 }}>Loading...</main>;

  const mockPdfs = [
    { id: "pdf_001", title: "見積書_山田様", createdAt: "2026-01-30 18:10", status: "完了" },
    { id: "pdf_002", title: "請求書_佐藤様", createdAt: "2026-01-30 17:42", status: "完了" },
    { id: "pdf_003", title: "作業報告_現場A", createdAt: "2026-01-30 16:05", status: "処理中" },
  ];

  return (
    <main style={{ padding: 24 }}>
      <h1>Dashboard</h1>

      {errorMsg && <p style={{ marginTop: 12 }}>Error: {errorMsg}</p>}

      <p style={{ marginTop: 12 }}>ログイン中: {user?.email ?? "(emailなし)"}</p>
      <p style={{ marginTop: 6, fontSize: 12 }}>UID: {user?.id}</p>

      <h2 style={{ marginTop: 24 }}>最近作成したPDF</h2>

      <div style={{ marginTop: 12 }}>
        {mockPdfs.map((pdf) => (
          <div
            key={pdf.id}
            style={{
              border: "1px solid #333",
              borderRadius: 8,
              padding: 12,
              marginTop: 10,
            }}
          >
            <div style={{ fontSize: 14 }}>{pdf.title}</div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
              {pdf.createdAt} / {pdf.status}
            </div>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 16 }}>
        <a href="/rules">ルール設定へ →</a>
      </p>

      <button onClick={signOut} style={{ marginTop: 12, padding: "10px 14px" }}>
        ログアウト
      </button>
    </main>
  );
}