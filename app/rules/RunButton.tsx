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

  const isDisabled = loading || disabled;

  return (
    <>
      <style>{buttonStyles}</style>

      <button
        disabled={isDisabled}
        className={`runBtn ${isDisabled ? "runBtnDisabled" : "runBtnPrimary"}`}
        onClick={async () => {
          if (isDisabled) return;

          setLoading(true);

          try {
            const res = await fetch(`/api/rules/${ruleId}/run`, {
              method: "POST",
            });

            const data = await res.json();

            if (!res.ok) {
              alert(data.error ?? "実行に失敗しました");
            } else {
              alert(data.message ?? "実行が完了しました");
            }
          } catch {
            alert("通信エラーが発生しました");
          }

          setLoading(false);
        }}
      >
        {loading ? (
          <span className="spinnerWrap">
            <span className="spinner" />
            実行中…
          </span>
        ) : (
          "実行"
        )}
      </button>
    </>
  );
}

const buttonStyles = `
.runBtn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:8px 14px;
  font-size:13px;
  font-weight:700;
  border-radius:12px;
  border:1px solid transparent;
  transition:all .15s ease;
  white-space:nowrap;
}

.runBtnPrimary{
  background:var(--primary);
  color:#fff;
  box-shadow:0 1px 2px rgba(0,0,0,0.05);
}

.runBtnPrimary:hover{
  transform:translateY(-1px);
  box-shadow:0 3px 8px rgba(0,0,0,0.08);
}

.runBtnDisabled{
  background:#e5e7eb;
  color:#9ca3af;
  cursor:not-allowed;
}

.spinnerWrap{
  display:flex;
  align-items:center;
  gap:6px;
}

.spinner{
  width:14px;
  height:14px;
  border:2px solid rgba(255,255,255,0.4);
  border-top-color:#fff;
  border-radius:50%;
  animation:spin .8s linear infinite;
}

@keyframes spin{
  to{ transform:rotate(360deg); }
}

/* モバイル最適化 */
@media (max-width:768px){
  .runBtn{
    padding:10px 14px;
    font-size:14px;
  }
}
`;
