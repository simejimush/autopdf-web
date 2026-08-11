import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { evaluateGoogleRefreshCanaryGate } from "@/lib/google/refreshCanaryCore";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import styles from "../SettingsPage.module.css";
import CanarySubmitForm from "./CanarySubmitForm";

export const dynamic = "force-dynamic";

export default async function RefreshCanaryPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) notFound();

  const requestHeaders = await headers();
  const gate = evaluateGoogleRefreshCanaryGate({
    vercelEnv: process.env.VERCEL_ENV,
    enabled: process.env.GOOGLE_REFRESH_CANARY_ENABLED,
    allowedHost: process.env.GOOGLE_REFRESH_CANARY_ALLOWED_HOST,
    requestHost: requestHeaders.get("host") ?? "",
  });

  if (!gate.ok) notFound();

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <section className={styles.hero}>
          <div>
            <h1 className={styles.title}>Preview refresh canary</h1>
            <p className={styles.lead}>
              Preview環境でGoogle credential refreshを1回だけ試行します。
            </p>
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>単発実行</h2>
              <p className={styles.cardDesc}>
                対象は現在のPreviewセッションです。再送信は行いません。
              </p>
            </div>
            <span className={`${styles.badge} ${styles.badgeMuted}`}>
              Preview only
            </span>
          </div>

          <CanarySubmitForm />
          <p className={styles.note}>
            実行後は画面を更新せず、operation監査結果を確認してください。
          </p>
        </section>
      </div>
    </main>
  );
}
