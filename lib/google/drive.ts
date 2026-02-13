import { google } from "googleapis";
import { getOAuthClientForUser } from "./auth";
import { Readable } from "node:stream";

export async function uploadPdfToDrive(params: {
  userId: string;
  folderId: string;
  filename: string;
  pdfBytes: Uint8Array;
}) {
  const auth = await getOAuthClientForUser(params.userId);
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: {
      name: params.filename,
      parents: [params.folderId],
      mimeType: "application/pdf",
    },
    media: {
      mimeType: "application/pdf",
      body: Readable.from(Buffer.from(params.pdfBytes)),

    },
    fields: "id, webViewLink",
  });

  return {
    fileId: res.data.id!,
    webViewLink: res.data.webViewLink ?? null,
  };
}
