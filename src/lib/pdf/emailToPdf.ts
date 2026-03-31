import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";

type EmailForPdf = {
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  snippet?: string;
  bodyText?: string;
  messageId?: string;
  generatedAt?: string;
};

function safePdfText(value?: string) {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "");
}

function pickBodyText(e: EmailForPdf) {
  const body = safePdfText(e.bodyText).trim();
  const snippet = safePdfText(e.snippet).trim();
  return body || snippet || "";
}

function wrapTextByWidth(params: {
  text: string;
  font: any;
  fontSize: number;
  maxWidth: number;
}) {
  const { text, font, fontSize, maxWidth } = params;
  const srcLines = text.split("\n");
  const out: string[] = [];

  for (const srcLine of srcLines) {
    if (!srcLine) {
      out.push("");
      continue;
    }

    let current = "";

    for (const ch of srcLine) {
      const next = current + ch;
      const width = font.widthOfTextAtSize(next, fontSize);

      if (width <= maxWidth) {
        current = next;
        continue;
      }

      if (current) {
        out.push(current);
        current = ch;
      } else {
        out.push(ch);
        current = "";
      }
    }

    if (current) {
      out.push(current);
    }
  }

  return out;
}

export async function emailToPdfBytes(e: EmailForPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const fontPath = path.join(process.cwd(), "public", "fonts", "ipaexg.ttf");
  const fontBytes = await readFile(fontPath);
  const font = await pdf.embedFont(fontBytes, { subset: false });

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 40;
  const topY = 800;
  const bottomY = 40;
  const lineHeight = 16;

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = topY;

  const body = pickBodyText(e);

  const text = [
    `Subject: ${safePdfText(e.subject)}`,
    `From: ${safePdfText(e.from)}`,
    `To: ${safePdfText(e.to)}`,
    `Date: ${safePdfText(e.date)}`,
    `Message-ID: ${safePdfText(e.messageId)}`,
    `Generated-At: ${safePdfText(e.generatedAt ?? new Date().toISOString())}`,
    "",
    "----------------------------------------",
    "",
    body,
  ].join("\n");

  const fontSize = 11;
  const maxTextWidth = pageWidth - marginX * 2;

  const lines = wrapTextByWidth({
    text,
    font,
    fontSize,
    maxWidth: maxTextWidth,
  });

  for (const line of lines) {
    if (y < bottomY) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = topY;
    }

    page.drawText(line, {
      x: marginX,
      y,
      size: fontSize,
      font,
    });

    y -= lineHeight;
  }

  return await pdf.save();
}
