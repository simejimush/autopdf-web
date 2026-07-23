import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function unauthorizedResponse() {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return unauthorizedResponse();
    }
  } catch {
    return unauthorizedResponse();
  }

  return NextResponse.json(
    { error: "Gone" },
    { status: 410, headers: NO_STORE_HEADERS },
  );
}
