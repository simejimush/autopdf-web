"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getRuleStatus } from "../../../src/lib/rules/status";

type Rule = {
  id: string;
  is_active: boolean;
  run_timing: string | null;
  drive_folder_id: string | null;
  gmail_query: string | null;
  subject_keywords?: any;
  updated_at: string | null;
};

function normalizeQuery(q: unknown) {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s || s === "-") return null;
  return s;
}

function parseKeywords(input: string) {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildGmailQueryFromKeywords(keywords: string[]) {
  const subjectPart =
    keywords.length > 0
      ? ` subject:(${keywords.map((k) => `"${k.replace(/"/g, "")}"`).join(" OR ")})`
      : "";
  return `label:INBOX is:unread newer_than:7d${subjectPart}`;
}

export default function RuleEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const ruleId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rule, setRule] = useState<Rule | null>(null);

  // フォーム項目
  const [isActive, setIsActive] = useState<boolean>(true);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [subjectKeywordsText, setSubjectKeywordsText] = useState("");

  const keywords = useMemo(
    () => parseKeywords(subjectKeywordsText),
    [subjectKeywordsText],
  );
  const previewQuery = useMemo(
    () => buildGmailQueryFromKeywords(keywords),
    [keywords],
  );

  useEffect(() => {
    if (!ruleId) {
      setError("id is required");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/rules/${ruleId}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          data?: Rule;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(json?.error ?? `Failed to load rule (${res.status})`);
        }

        if (!json.data) {
          throw new Error("Rule not found");
        }

        if (cancelled) return;

        const found = json.data;
        const status = getRuleStatus(found);
        const normalized =
          status.status === "needs_setup"
            ? { ...found, is_active: false }
            : found;

        setRule(normalized);
        setDriveFolderId(normalized.drive_folder_id ?? "");

        const sk = (normalized as any).subject_keywords;

        const initialKeywords = Array.isArray(sk) ? sk.map(String) : [];
        setSubjectKeywordsText(initialKeywords.join(", "));
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unexpected error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [ruleId]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (!driveFolderId.trim()) {
        throw new Error("Drive folder ID is required");
      }

      const payload = {
        drive_folder_id: driveFolderId,
        subject_keywords: keywords.length ? keywords : null,
        gmail_query: previewQuery, // ★これを必ず送る
        is_active: isActive,
      };

      const res = await fetch(`/api/rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed to update rule (${res.status})`);
      }

      router.push("/rules");
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  const currentQuery = normalizeQuery(rule?.gmail_query);

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
        Edit rule
      </h1>

      {loading && <p>Loading...</p>}
      {error && <p style={{ color: "#ef4444" }}>error: {error}</p>}

      {!loading && rule && (
        <form onSubmit={onSave} style={{ display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
              Rule ID
            </div>
            <div
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {rule.id}
            </div>
          </div>

          <label className="block text-sm font-medium mb-2">Active</label>
          <label className="inline-flex items-center gap-2 mb-6">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>{isActive ? "ON" : "OFF"}</span>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Drive folder ID (required)</span>
            <input
              value={driveFolderId}
              onChange={(e) => setDriveFolderId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "transparent",
                color: "inherit",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Subject keywords (comma separated)</span>
            <input
              value={subjectKeywordsText}
              onChange={(e) => setSubjectKeywordsText(e.target.value)}
              placeholder="例: 請求書, 領収書, 明細"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #333",
                background: "transparent",
                color: "inherit",
              }}
            />
          </label>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              Gmail query preview（保存される値）
            </div>
            <div
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                border: "1px solid #333",
                borderRadius: 8,
                padding: 12,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              title={previewQuery}
            >
              {previewQuery}
            </div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13, opacity: 0.8 }}>
              Current gmail_query (DB)
            </div>
            <div
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {currentQuery ?? "⚠ 未設定"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #333",
                background: saving ? "#222" : "transparent",
                color: "inherit",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>

            <button
              type="button"
              onClick={() => router.push("/rules")}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #333",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Back
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
