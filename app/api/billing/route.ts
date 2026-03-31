// app/api/billing/route.ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function jsonError(message: string, status = 500, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select(
      `
      plan,
      billing_provider,
      billing_status,
      current_period_end
    `,
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return jsonError("Failed to load billing profile", 500, error);
  }

  return NextResponse.json(
    {
      plan: data?.plan ?? "free",
      billing_provider: data?.billing_provider ?? null,
      billing_status: data?.billing_status ?? null,
      current_period_end: data?.current_period_end ?? null,
    },
    { status: 200 },
  );
}
