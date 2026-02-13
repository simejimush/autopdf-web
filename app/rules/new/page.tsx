"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewRulePage() {
  const router = useRouter();
  const [driveFolderId, setDriveFolderId] = useState("");
  const [subjectKeywords, setSubjectKeywords] =
    useState("請求書, 領収書, 明細");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const keywords = subjectKeywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        drive_folder_id: driveFolderId,
        subject_keywords: keywords.length ? keywords : null,
      };

      const res = await fetch("/api/rules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}) as any);
        throw new Error(json?.error ?? `Failed to create rule (${res.status})`);
      }

      // 成功したら一覧へ戻る
      router.push("/rules");
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 720 }}>
      <h1>Create rule</h1>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div>Drive folder ID（必須）</div>
          <input
            value={driveFolderId}
            onChange={(e) => setDriveFolderId(e.target.value)}
            placeholder="1CGAvmh..."
            style={input}
            required
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div>Subject keywords（カンマ区切り）</div>
          <input
            value={subjectKeywords}
            onChange={(e) => setSubjectKeywords(e.target.value)}
            placeholder="請求書, 領収書, 明細"
            style={input}
          />
        </label>

        {error && <pre style={{ color: "salmon" }}>error: {error}</pre>}

        <div style={{ display: "flex", gap: 12 }}>
          <button type="submit" disabled={loading} style={btnPrimary}>
            {loading ? "Creating..." : "Create"}
          </button>
          <a href="/rules" style={{ alignSelf: "center" }}>
            Cancel
          </a>
        </div>
      </form>
    </main>
  );
}

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "transparent",
  color: "inherit",
};

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #444",
  background: "#111",
  color: "inherit",
  cursor: "pointer",
};
