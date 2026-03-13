import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(new URL("/login", process.env.APP_URL!));
  }

  const { error } = await supabase
    .from("google_connections")
    .update({
      status: "disconnected",
      access_token_enc: null,
      refresh_token_enc: null,
      token_expiry_at: null,
      scopes: null,
      last_verified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.redirect(
      new URL("/settings?google=disconnect_failed", process.env.APP_URL!),
    );
  }

  return NextResponse.redirect(
    new URL("/settings?google=disconnected", process.env.APP_URL!),
  );
}
