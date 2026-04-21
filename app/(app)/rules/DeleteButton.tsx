"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type Props = {
  ruleId: string;
  ruleName: string;
};

export default function DeleteButton({ ruleId, ruleName }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const root = document.documentElement;

    const syncTheme = () => {
      setIsDark(root.dataset.theme === "dark");
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, []);

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
    } catch {
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
          border: isDark ? "1px solid #940000" : "1px solid #fecaca",
          background: isDark ? "var(--surface)" : "#fff",
          color: isDark ? "#ff0000" : "#b91c1c",
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
              background: "var(--surface)",
              color: "var(--fg)",
              padding: 24,
              borderRadius: 16,
              width: 360,
              boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
              border: "1px solid var(--border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontWeight: 700,
                fontSize: 16,
                marginBottom: 8,
                color: "var(--fg)",
              }}
            >
              ルールを削除しますか？
            </h3>

            <p
              style={{
                fontSize: 14,
                color: "var(--muted)",
                lineHeight: 1.5,
              }}
            >
              「{ruleName}」を削除します。
              <br />
              この操作は元に戻せません。
            </p>

            <div
              style={{
                marginTop: 20,
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
              }}
            >
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                キャンセル
              </button>

              <button
                style={{
                  background: "#cb3636",
                  color: "#ffffff",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  transition: "0.15s",
                }}
                onMouseOver={(e) =>
                  (e.currentTarget.style.background = "#b91c1c")
                }
                onMouseOut={(e) =>
                  (e.currentTarget.style.background = "#cb3636")
                }
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
