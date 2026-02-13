import { google } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getOAuthClientForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("google_connections")
    .select("access_token_enc, refresh_token_enc")
    .eq("user_id", userId)
    .eq("status", "connected")
    .limit(1);

  if (error) throw error;
  const conn = data?.[0];
  if (!conn) throw new Error("Google connection not found");

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    access_token: conn.access_token_enc,
    refresh_token: conn.refresh_token_enc,
  });

  return oauth2Client;
}
