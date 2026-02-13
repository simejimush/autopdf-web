// src/lib/rules/status.ts

export type RuleStatus =
  | { status: "ready" }
  | { status: "disabled" }
  | { status: "needs_setup"; reasons: string[] };

function nonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeKeywords(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map(String).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    return v.split(/[,\n]/g).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

export function getRuleStatus(rule: any): RuleStatus {
  const hasQuery =
    nonEmptyString(rule?.gmail_query) ||
    nonEmptyString(rule?.gmail_label_id) ||
    normalizeKeywords(rule?.subject_keywords).length > 0;

  const hasDriveFolder = nonEmptyString(rule?.drive_folder_id);

  if (!hasQuery || !hasDriveFolder) {
    return {
      status: "needs_setup",
      reasons: [
        !hasQuery && "検索条件が未設定",
        !hasDriveFolder && "保存先フォルダが未設定",
      ].filter(Boolean) as string[],
    };
  }

  if (rule?.is_active === false) return { status: "disabled" };

  return { status: "ready" };
}
