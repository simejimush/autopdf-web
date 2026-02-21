// app/(app)/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type User = {
  id: string;
  email?: string;
};

type PdfItem = {
  id: string;
  title: string;
  createdAt: string;
  status: "完了" | "処理中" | string;
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
        if (!cancelled) setLoading(false);
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

  const mockPdfs: PdfItem[] = [
    {
      id: "pdf_001",
      title: "見積書_山田様",
      createdAt: "2026-01-30 18:10",
      status: "完了",
    },
    {
      id: "pdf_002",
      title: "請求書_佐藤様",
      createdAt: "2026-01-30 17:42",
      status: "完了",
    },
    {
      id: "pdf_003",
      title: "作業報告_現場A",
      createdAt: "2026-01-30 16:05",
      status: "処理中",
    },
  ];

  return (
    <div className="dash">
      <style>{styles}</style>

      <div className="hero">
        <div>
          <h1 className="h1">ダッシュボード</h1>
          <p className="sub">
            最近作成したPDFと、ルール設定の状況を確認できます。
          </p>
        </div>

        <a className="btnPrimary" href="/rules">
          ルールを開く
        </a>
      </div>

      {loading ? (
        <div className="loading">
          <span className="spinner" />
          読み込み中…
        </div>
      ) : (
        <>
          {errorMsg && (
            <div className="error" role="alert">
              <div className="errorTitle">エラー</div>
              <div className="errorMsg">{errorMsg}</div>
            </div>
          )}

          <section className="grid">
            {/* 最近作成したPDF */}
            <div className="card">
              <div className="cardHead">
                <h2 className="h2">最近作成したPDF</h2>
                <span className="muted">{mockPdfs.length} 件</span>
              </div>

              <div className="list">
                {mockPdfs.map((pdf) => (
                  <div key={pdf.id} className="row">
                    <div className="rowMain">
                      <div className="rowTitle">{pdf.title}</div>
                      <div className="rowMeta">
                        <span>{pdf.createdAt}</span>
                        <span className="sep">•</span>
                        <span
                          className={
                            pdf.status === "完了" ? "badgeOk" : "badgeWarn"
                          }
                        >
                          {pdf.status}
                        </span>
                      </div>
                    </div>

                    <button
                      className="btnMini"
                      onClick={() =>
                        alert("ここは後で「Driveを開く」などにする")
                      }
                    >
                      詳細
                    </button>
                  </div>
                ))}
              </div>

              <div className="cardFoot">
                <span className="muted">
                  ※ いまは仮データ。Drive連携後に実データへ差し替え。
                </span>
              </div>
            </div>

            {/* アカウント */}
            <div className="card">
              <div className="cardHead">
                <h2 className="h2">アカウント</h2>
              </div>

              <div className="kv">
                <div className="kvRow">
                  <div className="kvKey">メール</div>
                  <div className="kvVal">{user?.email ?? "(emailなし)"}</div>
                </div>

                <div className="kvRow">
                  <div className="kvKey">UID</div>
                  <div className="kvVal mono">{user?.id}</div>
                </div>
              </div>

              <div className="actions">
                <a className="btnGhostFull" href="/rules">
                  ルール設定へ
                </a>
                <button className="btnDangerFull" onClick={signOut}>
                  ログアウト
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const styles = `
.dash{}

/* --- hero --- */
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
  padding:10px 12px;
  border-radius:12px;
  background:var(--primary);
  color:#fff;
  font-weight:900;
  text-decoration:none;
  border:1px solid rgba(0,0,0,0.08);
}

.btnPrimary:hover{
  transform:translateY(-1px);
  box-shadow:0 8px 18px rgba(37,99,235,0.20);
}

/* --- loading --- */
.loading{
  display:flex;
  align-items:center;
  gap:10px;
  margin-top:16px;
  padding:14px 4px 6px;
  color:var(--muted);
  font-weight:800;
}

.spinner{
  width:16px;
  height:16px;
  border-radius:999px;
  border:2px solid rgba(0,0,0,0.15);
  border-top-color:rgba(0,0,0,0.55);
  animation:spin .8s linear infinite;
}

@keyframes spin{ to{ transform:rotate(360deg); } }

/* --- error --- */
.error{
  border:1px solid #fecaca;
  background:#fff1f2;
  border-radius:14px;
  padding:12px;
  margin-top:14px;
}

.errorTitle{ font-weight:900; color:#9f1239; font-size:13px; margin-bottom:4px; }
.errorMsg{ color:#9f1239; font-size:12px; line-height:1.6; word-break:break-word; }

/* --- grid/cards --- */
.grid{
  margin-top:16px;
  display:grid;
  grid-template-columns: 1.6fr 1fr;
  gap:14px;
}

.card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:14px;
  padding:14px;
  box-shadow:0 1px 2px rgba(0,0,0,0.04);
}

.cardHead{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:10px;
  margin-bottom:10px;
}

.cardFoot{
  margin-top:12px;
}

.h2{
  margin:0;
  font-size:14px;
  letter-spacing:-0.01em;
}

.muted{
  color:var(--muted);
  font-size:12px;
  font-weight:800;
}

/* --- list rows --- */
.list{
  display:flex;
  flex-direction:column;
  gap:10px;
}

.row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  border:1px solid var(--border);
  border-radius:12px;
  padding:10px 12px;
}

.rowTitle{
  font-weight:900;
  font-size:13px;
}

.rowMeta{
  margin-top:6px;
  color:var(--muted);
  font-size:12px;
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}

.sep{ opacity:0.5; }

.badgeOk{
  display:inline-flex;
  align-items:center;
  padding:2px 10px;
  border-radius:999px;
  border:1px solid #22c55e;
  color:#15803d;
  font-weight:900;
  background:var(--surface);
}

.badgeWarn{
  display:inline-flex;
  align-items:center;
  padding:2px 10px;
  border-radius:999px;
  border:1px solid #f59e0b;
  color:#b45309;
  font-weight:900;
  background:var(--surface);
}

.btnMini{
  padding:8px 10px;
  border-radius:12px;
  border:1px solid var(--border);
  background:var(--surface);
  color:var(--primary);
  font-weight:900;
  cursor:pointer;
  white-space:nowrap;
}

.btnMini:hover{ background:#f3f4f6; }

/* --- account --- */
.kv{
  display:flex;
  flex-direction:column;
  gap:10px;
  margin-top:6px;
}

.kvRow{
  display:flex;
  flex-direction:column;
  gap:4px;
  border:1px solid var(--border);
  border-radius:12px;
  padding:10px 12px;
}

.kvKey{
  color:var(--muted);
  font-size:12px;
  font-weight:900;
}

.kvVal{
  font-size:13px;
  font-weight:900;
}

.mono{
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size:12px;
}

.actions{
  margin-top:12px;
  display:flex;
  flex-direction:column;
  gap:10px;
}

.btnGhostFull{
  width:100%;
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

.btnGhostFull:hover{ background:#f3f4f6; }

.btnDangerFull{
  width:100%;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid #fecaca;
  background:#fff1f2;
  color:#b91c1c;
  font-weight:900;
  cursor:pointer;
}

.btnDangerFull:hover{ background:#ffe4e6; }

/* --- responsive --- */
@media (max-width: 900px){
  .grid{ grid-template-columns: 1fr; }
}

@media (max-width: 768px){
  .hero{ flex-direction:column; align-items:stretch; }
  .btnPrimary{ width:100%; }
}
`;
