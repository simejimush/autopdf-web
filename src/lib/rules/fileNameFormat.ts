export const FILE_NAME_FORMATS = [
  "standard",
  "ai_sender_doc",
  "ai_doc_sender",
] as const;

export type FileNameFormat = (typeof FILE_NAME_FORMATS)[number];
export type FileNameFormatPlan = "free" | "pro" | "pro_plus";

const AI_FILE_NAME_FORMATS = new Set<FileNameFormat>([
  "ai_sender_doc",
  "ai_doc_sender",
]);

export function normalizeFileNameFormat(value: unknown): FileNameFormat {
  if (FILE_NAME_FORMATS.includes(value as FileNameFormat)) {
    return value as FileNameFormat;
  }

  return "standard";
}

export function isAiFileNameFormat(value: unknown): boolean {
  const normalized = normalizeFileNameFormat(value);
  return AI_FILE_NAME_FORMATS.has(normalized);
}

export function normalizeFileNameFormatForPlan(
  value: unknown,
  plan: FileNameFormatPlan,
): FileNameFormat {
  const normalized = normalizeFileNameFormat(value);

  if (plan === "free" && AI_FILE_NAME_FORMATS.has(normalized)) {
    return "standard";
  }

  return normalized;
}
