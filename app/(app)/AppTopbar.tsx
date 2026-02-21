// app/(app)/AppTopbar.tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type UserLite = { email?: string | null } | null;

export default function AppTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserLite>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user ? { email: data.user.email } : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + "/");

  return (
    <header className="topbar">
      <style>{styles}</style>

      <div className="topbarInner">
        <a className="brand" href="/dashboard">
          <span className="brandMark" aria-hidden="true" />
          <span className="brandName">AutoPDF</span>
        </a>

        <nav className="navDesktop" aria-label="primary">
          <a className={`navLink ${isActive("/dashboard") ? "navActive" : ""}`} href="/dashboard">
            ダッシュボード
          </a>
          <a className={`navLink ${isActive("/rules") ? "navActive" : ""}`} href="/rules">
            ルール
          </a>
        </nav>

        <div className="right">
          <div className="userPill" title={user?.email ?? ""}>
            <span className="dot" />
            <span className="userEmail">{user?.email ?? "ログイン中"}</span>
          </div>

          <button className="btnGhost" onClick={signOut}>
            ログアウト
          </button>

          <button
            className="menuBtn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="メニュー"
          >
            ☰
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="navMobile">
          <a className="navMobileLink" href="/dashboard" onClick={() => setMenuOpen(false)}>
            ダッシュボード
          </a>
          <a className="navMobileLink" href="/rules" onClick={() => setMenuOpen(false)}>
            ルール
          </a>
          <button className="navMobileBtn" onClick={signOut}>
            ログアウト
          </button>
        </div>
      )}
    </header>
  );
}

const styles = `
.topbar{
  position:sticky;
  top:0;
  z-index:20;
  background:rgba(247,248,251,0.85);
  backdrop-filter:saturate(1.2) blur(10px);
  border-bottom:1px solid var(--border);
}

.topbarInner{
  max-width:1100px;
  margin:0 auto;
  padding:12px 16px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
}

.brand{
  display:flex;
  align-items:center;
  gap:10px;
  text-decoration:none;
  color:var(--text);
  font-weight:900;
}

.brandMark{
  width:12px;
  height:12px;
  border-radius:4px;
  background:var(--primary);
  display:inline-block;
}

.brandName{ letter-spacing:-0.02em; }

.navDesktop{
  display:flex;
  gap:8px;
  align-items:center;
}

.navLink{
  padding:8px 10px;
  border-radius:10px;
  text-decoration:none;
  color:var(--muted);
  font-weight:800;
  font-size:13px;
}

.navLink:hover{
  background:#eef2ff;
  color:var(--text);
}

.navActive{
  background:#eef2ff;
  color:var(--text);
}

.right{
  display:flex;
  align-items:center;
  gap:10px;
}

.userPill{
  display:flex;
  align-items:center;
  gap:8px;
  padding:8px 10px;
  border:1px solid var(--border);
  background:var(--surface);
  border-radius:999px;
  max-width:280px;
}

.dot{
  width:8px;
  height:8px;
  border-radius:999px;
  background:#22c55e;
}

.userEmail{
  font-size:12px;
  font-weight:800;
  color:var(--text);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.btnGhost{
  padding:8px 10px;
  border-radius:12px;
  border:1px solid var(--border);
  background:var(--surface);
  color:var(--primary);
  font-weight:900;
  cursor:pointer;
}

.btnGhost:hover{ background:#f3f4f6; }

.menuBtn{
  display:none;
  padding:8px 10px;
  border-radius:12px;
  border:1px solid var(--border);
  background:var(--surface);
  cursor:pointer;
  font-weight:900;
}

.navMobile{
  display:none;
  border-top:1px solid var(--border);
  padding:10px 16px 12px;
  max-width:1100px;
  margin:0 auto;
}

.navMobileLink{
  display:block;
  padding:10px 12px;
  border-radius:12px;
  text-decoration:none;
  color:var(--text);
  font-weight:900;
}

.navMobileLink:hover{ background:#f3f4f6; }

.navMobileBtn{
  width:100%;
  margin-top:8px;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid #fecaca;
  background:#fff1f2;
  color:#b91c1c;
  font-weight:900;
  cursor:pointer;
}

@media (max-width: 900px){
  .userPill{ max-width: 180px; }
}

@media (max-width: 768px){
  .navDesktop{ display:none; }
  .menuBtn{ display:inline-flex; }
  .navMobile{ display:block; }
  .right .btnGhost{ display:none; }
}

@media (max-width: 420px){
  .userPill{ max-width: 140px; }
}
`;