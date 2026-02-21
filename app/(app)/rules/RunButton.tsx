"use client";

import { useState } from "react";

export default function RunButton({
  ruleId,
  disabled,
}: {
  ruleId: string;
  disabled: boolean;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <button
      disabled={loading || disabled}
      className={`pillBtn ${disabled ? "isDisabled" : ""} ${loading ? "isLoading" : ""}`}
      onClick={async () => {
        setLoading(true);
        try {
          const res = await fetch(`/api/rules/${ruleId}/run`, {
            method: "POST",
          });
          const data = await res.json();
          if (!res.ok) alert(data.error ?? "Run failed");
          else alert(data.message ?? "Run finished");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? "実行中…" : "実行"}
      <style>{styles}</style>
    </button>
  );
}

const styles = `
.pillBtn{
  padding:6px 12px;
  border-radius:999px;
  border:1px solid var(--border);
  background:var(--primary);
  color:#fff;
  font-weight:900;
  font-size:12px;
  cursor:pointer;
  white-space:nowrap;
}

.pillBtn:hover{
  transform:translateY(-1px);
  box-shadow:0 8px 18px rgba(37,99,235,0.18);
}

.pillBtn.isDisabled{
  background:var(--surface);
  color:var(--muted);
  cursor:not-allowed;
  opacity:0.75;
  box-shadow:none;
  transform:none;
}

.pillBtn.isLoading{
  opacity:0.9;
}
`;
