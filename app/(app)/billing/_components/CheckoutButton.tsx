"use client";

import { useState } from "react";
import { Button } from "@/lib/ui/Button";
import styles from "../BillingPage.module.css";

export default function CheckoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCheckout = async () => {
    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          json?.message || json?.error || "決済ページの作成に失敗しました",
        );
      }

      if (!json?.url) {
        throw new Error("決済URLが取得できませんでした");
      }

      window.location.href = json.url;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "決済ページの作成に失敗しました",
      );
      setLoading(false);
    }
  };

  return (
    <div className={styles.checkoutBlock}>
      <Button
        variant="solid"
        size="md"
        className={styles.primaryBtn}
        onClick={handleCheckout}
        disabled={loading}
      >
        {loading ? "遷移中..." : "決済へ進む"}
      </Button>

      {error ? <p className={styles.checkoutError}>{error}</p> : null}
    </div>
  );
}
