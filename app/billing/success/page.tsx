import Link from "next/link";
import Stripe from "stripe";
import ClientStatus from "./ClientStatus";

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
        <ClientStatus
          sessionId={session.id}
          paymentStatus={session.payment_status ?? "unpaid"}
          mode={session.mode ?? "subscription"}
        />
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
