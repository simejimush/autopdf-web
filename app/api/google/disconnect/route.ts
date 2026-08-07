import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { disconnectGoogleConnection } from "@/lib/google/tokenStore";

export async function POST() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(new URL("/login", process.env.APP_URL!));
  }

  try {
    await disconnectGoogleConnection(user.id);
  } catch {
    return NextResponse.redirect(
      new URL("/settings?google=disconnect_failed", process.env.APP_URL!),
    );
  }

  return NextResponse.redirect(
    new URL("/settings?google=disconnected", process.env.APP_URL!),
  );
}
