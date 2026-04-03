"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type Props = {
  ruleId: string;
  ruleName: string;
};

export default function DeleteButton({ ruleId, ruleName }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setLoading(true);

    try {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        router.refresh();
        setOpen(false);
      } else {
        toast.error("削除に失敗しました");
      }
    } catch (e) {
      toast.error("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        style={{
          padding: "2px 10px",
          borderRadius: 999,
          border: "1px solid #fecaca",
          background: "#fff",
          color: "#b91c1c",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
        onClick={() => setOpen(true)}
      >
        削除
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              background: "#fff",
              padding: 20,
              borderRadius: 16,
              width: 360,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>ルールを削除しますか？</h3>

            <p style={{ fontSize: 14 }}>
              「{ruleName}」を削除します。
              <br />
              この操作は元に戻せません。
            </p>

            <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
              <button onClick={() => setOpen(false)}>キャンセル</button>

              <button
                style={{
                  background: "#dc2626",
                  color: "#fff",
                  borderRadius: 8,
                  padding: "6px 12px",
                }}
                disabled={loading}
                onClick={handleDelete}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
