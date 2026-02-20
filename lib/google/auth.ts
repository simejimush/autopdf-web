import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase/admin";

// TODO: ここをあなたの暗号化実装に合わせて差し替え
// 例）import { decryptText, encryptText } from "@/lib/crypto";
function decryptToken(v: string | null) {
  return v ?? null; // ← 暫定：暗号化してるなら必ず復号する
}
function encryptToken(v: string | null) {
  return v ?? null; // ← 暫定：暗号化してるなら必ず暗号化する
}

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

  const accessToken = decryptToken(conn.access_token_enc ?? null);
  const refreshToken = decryptToken(conn.refresh_token_enc ?? null);

  if (!refreshToken) {
    // refresh_token が無いと、access_token が切れた瞬間に詰み
    throw new Error("Google refresh token missing. Reconnect Google.");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    access_token: accessToken ?? undefined,
    refresh_token: refreshToken,
  });

  // ★ここが重要：必ず一度アクセストークンを取得して refresh を発火させる
  const at = await oauth2Client.getAccessToken();
  const newAccessToken = at?.token ?? null;

  // 取れたらDBへ保存（おすすめ）
  if (newAccessToken && newAccessToken !== accessToken) {
    await supabaseAdmin
      .from("google_connections")
      .update({
        access_token_enc: encryptToken(newAccessToken),
        last_verified_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  return oauth2Client;
}