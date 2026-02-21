"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type Props = {
  id: string;
  isActive: boolean;
};

export default function RuleToggle({ id, isActive }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const toggle = async () => {
    await fetch(`/api/rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        is_active: !isActive,
      }),
    });

    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      style={{
        padding: "6px 12px",
        borderRadius: "999px",
        border: "1px solid",
        fontSize: "12px",
        cursor: "pointer",
        background: isActive ? "#DCFCE7" : "#F3F4F6",
        borderColor: isActive ? "#16A34A" : "#D1D5DB",
        color: isActive ? "#166534" : "#374151",
      }}
    >
      {isActive ? "ON" : "OFF"}
    </button>
  );
}