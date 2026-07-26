import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { preflightGoogleTokenEncryptionWrite } from "@/lib/google/tokenStore";
import {
  createGoogleOAuthState,
  getGoogleOAuthStateCookieOptions,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
} from "@/lib/google/oauthStateCore";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.redirect(new URL("/login", process.env.APP_URL!));
  }

  try {
    preflightGoogleTokenEncryptionWrite();
  } catch {
    console.error("[google.connect] token write preflight failed", {
      code: "GOOGLE_TOKEN_WRITE_PREFLIGHT_FAILED",
      location: "oauth_connect_preflight",
    });
    return NextResponse.redirect(
      new URL("/settings?google=env_missing", process.env.APP_URL!),
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(
      new URL("/settings?google=env_missing", process.env.APP_URL!),
    );
  }

  let oauthState;
  try {
    oauthState = createGoogleOAuthState({
      userId: data.user.id,
      redirectUri,
      signingSecret: clientSecret,
    });
  } catch {
    console.error("[google.connect] OAuth state creation failed", {
      code: "GOOGLE_OAUTH_STATE_CREATE_FAILED",
      location: "oauth_connect_state",
    });
    return NextResponse.redirect(
      new URL("/settings?google=env_missing", process.env.APP_URL!),
    );
  }

  const scope = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" ");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");

  url.searchParams.set("state", oauthState.state);

  const response = NextResponse.redirect(url.toString());
  response.cookies.set(
    GOOGLE_OAUTH_STATE_COOKIE_NAME,
    oauthState.cookieValue,
    getGoogleOAuthStateCookieOptions({
      secure: new URL(redirectUri).protocol === "https:",
    }),
  );

  return response;
}
