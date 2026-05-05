import { google } from "googleapis";
import { getOAuthClientForUser } from "./auth";
import { Readable } from "node:stream";

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function findDriveFileByNameInFolder(params: {
  userId: string;
  folderId: string;
  filename: string;
}) {
  const auth = await getOAuthClientForUser(params.userId);
  const drive = google.drive({ version: "v3", auth });

  const folderId = escapeDriveQueryValue(params.folderId);
  const filename = escapeDriveQueryValue(params.filename);

  const res = await drive.files.list({
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

export async function uploadFileToDrive(params: {
  userId: string;
  folderId: string;
  filename: string;
  bytes: Uint8Array | Buffer;
  mimeType: string;
}) {
  const existing = await findDriveFileByNameInFolder({
    userId: params.userId,
    folderId: params.folderId,
    filename: params.filename,
  });

  if (existing) {
    return existing;
  }

  const auth = await getOAuthClientForUser(params.userId);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: {
      name: params.filename,
      parents: [params.folderId],
      mimeType: params.mimeType,
    },
    media: {
      mimeType: params.mimeType,
      body: Readable.from(Buffer.from(params.bytes)),
    },
    fields: "id, webViewLink",
  });

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
