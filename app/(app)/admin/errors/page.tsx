import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import styles from "./AdminErrorsPage.module.css";

const ADMIN_EMAIL = "sencho96@gmail.com";

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

export default async function AdminErrorsPage() {
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

  const { data, error } = await supabase
    .from("runs")
    .select(
      "id, status, error_code, message, user_id, rule_id, trigger, started_at, finished_at",
    )
    .eq("status", "error")
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

        {rows.length === 0 ? (
          <div className={styles.emptyBox}>
            現在、表示できるエラーはありません。
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
