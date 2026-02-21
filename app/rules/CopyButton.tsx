"use client";

import * as React from "react";

export default function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = React.useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setOk(true);
      setTimeout(() => setOk(false), 1200);
    } catch {
      alert("コピーに失敗しました");
    }
  }

  return (
    <>
      <style>{styles}</style>

      <button
        type="button"
        onClick={onCopy}
        className={`copyBtn ${ok ? "copySuccess" : ""}`}
        title="検索条件をコピー"
      >
        {ok ? "コピー完了" : "コピー"}
      </button>
    </>
  );
}

const styles = `
.copyBtn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:8px 14px;
  font-size:13px;
  font-weight:700;
  border-radius:12px;
  border:1px solid var(--border);
  background:var(--surface);
  color:var(--primary);
  cursor:pointer;
  transition:all .15s ease;
  white-space:nowrap;
}

.copyBtn:hover{
  background:#f3f4f6;
  transform:translateY(-1px);
}

.copySuccess{
  background:#22c55e;
  border-color:#22c55e;
  color:#fff;
}

@media (max-width:768px){
  .copyBtn{
    padding:10px 14px;
    font-size:14px;
  }
}
`;