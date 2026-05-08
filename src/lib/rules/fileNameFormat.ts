export const FILE_NAME_FORMATS = [
  "standard",
  "ai_sender_doc",
  "ai_doc_sender",
] as const;

export type FileNameFormat = (typeof FILE_NAME_FORMATS)[number];

export function normalizeFileNameFormat(value: unknown): FileNameFormat {
  if (FILE_NAME_FORMATS.includes(value as FileNameFormat)) {
    return value as FileNameFormat;
  }

  return "standard";
}
