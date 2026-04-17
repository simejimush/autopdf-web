import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import styles from "./AdminErrorsPage.module.css";

const ADMIN_EMAIL = "sencho96@gmail.com";

const ERROR_CODE_OPTIONS = [
  { value: "all", label: "すべて" },
  { value: "GOOGLE_TOKEN_INVALID", label: "GOOGLE_TOKEN_INVALID" },
  { value: "GOOGLE_PERMISSION_DENIED", label: "GOOGLE_PERMISSION_DENIED" },
  { value: "DRIVE_FOLDER_INVALID", label: "DRIVE_FOLDER_INVALID" },
  { value: "DRIVE_UPLOAD_FAILED", label: "DRIVE_UPLOAD_FAILED" },
  { value: "DB_INSERT_FAILED", label: "DB_INSERT_FAILED" },
  { value: "UNKNOWN", label: "UNKNOWN" },
] as const;

const TRIGGER_OPTIONS = [
  { value: "all", label: "すべて" },
  { value: "cron", label: "cron" },
  { value: "manual", label: "manual" },
] as const;

type SearchParams = Promise<{
  error_code?: string;
  trigger?: string;
  user_id?: string;
}>;

type ErrorRunRow = {
  id: string;
  status: string | null;
  error_code: string | null;
  message: string | null;
  user_id: string | null;
  rule_id: string | null;
  trigger: string | null;
  started_at: string | null;
  finished_at: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "-";

  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function normalizeSelectValue(value?: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "all") return "";
  return trimmed;
}

function normalizeUserId(value?: string) {
  const trimmed = value?.trim() ?? "";
  return trimmed;
}

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  if (user.email !== ADMIN_EMAIL) {
    redirect("/dashboard");
  }

  const params = await searchParams;

  const errorCode = normalizeSelectValue(params.error_code);
  const trigger = normalizeSelectValue(params.trigger);
  const userId = normalizeUserId(params.user_id);

  let query = supabaseAdmin
    .from("runs")
    .select(
      "id, status, error_code, message, user_id, rule_id, trigger, started_at, finished_at",
    )
    .eq("status", "error");

  if (errorCode) {
    query = query.eq("error_code", errorCode);
  }

  if (trigger) {
    query = query.eq("trigger", trigger);
  }

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query
    .order("started_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.header}>
            <h1 className={styles.title}>エラー一覧</h1>
            <p className={styles.sub}>最新の実行エラーを確認します。</p>
          </div>

          <div className={styles.errorBox}>
            エラー一覧の取得に失敗しました。
          </div>
        </div>
      </div>
    );
  }

  const rows = (data ?? []) as ErrorRunRow[];

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>エラー一覧</h1>
            <p className={styles.sub}>
              runs テーブルの error ログを新しい順で表示しています。
            </p>
          </div>
          <div className={styles.count}>{rows.length}件</div>
        </div>

        <form className={styles.filters} method="get">
          <div className={styles.filterGroup}>
            <label className={styles.label} htmlFor="error_code">
              error_code
            </label>
            <select
              id="error_code"
              name="error_code"
              className={styles.select}
              defaultValue={errorCode || "all"}
            >
              {ERROR_CODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.label} htmlFor="trigger">
              trigger
            </label>
            <select
              id="trigger"
              name="trigger"
              className={styles.select}
              defaultValue={trigger || "all"}
            >
              {TRIGGER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={`${styles.filterGroup} ${styles.filterGroupWide}`}>
            <label className={styles.label} htmlFor="user_id">
              user_id
            </label>
            <input
              id="user_id"
              name="user_id"
              type="text"
              className={styles.input}
              defaultValue={userId}
              placeholder="user_id を完全一致で入力"
            />
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryButton}>
              適用
            </button>
            <a href="/admin/errors" className={styles.secondaryButton}>
              リセット
            </a>
          </div>
        </form>

        {rows.length === 0 ? (
          <div className={styles.emptyBox}>
            条件に一致するエラーはありません。
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>発生時刻</th>
                  <th>status</th>
                  <th>error_code</th>
                  <th>message</th>
                  <th>user_id</th>
                  <th>rule_id</th>
                  <th>trigger</th>
                  <th>終了時刻</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.started_at)}</td>
                    <td>
                      <span className={styles.statusBadge}>
                        {row.status ?? "-"}
                      </span>
                    </td>
                    <td>
                      <code className={styles.code}>
                        {row.error_code ?? "-"}
                      </code>
                    </td>
                    <td className={styles.messageCell}>{row.message ?? "-"}</td>
                    <td>
                      <code className={styles.code}>{row.user_id ?? "-"}</code>
                    </td>
                    <td>
                      <code className={styles.code}>{row.rule_id ?? "-"}</code>
                    </td>
                    <td>{row.trigger ?? "-"}</td>
                    <td>{formatDateTime(row.finished_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
