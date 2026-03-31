"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const isDark = saved === "dark";
    setDark(isDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        表示設定
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500 }}>ダークモード</div>

        <button
          onClick={toggle}
          style={{
            width: 64,
            height: 32,
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            background: dark ? "#0f172a" : "#e2e8f0",
            position: "relative",
            transition: "0.2s",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: dark ? 34 : 6,
              top: 4,
              fontSize: 20,
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
