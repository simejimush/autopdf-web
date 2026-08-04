import { google } from "googleapis";
import { getOAuthClientForUser } from "./auth";
import { Readable } from "node:stream";

const DRIVE_UPLOAD_STAGES = [
  "drive_create_auth",
  "drive_lookup_complete",
  "drive_existing_match",
  "drive_media_prepare",
  "drive_create_request",
] as const;

export type DriveUploadStage = (typeof DRIVE_UPLOAD_STAGES)[number];

const DRIVE_UPLOAD_STAGE_SET = new Set<DriveUploadStage>(DRIVE_UPLOAD_STAGES);

const GOOGLE_CREDENTIAL_ERROR_CODES = new Set([
  "GOOGLE_TOKEN_KEY_MISSING",
  "GOOGLE_TOKEN_KEY_INVALID",
  "GOOGLE_TOKEN_KEY_ID_UNKNOWN",
  "GOOGLE_TOKEN_FORMAT_UNSUPPORTED",
  "GOOGLE_TOKEN_DECRYPT_FAILED",
  "GOOGLE_TOKEN_INPUT_INVALID",
  "GOOGLE_TOKEN_ENCRYPT_FAILED",
  "GOOGLE_TOKEN_WRITE_DISABLED",
  "GOOGLE_TOKEN_STORE_FAILED",
  "GOOGLE_TOKEN_UPDATE_CONFLICT",
  "GOOGLE_TOKEN_ROW_NOT_FOUND",
  "GOOGLE_TOKEN_ROW_DUPLICATE",
  "GOOGLE_CONNECTION_NOT_FOUND",
  "GOOGLE_REFRESH_TOKEN_MISSING",
  "GOOGLE_TOKEN_INVALID",
  "GOOGLE_PERMISSION_DENIED",
  "GOOGLE_TOKEN_REFRESH_FAILED",
]);

type DriveClient = ReturnType<typeof google.drive>;

export class DriveUploadError extends Error {
  readonly code = "DRIVE_UPLOAD_FAILED";
  readonly stage: DriveUploadStage;

  constructor(stage: DriveUploadStage) {
    super("DRIVE_UPLOAD_FAILED");
    this.name = "DriveUploadError";
    this.stage = stage;
  }
}

function getExplicitErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;

  try {
    return "code" in error ? error.code : undefined;
  } catch {
    return undefined;
  }
}

function throwDriveUploadError(error: unknown, stage: DriveUploadStage): never {
  const code = getExplicitErrorCode(error);

  if (typeof code === "string" && GOOGLE_CREDENTIAL_ERROR_CODES.has(code)) {
    throw error;
  }

  throw new DriveUploadError(stage);
}

function logDriveStage(
  stage: DriveUploadStage,
  diagnostic?:
    | { existingMatch: boolean }
    | { mediaBodyIsNodeReadable: boolean },
) {
  if (!DRIVE_UPLOAD_STAGE_SET.has(stage)) return;

  console.info("[drive] upload stage", {
    stage,
    ...(diagnostic ?? {}),
  });
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findDriveFileByNameInFolderWithClient(params: {
  drive: DriveClient;
  folderId: string;
  filename: string;
}) {
  const folderId = escapeDriveQueryValue(params.folderId);
  const filename = escapeDriveQueryValue(params.filename);

  const res = await params.drive.files.list({
    q: `'${folderId}' in parents and name = '${filename}' and trashed = false`,
    pageSize: 1,
    fields: "files(id, webViewLink)",
  });

  const file = res.data.files?.[0];

  if (!file?.id) {
    return null;
  }

  return {
    fileId: file.id,
    webViewLink: file.webViewLink ?? null,
  };
}

export async function findDriveFileByNameInFolder(params: {
  userId: string;
  folderId: string;
  filename: string;
}) {
  const auth = await getOAuthClientForUser(params.userId);
  const drive = google.drive({ version: "v3", auth });

  return findDriveFileByNameInFolderWithClient({
    drive,
    folderId: params.folderId,
    filename: params.filename,
  });
}

export async function uploadFileToDrive(params: {
  userId: string;
  folderId: string;
  filename: string;
  bytes: Uint8Array | Buffer;
  mimeType: string;
}) {
  let drive: DriveClient;

  try {
    logDriveStage("drive_create_auth");
    const auth = await getOAuthClientForUser(params.userId);
    drive = google.drive({ version: "v3", auth });
  } catch (error) {
    throwDriveUploadError(error, "drive_create_auth");
  }

  let existing;

  try {
    existing = await findDriveFileByNameInFolderWithClient({
      drive,
      folderId: params.folderId,
      filename: params.filename,
    });
  } catch (error) {
    throwDriveUploadError(error, "drive_create_auth");
  }

  logDriveStage("drive_lookup_complete", {
    existingMatch: Boolean(existing),
  });

  if (existing) {
    logDriveStage("drive_existing_match", { existingMatch: true });
    return existing;
  }

  let mediaBody: Readable;

  try {
    const byteCopy = Buffer.from(params.bytes);
    mediaBody = Readable.from([byteCopy]);
    logDriveStage("drive_media_prepare", {
      mediaBodyIsNodeReadable:
        typeof mediaBody.pipe === "function" && mediaBody.readable !== false,
    });
  } catch (error) {
    throwDriveUploadError(error, "drive_media_prepare");
  }

  let res;

  try {
    logDriveStage("drive_create_request");
    res = await drive.files.create({
      requestBody: {
        name: params.filename,
        parents: [params.folderId],
        mimeType: params.mimeType,
      },
      media: {
        mimeType: params.mimeType,
        body: mediaBody,
      },
      fields: "id, webViewLink",
    });
  } catch (error) {
    throwDriveUploadError(error, "drive_create_request");
  }

  return {
    fileId: res.data.id!,
    webViewLink: res.data.webViewLink ?? null,
  };
}

export async function uploadPdfToDrive(params: {
  userId: string;
  folderId: string;
  filename: string;
  pdfBytes: Uint8Array;
}) {
  return uploadFileToDrive({
    userId: params.userId,
    folderId: params.folderId,
    filename: params.filename,
    bytes: params.pdfBytes,
    mimeType: "application/pdf",
  });
}
