import { google } from "googleapis";
import { getOAuthClientForUser } from "./auth";

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

  // どのGmailで動いてるか確認（デバッグ）
  const profile = await gmail.users.getProfile({ userId: "me" });
  console.log("🔥 gmail account:", profile.data.emailAddress);

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

  // metadata + snippet
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["Subject", "From", "Date"],
  });

  const headers = res.data.payload?.headers ?? [];
  const pick = (name: string) =>
    headers.find((h) => (h.name ?? "").toLowerCase() === name.toLowerCase())
      ?.value ?? "";

  return {
    id: res.data.id,
    threadId: res.data.threadId,
    subject: pick("Subject"),
    from: pick("From"),
    date: pick("Date"),
    snippet: res.data.snippet ?? "",
  };
}
