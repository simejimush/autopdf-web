"use client";

import { useEffect, useState } from "react";
import {
  getMyProfileAction,
  updateMyProfileAction,
} from "@/app/actions/profile";

type Profile = {
  user_id: string;
  display_name: string | null;
  company_name: string | null;
};

export default function ProfileMenu() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getMyProfileAction().then(setProfile);
  }, []);

  if (!profile) return null;

  const display = profile.display_name ?? "プロフィール未設定";

  return (
    <div style={{ position: "relative" }}>
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
            width: 260,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            zIndex: 50,
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);

              await updateMyProfileAction(fd);

              const latest = await getMyProfileAction();
              setProfile(latest);

              setOpen(false);
            }}
          >
            <label style={{ fontSize: 12 }}>表示名</label>
            <input
              name="display_name"
              defaultValue={profile.display_name ?? ""}
              style={{ width: "100%", marginBottom: 12 }}
            />

            <label style={{ fontSize: 12 }}>会社名</label>
            <input
              name="company_name"
              defaultValue={profile.company_name ?? ""}
              style={{ width: "100%", marginBottom: 12 }}
            />

            <button
              type="submit"
              style={{
                width: "100%",
                padding: "8px 0",
                borderRadius: 8,
                background: "black",
                color: "white",
              }}
            >
              保存
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
