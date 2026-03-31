import { google, gmail_v1 } from "googleapis";
import { getOAuthClientForUser } from "./auth";

function decodeBase64Url(input?: string | null) {
  if (!input) return "";
  return Buffer.from(
    input.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf-8");
}

async function readPartBodyData(params: {
  gmail: gmail_v1.Gmail;
  messageId: string;
  part?: gmail_v1.Schema$MessagePart;
}) {
  const { gmail, messageId, part } = params;
  if (!part?.body) return "";

  if (part.body.data) {
    return decodeBase64Url(part.body.data);
  }

  if (part.body.attachmentId) {
    const res = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: part.body.attachmentId,
    });
    return decodeBase64Url(res.data.data);
  }

  return "";
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/table>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

async function collectPartsByMime(params: {
  gmail: gmail_v1.Gmail;
  messageId: string;
  part?: gmail_v1.Schema$MessagePart;
  mimeType: string;
}): Promise<string[]> {
  const { gmail, messageId, part, mimeType } = params;
  if (!part) return [];

  const out: string[] = [];

  if (part.mimeType === mimeType) {
    const text = await readPartBodyData({ gmail, messageId, part });
    if (text.trim()) out.push(text);
  }

  for (const child of part.parts ?? []) {
    out.push(
      ...(await collectPartsByMime({
        gmail,
        messageId,
        part: child,
        mimeType,
      })),
    );
  }

  return out;
}

async function extractBodyText(params: {
  gmail: gmail_v1.Gmail;
  messageId: string;
  payload?: gmail_v1.Schema$MessagePart;
}) {
  const { gmail, messageId, payload } = params;
  if (!payload) return "";

  const plainTexts = (
    await collectPartsByMime({
      gmail,
      messageId,
      part: payload,
      mimeType: "text/plain",
    })
  )
    .map((x) => x.trim())
    .filter(Boolean);

  const htmlTexts = (
    await collectPartsByMime({
      gmail,
      messageId,
      part: payload,
      mimeType: "text/html",
    })
  )
    .map((x) => stripHtml(x))
    .filter(Boolean);

  const plainJoined = plainTexts.join("\n\n").trim();
  const htmlJoined = htmlTexts.join("\n\n").trim();

  // HTMLメールは text/plain が短い要約になっていることがあるので、
  // 長い方を採用する
  if (htmlJoined.length > plainJoined.length) {
    return htmlJoined;
  }
  if (plainJoined) {
    return plainJoined;
  }
  if (htmlJoined) {
    return htmlJoined;
  }

  const fallback = await readPartBodyData({ gmail, messageId, part: payload });
  return fallback.trim();
}

export async function searchGmail({
  userId,
  query,
  maxResults = 10,
}: {
  userId: string;
  query: string;
  maxResults?: number;
}) {
  const oauth2Client = await getOAuthClientForUser(userId);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  return (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
}

export async function getGmailMessage({
  userId,
  messageId,
}: {
  userId: string;
  messageId: string;
}) {
  const oauth2Client = await getOAuthClientForUser(userId);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = res.data.payload?.headers ?? [];

  const pick = (name: string) =>
    headers.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())
      ?.value ?? "";

  const bodyTextRaw = await extractBodyText({
    gmail,
    messageId,
    payload: res.data.payload,
  });

  const bodyText = bodyTextRaw.trim() || (res.data.snippet ?? "").trim();

  return {
    id: res.data.id,
    threadId: res.data.threadId,
    subject: pick("Subject"),
    from: pick("From"),
    date: pick("Date"),
    snippet: res.data.snippet ?? "",
    bodyText,
  };
}
