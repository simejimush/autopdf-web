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
      style={{
        marginRight: 8,
        padding: "4px 10px",
        fontSize: 12,
        borderRadius: 6,
        background: disabled ? "#333" : loading ? "#555" : "#2563eb",
        color: "#fff",
        border: "none",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onClick={async () => {
        setLoading(true);

        const res = await fetch(`/api/rules/${ruleId}/run`, {
          method: "POST",
        });

        const data = await res.json();

        if (!res.ok) {
          alert(data.error ?? "Run failed");
        } else {
          alert(data.message ?? "Run finished");
        }

        setLoading(false);
      }}
    >
      {loading ? "Running..." : "Run"}
    </button>
  );
}
