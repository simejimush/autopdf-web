// app/(app)/billing/page.tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

import styles from "./BillingPage.module.css";
import { Button } from "@/lib/ui/Button";
import CheckoutButton from "./_components/CheckoutButton";
import { Badge, CardPad } from "@/lib/ui";

type BillingResponse = {
  plan?: string;
  billing_provider?: string | null;
  billing_status?: string | null;
  current_period_end?: string | null;
  error?: string;
};

function formatPlanLabel(plan?: string | null) {
  if (plan === "pro") return "Pro";
  if (plan === "pro_plus") return "Pro+";
  return "Free";
}

function formatBillingStatus(status?: string | null) {
  if (!status) return "未契約";
  if (status === "active") return "有効";
  if (status === "trialing") return "トライアル中";
  if (status === "past_due") return "支払い失敗";
  if (status === "canceled") return "解約済み";
  if (status === "unpaid") return "未払い";
  if (status === "incomplete") return "支払い待ち";
  if (status === "incomplete_expired") return "期限切れ";
  return status;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

export default async function BillingPage() {
  const h = await headers();

  const host = h.get("host");
  if (!host && !process.env.APP_URL && !process.env.VERCEL_URL) {
    throw new Error("Missing host/APP_URL/VERCEL_URL");
  }

  const proto =
    h.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "production" ? "https" : "http");

  const baseUrl =
    process.env.APP_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `${proto}://${host}`);

  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${baseUrl}/api/billing`, {
    cache: "no-store",
    headers: { cookie },
  });

  if (res.status === 401) redirect("/login");

  let json: BillingResponse;
  try {
    json = await res.json();
  } catch {
    json = { error: "Invalid JSON response" };
  }

  const plan = json.plan ?? "free";
  const billingProvider = json.billing_provider ?? null;
  const billingStatus = json.billing_status ?? null;
  const currentPeriodEnd = json.current_period_end ?? null;

  const isPro = plan === "pro";

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.hero}>
          <div>
            <h1 className={styles.h1}>プラン / 請求</h1>
            <p className={styles.sub}>
              現在のプラン確認と、Proプランへのアップグレードを行います。
            </p>
          </div>
        </div>

        {json.error ? (
          <div className={styles.error} role="alert">
            <div className={styles.errorTitle}>エラー</div>
            <div className={styles.errorMsg}>{json.error}</div>
          </div>
        ) : null}

        <div className={styles.grid}>
          <CardPad className={styles.currentCard}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>現在の契約状態</div>
              <Badge tone={isPro ? "ok" : "muted"} dot>
                {formatPlanLabel(plan)}
              </Badge>
            </div>

            <div className={styles.metaList}>
              <div className={styles.metaRow}>
                <div className={styles.metaKey}>現在のプラン</div>
                <div className={styles.metaVal}>{formatPlanLabel(plan)}</div>
              </div>

              <div className={styles.metaRow}>
                <div className={styles.metaKey}>決済プロバイダ</div>
                <div className={styles.metaVal}>
                  {billingProvider ? billingProvider : "—"}
                </div>
              </div>

              <div className={styles.metaRow}>
                <div className={styles.metaKey}>契約状態</div>
                <div className={styles.metaVal}>
                  {formatBillingStatus(billingStatus)}
                </div>
              </div>

              <div className={styles.metaRow}>
                <div className={styles.metaKey}>次回更新 / 終了</div>
                <div className={styles.metaVal}>
                  {formatDate(currentPeriodEnd)}
                </div>
              </div>
            </div>

            <div className={styles.notice}>
              {isPro
                ? "現在はProプランです。ルール数は無制限です。"
                : "現在はFreeプランです。ルールは3件まで作成できます。"}
            </div>
          </CardPad>

          <CardPad className={styles.planCard}>
            <div className={styles.planEyebrow}>おすすめ</div>
            <div className={styles.planName}>Pro</div>
            <div className={styles.planPrice}>月額 980円（税込）</div>

            <ul className={styles.planList}>
              <li>ルール数 無制限</li>
              <li>自動実行あり</li>
              <li>PDF生成あり</li>
              <li>Google Drive保存あり</li>
            </ul>

            <div className={styles.planActions}>
              <CheckoutButton />

              <Link href="/rules" className={styles.backLink}>
                <Button variant="outline" size="md">
                  ルール一覧へ戻る
                </Button>
              </Link>
            </div>
          </CardPad>
        </div>
      </div>
    </div>
  );
}
