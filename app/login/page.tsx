// app/login/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!mounted) return;
        if (data.user) router.replace("/dashboard");
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [router, supabase]);

  const signIn = async () => {
    if (signingIn) return;

    setSigningIn(true);
    setErrorMsg(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });

    if (error) {
      setErrorMsg(error.message);
      setSigningIn(false);
    }
    // 成功時はGoogleへ遷移するので setSigningIn(false) は不要
  };

  return (
    <main className="page">
      <style>{styles}</style>

      <div className="wrap">
        <div className="card">
          <div className="head">
            <div className="logo">AutoPDF</div>
            <h1 className="title">ログイン</h1>
            <p className="sub">
              Googleアカウントでログインして、GmailとDriveの自動化を始めましょう。
            </p>
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
                  <div className="errorTitle">ログインに失敗しました</div>
                  <div className="errorMsg">{errorMsg}</div>
                </div>
              )}

              <button
                type="button"
                className={`btn ${signingIn ? "btnDisabled" : "btnPrimary"}`}
                onClick={signIn}
                disabled={signingIn}
              >
                {signingIn ? (
                  <>
                    <span className="spinnerOnBtn" />
                    Googleへ移動中…
                  </>
                ) : (
                  <>
                    <span className="gIcon" aria-hidden="true">
                      G
                    </span>
                    Googleでログイン
                  </>
                )}
              </button>

              <div className="foot">
                <span className="muted">
                  続行すると、利用規約・プライバシーポリシーに同意したものとみなします。
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const styles = `
:root{
  --bg:#f7f8fb;
  --surface:#ffffff;
  --border:#e5e7eb;
  --text:#111827;
  --muted:#6b7280;
  --primary:#2563eb;
}

.page{
  min-height:100vh;
  background:var(--bg);
  color:var(--text);
  display:flex;
  align-items:center;
  justify-content:center;
  padding:24px 12px;
}

.wrap{
  width:100%;
  max-width:420px;
}

.card{
  width:100%;
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:16px;
  padding:18px;
  box-shadow:0 10px 30px rgba(17,24,39,0.06);
}

.head{
  display:flex;
  flex-direction:column;
  gap:8px;
  margin-bottom:14px;
}

.logo{
  font-weight:900;
  letter-spacing:-0.02em;
  color:var(--text);
  font-size:14px;
}

.title{
  margin:0;
  font-size:22px;
  letter-spacing:-0.02em;
}

.sub{
  margin:0;
  color:var(--muted);
  font-size:13px;
  line-height:1.6;
}

.loading{
  display:flex;
  align-items:center;
  gap:10px;
  padding:14px 4px 6px;
  color:var(--muted);
  font-weight:700;
}

.spinner{
  width:16px;
  height:16px;
  border-radius:999px;
  border:2px solid rgba(0,0,0,0.15);
  border-top-color:rgba(0,0,0,0.55);
  animation:spin .8s linear infinite;
}

.error{
  border:1px solid #fecaca;
  background:#fff1f2;
  border-radius:14px;
  padding:12px;
  margin-bottom:12px;
}

.errorTitle{
  font-weight:900;
  color:#9f1239;
  font-size:13px;
  margin-bottom:4px;
}

.errorMsg{
  color:#9f1239;
  font-size:12px;
  line-height:1.6;
  word-break:break-word;
}

.btn{
  width:100%;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:10px;
  padding:12px 14px;
  border-radius:14px;
  border:1px solid transparent;
  font-weight:900;
  cursor:pointer;
  transition:all .15s ease;
  white-space:nowrap;
}

.btnPrimary{
  background:var(--primary);
  color:#fff;
  box-shadow:0 1px 2px rgba(0,0,0,0.05);
}

.btnPrimary:hover{
  transform:translateY(-1px);
  box-shadow:0 8px 18px rgba(37,99,235,0.20);
}

.btnDisabled{
  background:#e5e7eb;
  color:#9ca3af;
  cursor:not-allowed;
}

.gIcon{
  width:22px;
  height:22px;
  border-radius:7px;
  background:#fff;
  color:#111;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  font-weight:900;
  border:1px solid rgba(0,0,0,0.12);
}

.spinnerOnBtn{
  width:16px;
  height:16px;
  border-radius:999px;
  border:2px solid rgba(255,255,255,0.35);
  border-top-color:#fff;
  animation:spin .8s linear infinite;
}

.foot{
  margin-top:12px;
}

.muted{
  color:var(--muted);
  font-size:12px;
  line-height:1.6;
  display:block;
}

@keyframes spin{
  to{ transform:rotate(360deg); }
}

@media (max-width:480px){
  .card{ padding:16px; }
  .title{ font-size:20px; }
}
`;
