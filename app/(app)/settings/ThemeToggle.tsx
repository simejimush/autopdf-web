"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const isDark = saved === "dark";
    setDark(isDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          marginBottom: 12,
          color: "var(--fg, #0f172a)",
        }}
      >
        表示設定
      </div>

      <div
        style={{
          background: "var(--surface, #ffffff)",
          border: "1px solid var(--border, #e2e8f0)",
          borderRadius: 18,
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "var(--sh-2, 0 8px 24px rgba(15, 23, 42, 0.06))",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--fg, #0f172a)",
          }}
        >
          ダークモード
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-label="ダークモード切替"
          disabled={!mounted}
          style={{
            width: 68,
            height: 36,
            borderRadius: 999,
            border: "none",
            cursor: mounted ? "pointer" : "default",
            background: dark ? "#0f172a" : "var(--surface-2, #e2e8f0)",
            position: "relative",
            transition: "0.2s",
            opacity: mounted ? 1 : 0.7,
          }}
        >
          <span
            style={{
              position: "absolute",
              left: dark ? 38 : 8,
              top: 6,
              fontSize: 20,
              lineHeight: 1,
              transition: "0.2s",
            }}
          >
            {dark ? "🌙" : "🌞"}
          </span>
        </button>
      </div>
    </div>
  );
}
