import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getOAuthClientForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("google_connections")
    .select("access_token_enc, refresh_token_enc")
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const conn = data?.[0];
  if (!conn) throw new Error("Google connection not found");

  const accessToken = conn.access_token_enc ?? null;
  const refreshToken = conn.refresh_token_enc ?? null;

  if (!refreshToken) {
    throw new Error("Google refresh token missing. Please reconnect Google.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken,
  });

  // ★ここが重要：アクセストークン取得で refresh を発火
  const at = await oauth2Client.getAccessToken();
  const newAccessToken = at?.token ?? null;

  // 更新できたらDBに保存（任意だけど強く推奨）
  if (newAccessToken && newAccessToken !== accessToken) {
    await supabaseAdmin
      .from("google_connections")
      .update({
        access_token_enc: newAccessToken,
        last_verified_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  return oauth2Client;
}