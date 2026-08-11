"use client";

import { useRef, useState, type FormEvent } from "react";

import styles from "../SettingsPage.module.css";

export default function CanarySubmitForm() {
  const submitted = useRef(false);
  const [pending, setPending] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitted.current) {
      event.preventDefault();
      return;
    }

    submitted.current = true;
    setPending(true);
  }

  return (
    <form
      action="/api/google/refresh-canary"
      method="post"
      onSubmit={handleSubmit}
    >
      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.secondaryBtn}
          disabled={pending}
        >
          {pending ? "実行中…" : "Refresh canaryを1回だけ実行"}
        </button>
      </div>
    </form>
  );
}
