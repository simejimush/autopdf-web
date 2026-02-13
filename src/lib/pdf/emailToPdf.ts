import { PDFDocument, StandardFonts } from "pdf-lib";

type EmailForPdf = {
  subject?: string;
  from?: string;
  date?: string;
  snippet?: string;
  bodyText?: string; // getGmailMessageから取れるなら入れる
};

export async function emailToPdfBytes(e: EmailForPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const lines = [
    `Subject: ${e.subject ?? ""}`,
    `From: ${e.from ?? ""}`,
    `Date: ${e.date ?? ""}`,
    "",
    e.bodyText ?? e.snippet ?? "",
  ]
    .join("\n")
    .split("\n");

  let y = 800;
  for (const line of lines) {
    page.drawText(line.slice(0, 2000), { x: 40, y, size: 11, font });
    y -= 14;
    if (y < 40) break;
  }

  return await pdf.save();
}
