import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getOAuthClientForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("google_connections")
    .select("access_token_enc, refresh_token_enc, updated_at")
    .eq("user_id", userId)
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const conn = data?.[0];
  if (!conn) throw new Error("Google connection not found");

  const refreshToken = (conn.refresh_token_enc ?? "").trim();
  const accessToken = (conn.access_token_enc ?? "").trim();

  if (!refreshToken) {
    throw new Error("Google refresh token missing. Please reconnect Google.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in runtime env");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

  // まず refresh_token を必ずセット（これが生命線）
  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    ...(accessToken ? { access_token: accessToken } : {}),
  });

  // ★ここが重要：refresh を強制し、返ってきた token を credentials に確実に反映
  try {
    const at = await oauth2Client.getAccessToken();
    const newAccessToken = at?.token?.trim() ?? "";

    if (!newAccessToken) {
      throw new Error("Failed to refresh access token (no token returned)");
    }

    // credentials に明示的に入れる（これをやると確実に Authorization が付く）
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
      access_token: newAccessToken,
    });

    // DBにも保存（推奨）
    if (newAccessToken !== accessToken) {
      await supabaseAdmin
        .from("google_connections")
        .update({
          access_token_enc: newAccessToken,
          last_verified_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    // デバッグ（Vercelログで確認できる）
    console.log("[google] refreshed access token len=", newAccessToken.length);
  } catch (e: any) {
    // refresh が失敗したら理由を見える化（invalid_grant 等）
    console.error("[google] refresh failed:", e?.message ?? e);
    throw new Error(`Google token refresh failed: ${e?.message ?? "unknown"}`);
  }

  return oauth2Client;
}