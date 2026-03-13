"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getMyProfileAction } from "@/app/actions/profile";
import styles from "./ProfileMenu.module.css";

type Profile = {
  user_id: string;
  display_name: string | null;
  company_name: string | null;
};

export default function ProfileMenu() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  async function refreshProfile() {
    const latest = await getMyProfileAction();
    setProfile(latest);
  }

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current) return;
      if (!rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    refreshProfile();

    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });

    const onProfileUpdated = () => {
      refreshProfile();
    };

    window.addEventListener("profile-updated", onProfileUpdated);
    return () => {
      window.removeEventListener("profile-updated", onProfileUpdated);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!profile) return null;

  const display = profile.display_name ?? "プロフィール未設定";

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: "6px 12px",
          borderRadius: 999,
          background: "#f3f4f6",
          fontSize: 14,
        }}
      >
        {display}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "110%",
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 16,
            width: 240,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            zIndex: 50,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{display}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{email}</div>
          </div>

          <button
            className={styles.btnSettings}
            onClick={() => {
              setOpen(false);
              router.push("/settings");
            }}
            style={{
              width: "100%",
              padding: "8px 0",
              borderRadius: 8,
              marginBottom: 8,
            }}
          >
            設定を開く
          </button>

          <button
            className="btnDangerMini"
            onClick={signOut}
            style={{
              padding: "4px 10px",
              borderRadius: 12,
              color: "#b83027",
              fontSize: "0.65rem",
              alignSelf: "flex-start",
              border: "1px solid #fccbca",
            }}
          >
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
}
