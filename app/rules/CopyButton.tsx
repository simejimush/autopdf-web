"use client";

import * as React from "react";

export default function CopyButton(props: { text: string }) {
  const [ok, setOk] = React.useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(props.text);
      setOk(true);
      setTimeout(() => setOk(false), 900);
    } catch {
      // 失敗時は何もしない（必要なら alert に変えてOK）
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid #333",
        background: ok ? "#22c55e" : "#111",
        color: "#fff",
        cursor: "pointer",
        fontSize: 12,
      }}
      title="Copy Gmail query"
    >
      {ok ? "Copied" : "Copy"}
    </button>
  );
}