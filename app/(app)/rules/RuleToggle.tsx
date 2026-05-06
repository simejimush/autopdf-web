"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/lib/ui";

type Props = {
  id: string;
  isActive: boolean;
  isFreeOverflow?: boolean;
};

export default function RuleToggle({
  id,
  isActive,
  isFreeOverflow = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [localActive, setLocalActive] = useState(isActive);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalActive(isActive);
  }, [isActive]);

  const toggle = async () => {
    if (saving || isPending) return;

    const next = !localActive;

    if (isFreeOverflow && next) {
      toast.error(
        "Freeプランでは有効化できるルールは3件までです。Proに戻すとこのルールをONにできます。",
      );
      return;
    }

    setLocalActive(next);
    setSaving(true);

    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      });

      if (!res.ok) {
        setLocalActive(!next);
        return;
      }

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
        height: "30px",
        minWidth: localActive ? "44px" : "48px",
        padding: "0 10px",
        borderRadius: "999px",
        border: "1px solid",
        fontSize: "11px",
        fontWeight: 600,
        lineHeight: 1,
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
