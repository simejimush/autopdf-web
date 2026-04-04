import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import styles from "./SettingsPage.module.css";
import ProfileEditButton from "./ProfileEditButton";
import ThemeToggle from "./ThemeToggle";
import { getMyProfileAction } from "@/app/actions/profile";

function formatDateTime(value?: string | null) {
  if (!value) return "未確認";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "未確認";

  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function getPlanLabel(plan?: string) {
  if (!plan) return "Free";
  if (plan === "pro") return "Pro";
  return "Free";
}

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <section className={styles.hero}>
            <h1 className={styles.title}>設定</h1>
            <p className={styles.lead}>ログイン情報を確認できませんでした。</p>
          </section>
        </div>
      </main>
    );
  }

  const { data: googleConnection } = await supabase
    .from("google_connections")
    .select("id, status, last_verified_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const isGoogleConnected = googleConnection?.status === "connected";
  const googleEmail = isGoogleConnected ? "接続済み" : "未接続";
  const verifiedAt = formatDateTime(googleConnection?.last_verified_at);
  const updatedAt = formatDateTime(googleConnection?.updated_at);

  const profile = await getMyProfileAction();
  const displayName = profile?.display_name || "未設定";

  // ✅ ここ追加
  const planLabel = getPlanLabel(profile?.plan ?? undefined);
  const isPro = profile?.plan === "pro";

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <section className={styles.hero}>
          <div>
            <h1 className={styles.title}>設定</h1>
            <p className={styles.lead}>
              Google連携の状態やアカウント情報を確認できます。
            </p>
          </div>
        </section>

        <div className={styles.grid}>
          {/* Google連携 */}
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Google連携</h2>
                <p className={styles.cardDesc}>
                  Gmail / Google Drive の接続状態を確認します。
                </p>
              </div>

              <span
                className={`${styles.badge} ${
                  isGoogleConnected ? styles.badgeOk : styles.badgeMuted
                }`}
              >
                {isGoogleConnected ? "連携済み" : "未接続"}
              </span>
            </div>

            <dl className={styles.infoList}>
              <div className={styles.infoRow}>
                <dt className={styles.label}>状態</dt>
                <dd className={styles.value}>
                  {isGoogleConnected ? "Googleアカウント接続済み" : "未接続"}
                </dd>
              </div>

              <div className={styles.infoRow}>
                <dt className={styles.label}>接続情報</dt>
                <dd className={styles.value}>
                  {isGoogleConnected ? googleEmail : "未接続"}
                </dd>
              </div>

              <div className={styles.infoRow}>
                <dt className={styles.label}>最終確認</dt>
                <dd className={styles.value}>
                  {isGoogleConnected ? verifiedAt : "未接続"}
                </dd>
              </div>

              <div className={styles.infoRow}>
                <dt className={styles.label}>接続情報更新</dt>
                <dd className={styles.value}>
                  {isGoogleConnected ? updatedAt : "未接続"}
                </dd>
              </div>
            </dl>

            <div className={styles.actions}>
              <Link href="/api/google/connect" className={styles.primaryBtn}>
                {isGoogleConnected ? "Googleを再接続" : "Googleを接続"}
              </Link>

              <form action="/api/google/disconnect" method="post">
                <button
                  type="submit"
                  className={styles.secondaryBtn}
                  disabled={!isGoogleConnected}
                >
                  接続解除
                </button>
              </form>
            </div>

            {!isGoogleConnected ? (
              <p className={styles.note}>
                Google未接続の状態では、Gmail取得やDrive保存は実行できません。
              </p>
            ) : (
              <p className={styles.note}>
                接続状態に問題がある場合は「Googleを再接続」を押してください。
              </p>
            )}
          </section>

          {/* アカウント */}
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>アカウント</h2>
                <p className={styles.cardDesc}>
                  ログイン中のアカウント情報です。
                </p>
              </div>

              <ProfileEditButton
                displayName={displayName}
                email={user.email ?? ""}
              />
            </div>

            <dl className={styles.infoList}>
              <div className={styles.infoRow}>
                <dt className={styles.label}>表示名</dt>
                <dd className={styles.value}>{displayName}</dd>
              </div>

              <div className={styles.infoRow}>
                <dt className={styles.label}>メールアドレス</dt>
                <dd className={styles.value}>{user.email ?? "未取得"}</dd>
              </div>

              <div className={styles.infoRow}>
                <dt className={styles.label}>ユーザーID</dt>
                <dd className={styles.valueMono}>{user.id}</dd>
              </div>
            </dl>

            <p className={styles.note}>
              表示名の編集は次のStepでモーダル対応していくのがおすすめです。
            </p>
          </section>

          {/* 通知設定 */}
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>通知設定</h2>
                <p className={styles.cardDesc}>
                  実行結果やエラー通知に関する設定です。
                </p>
              </div>

              <span className={`${styles.badge} ${styles.badgeMuted}`}>
                準備中
              </span>
            </div>

            <p className={styles.placeholderText}>
              メール通知や失敗時通知などをここに追加予定です。
            </p>
          </section>

          {/* ✅ プラン・請求 */}
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>プラン・請求</h2>
                <p className={styles.cardDesc}>
                  契約プランや支払い情報の確認用エリアです。
                </p>
              </div>
            </div>

            <dl className={styles.infoList}>
              <div className={styles.infoRow}>
                <dt className={styles.label}>現在のプラン</dt>
                <dd className={styles.value}>{planLabel}</dd>
              </div>
            </dl>

            <div className={styles.actions}>
              <Link href="/billing" className={styles.primaryBtn}>
                プランを変更する
              </Link>
            </div>

            <p className={styles.note}>
              {profile?.plan === "pro"
                ? "現在はProプランをご利用中です。解約や変更はこのボタンから確認できます。"
                : "プラン変更や請求情報の確認はこのボタンから行えます。"}
            </p>
          </section>
        </div>

        <ThemeToggle />
      </div>
    </main>
  );
}
