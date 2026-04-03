"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/lib/ui";

type Props = {
  id: string;
  isActive: boolean;
};

export default function RuleToggle({ id, isActive }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // 楽観的UI用のローカル状態
  const [localActive, setLocalActive] = useState(isActive);

  // 通信中フラグ（連打防止）
  const [saving, setSaving] = useState(false);

  // 親の値が変わったら同期（refresh時など）
  useEffect(() => {
    setLocalActive(isActive);
  }, [isActive]);

  const toggle = async () => {
    if (saving || isPending) return;

    const next = !localActive;

    // ① 先に見た目だけ即切り替え
    setLocalActive(next);
    setSaving(true);

    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      });

      // ② 失敗したら元に戻す
      if (!res.ok) {
        setLocalActive(!next);
        return;
      }

      // ③ 成功したら裏で同期
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setLocalActive(!next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Button
      onClick={toggle}
      disabled={isPending || saving}
      style={{
        padding: "6px 12px",
        borderRadius: "999px",
        border: "1px solid",
        fontSize: "12px",
        cursor: isPending || saving ? "default" : "pointer",
        background: localActive ? "#DCFCE7" : "#F3F4F6",
        borderColor: localActive ? "#16A34A" : "#D1D5DB",
        color: localActive ? "#166534" : "#374151",
        opacity: isPending || saving ? 0.7 : 1,
      }}
    >
      {localActive ? "ON" : "OFF"}
    </Button>
  );
}
