"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ClientStatus.module.css";

type ClientStatusProps = {
  sessionId: string;
  paymentStatus: string;
  mode: string;
};

type PlanResponse = {
  plan: "free" | "pro" | "pro_plus";
  billing_status: string | null;
};

const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 10000;
const HARD_STOP_MS = 30000;

export default function ClientStatus({
  sessionId,
  paymentStatus,
  mode,
}: ClientStatusProps) {
  const [plan, setPlan] = useState<PlanResponse["plan"] | null>(null);
  const [billingStatus, setBillingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const startedAtRef = useRef<number>(Date.now());
  const timeoutShown = elapsedMs >= TIMEOUT_MS;
  const hardStopped = elapsedMs >= HARD_STOP_MS;
  const isUpgraded = plan === "pro" || plan === "pro_plus";

  useEffect(() => {
    let cancelled = false;

    async function fetchPlan() {
      try {
        const response = await fetch("/api/me/plan", {
          method: "GET",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("ログイン状態を確認できませんでした。");
          }
          throw new Error("課金状態の確認に失敗しました。");
        }

        const data = (await response.json()) as PlanResponse;

        if (cancelled) return;

        setPlan(data.plan);
        setBillingStatus(data.billing_status);

        if (data.plan === "pro" || data.plan === "pro_plus") {
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "課金状態の確認に失敗しました。",
        );
      }
    }

    void fetchPlan();

    const intervalId = window.setInterval(() => {
      const nextElapsed = Date.now() - startedAtRef.current;
      setElapsedMs(nextElapsed);

      if (isUpgraded || error || nextElapsed >= HARD_STOP_MS) {
        window.clearInterval(intervalId);
        return;
      }

      void fetchPlan();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [error, isUpgraded]);

  const heading = useMemo(() => {
    if (error) return "決済確認に失敗しました";
    if (isUpgraded) return "アップグレードが完了しました";
    if (timeoutShown) return "反映を確認しています";
    return "決済を確認しています";
  }, [error, isUpgraded, timeoutShown]);

  const description = useMemo(() => {
    if (error) {
      return "決済自体は完了している可能性があります。少し待ってから /billing を確認してください。";
    }

    if (isUpgraded) {
      return "Proプランの反映を確認しました。すぐにすべての機能をご利用いただけます。";
    }

    if (timeoutShown) {
      return "決済は完了しています。Webhook反映に数秒かかる場合があります。自動で再確認しています。";
    }

    return "通常は数秒で反映されます。画面は自動で更新されます。";
  }, [error, isUpgraded, timeoutShown]);

  const badgeText = useMemo(() => {
    if (isUpgraded) return "Pro反映済み";
    if (error) return "確認失敗";
    if (timeoutShown) return "反映待ち";
    return "確認中";
  }, [error, isUpgraded, timeoutShown]);

  return (
    <section className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.headerRow}>
          {!isUpgraded && !error ? (
            <div className={styles.spinner} aria-hidden="true" />
          ) : null}

          <div>
            <div className={styles.badge}>{badgeText}</div>
            <h1 className={styles.title}>{heading}</h1>
          </div>
        </div>

        <p className={styles.description}>{description}</p>

        {!error ? (
          <div className={styles.noteBox}>
            <div className={styles.noteRow}>
              <strong>支払い状況:</strong> {paymentStatus}
            </div>
            <div className={styles.noteRow}>
              <strong>モード:</strong> {mode}
            </div>
            {plan ? (
              <div className={styles.noteRow}>
                <strong>現在プラン:</strong> {plan}
              </div>
            ) : null}
            {billingStatus ? (
              <div className={styles.noteRow}>
                <strong>課金状態:</strong> {billingStatus}
              </div>
            ) : null}
          </div>
        ) : null}

        {timeoutShown && !isUpgraded && !error ? (
          <p className={styles.subtle}>
            反映に少し時間がかかっています。しばらくすると自動で再確認されます。
          </p>
        ) : null}

        {hardStopped && !isUpgraded && !error ? (
          <p className={styles.warning}>
            まだ反映を確認できていません。決済自体は完了している可能性があります。/billing
            から再確認してください。
          </p>
        ) : null}

        <div className={styles.actions}>
          <Link href="/dashboard" className={styles.primaryLink}>
            ダッシュボードへ
          </Link>
        </div>
      </div>
    </section>
  );
}
