import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // クエリの secret（念のためtrim）
  const secret = (searchParams.get("secret") ?? "").trim();

  // 環境変数（念のためtrim、未設定なら空文字）
  const envSecret = (process.env.CRON_SECRET ?? "").trim();

  // envが未設定なら 500 で分かるようにする（401だと判別しづらい）
  if (!envSecret) {
    console.error("[cron] CRON_SECRET is missing in env");
    return NextResponse.json(
      { error: "CRON_SECRET is missing in env" },
      { status: 500 }
    );
  }

  // ログ（値は出さない）
  console.log("[cron] secretLen=", secret.length, " envLen=", envSecret.length);

  if (secret !== envSecret) {
    console.error("[cron] Unauthorized (secret mismatch)");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron] Cron triggered");
  return NextResponse.json({ message: "Cron OK" });
}
