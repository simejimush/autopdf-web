import Link from "next/link";
import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

function getStripe() {
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }

  return new Stripe(secretKey);
}

type BillingSuccessPageProps = {
  searchParams: Promise<{
    session_id?: string;
  }>;
};

export default async function BillingSuccessPage({
  searchParams,
}: BillingSuccessPageProps) {
  const { session_id } = await searchParams;

  if (!session_id) {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "56px 20px",
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 12,
            color: "#0f172a",
          }}
        >
          決済情報を確認できませんでした
        </h1>

        <p
          style={{
            color: "#475569",
            lineHeight: 1.8,
            marginBottom: 24,
          }}
        >
          session_id が見つからないため、決済結果を表示できません。
        </p>

        <Link href="/dashboard">ダッシュボードへ</Link>
      </main>
    );
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id);

    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "56px 20px",
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 12,
            color: "#0f172a",
          }}
        >
          決済を受け付けました
        </h1>

        <p
          style={{
            color: "#475569",
            lineHeight: 1.8,
            marginBottom: 24,
          }}
        >
          お支払い手続きは完了しました。
          <br />
          反映まで数秒〜数十秒かかる場合があります。
        </p>

        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 16,
            background: "#f8fafc",
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 14,
              color: "#334155",
              marginBottom: 8,
            }}
          >
            <strong>Session ID:</strong> {session.id}
          </div>

          <div
            style={{
              fontSize: 14,
              color: "#334155",
              marginBottom: 8,
            }}
          >
            <strong>支払い状況:</strong> {session.payment_status}
          </div>

          <div
            style={{
              fontSize: 14,
              color: "#334155",
            }}
          >
            <strong>モード:</strong> {session.mode}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <Link href="/dashboard">ダッシュボードへ</Link>
        </div>
      </main>
    );
  } catch {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "56px 20px",
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            marginBottom: 12,
            color: "#0f172a",
          }}
        >
          決済結果の確認に失敗しました
        </h1>

        <p
          style={{
            color: "#475569",
            lineHeight: 1.8,
            marginBottom: 24,
          }}
        >
          決済自体は完了している可能性があります。
          <br />
          しばらく待ってから /billing を確認してください。
        </p>

        <Link href="/dashboard">ダッシュボードへ</Link>
      </main>
    );
  }
}
