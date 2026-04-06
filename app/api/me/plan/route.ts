import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("plan, billing_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "DB_READ_FAILED" }, { status: 500 });
  }

  return NextResponse.json(
    {
      plan: data?.plan ?? "free",
      billing_status: data?.billing_status ?? null,
    },
    { status: 200 },
  );
}
