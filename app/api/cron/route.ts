import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;

  if (!process.env.CRON_SECRET) {
    console.error("[cron] CRON_SECRET is missing in env");
    return NextResponse.json(
      { error: "CRON_SECRET is missing in env" },
      { status: 500 }
    );
  }

  if (auth !== expected) {
    console.error("[cron] Unauthorized");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron] Cron triggered");
  return NextResponse.json({ message: "Cron OK" });
}
