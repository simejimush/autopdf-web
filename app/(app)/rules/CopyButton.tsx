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
      // 失敗時は何もしない
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className={`pillBtn ${ok ? "isOk" : ""}`}
      title="検索条件をコピー"
    >
      {ok ? "コピー済み" : "コピー"}
      <style>{styles}</style>
    </button>
  );
}

const styles = `
.pillBtn{
  padding:6px 12px;
  border-radius:999px;
  border:1px solid var(--border);
  background:var(--surface);
  color:var(--primary);
  font-weight:900;
  font-size:12px;
  cursor:pointer;
  white-space:nowrap;
}

.pillBtn:hover{
  background:#f3f4f6;
}

.pillBtn.isOk{
  border-color:rgba(34,197,94,0.35);
  color:var(--ok);
}
`;
