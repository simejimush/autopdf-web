// app/(app)/AppTopbar.tsx
"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ProfileMenu from "@/components/profile/ProfileMenu";
import { getMyProfileAction } from "@/app/actions/profile";

type UserLite = { email?: string | null } | null;

export default function AppTopbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserLite>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [plan, setPlan] = useState<"free" | "pro" | "pro_plus">("free");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // user取得
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;

      setUser(data.user ? { email: data.user.email } : null);

      // 👇 追加：profile取得
      try {
        const profile = await getMyProfileAction();
        if (!cancelled && profile?.plan) {
          setPlan(profile.plan);
        }
      } catch (e) {
        // 失敗してもUI壊さない（Quality Rules）
        console.error("failed to load profile", e);
      }
    };

    load();

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
          <a
            className={`navLink ${isActive("/dashboard") ? "navActive" : ""}`}
            href="/dashboard"
          >
            ダッシュボード
          </a>
          <a
            className={`navLink ${isActive("/rules") ? "navActive" : ""}`}
            href="/rules"
          >
            ルール
          </a>
        </nav>

        <div className="right">
          <ProfileMenu />
          <div className="planBadge">
            {plan === "pro" ? "Pro" : plan === "pro_plus" ? "Pro+" : "Free"}
          </div>
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
          <a
            className="navMobileLink"
            href="/dashboard"
            onClick={() => setMenuOpen(false)}
          >
            ダッシュボード
          </a>
          <a
            className="navMobileLink"
            href="/rules"
            onClick={() => setMenuOpen(false)}
          >
            ルール
          </a>
          <ProfileMenu />
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
  background: color-mix(in srgb, var(--background) 85%, transparent);
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
  color:var(--fg);
  font-weight:900;
}

.brandMark{
  width:12px;
  height:12px;
  border-radius:4px;
  background:#0075e8;
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
  background:var(--surface-2);
  color:var(--fg);
}

.navActive{
  background:var(--surface-2);
  color:var(--fg);
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
  padding:7px 10px;
  border:1px solid var(--border);
  background:var(--surface);
  border-radius:999px;
  max-width:280px;
}

.dot{
  width:8px;
  height:8px;
  border-radius:999px;
  background:var(--ok);
}

.userEmail{
  font-size:12px;
  font-weight:800;
  color:var(--fg);
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}

.btnGhost{
  padding:6px 10px;
  border-radius:999px;
  border:1px solid var(--border);
  background:var(--surface);
  color:var(--muted);
  font-weight:900;
  font-size:12px;
  cursor:pointer;
}

.btnGhost:hover{
  background:var(--surface-2);
  color:var(--fg);
}

.menuBtn{
  display:none;
  padding:8px 10px;
  border-radius:12px;
  border:1px solid var(--border);
  background:var(--surface);
  cursor:pointer;
  font-weight:900;
  color:var(--fg);
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
  color:var(--fg);
  font-weight:900;
}

.navMobileLink:hover{ background:var(--surface-2); }

.navMobileBtn{
  width:100%;
  margin-top:8px;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid rgba(239,68,68,0.3);
  background:rgba(239,68,68,0.08);
  color:#ef4444;
  font-weight:900;
  cursor:pointer;
}
  .planBadge {
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
  border: 1px solid var(--border);
  background: var(--surface-2);
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
