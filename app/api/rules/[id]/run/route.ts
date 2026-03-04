// autopdf-web/app/api/rules/[id]/run/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ ok: true, message: "run route placeholder" });
}
