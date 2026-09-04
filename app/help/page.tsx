import Link from "next/link";
import styles from "./HelpPage.module.css";

const capabilities = [
  "必要なメールを条件に合わせて自動で見つける",
  "メール本文をPDF化する",
  "指定したGoogle Driveフォルダへ自動保存する",
  "一度作ったルールを繰り返し使う",
  "実行履歴で保存状況を確認する",
];

const gettingStartedSteps = [
  "Googleアカウントでログイン",
  "Google連携を許可",
  "保存したいメールの条件をルールとして作成",
  "保存先のGoogle Driveフォルダを指定",
  "一度テスト実行して保存を確認",
  "以後は設定したルールに沿って自動処理",
];

const ruleExamples = ["請求書メール", "領収書メール", "取引先ごとのメール"];

const notes = [
  "Gmail検索条件に一致しないメールは保存されない",
  "Google連携が切れた場合は再接続が必要",
  "AI判定は補助機能であり、内容を必ず完全に分類するものではない",
];

export default function HelpPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>AutoPDF 使い方ガイド</h1>
          <p className={styles.description}>
            メールで届く請求書や領収書などを、条件に合わせて自動で見つけ、PDF化してGoogle
            Driveへ保存するまでの基本的な流れを説明します。
          </p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>AutoPDFでできること</h2>
          <ul className={styles.list}>
            {capabilities.map((item) => (
              <li key={item} className={styles.listItem}>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>はじめ方</h2>
          <ol className={styles.numberedList}>
            {gettingStartedSteps.map((step) => (
              <li key={step} className={styles.numberedItem}>
                {step}
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>ルールとは</h2>
          <p className={styles.paragraph}>
            どのメールを見つけ、どのGoogle
            Driveフォルダへ保存するかを決める設定です。一度作成すると、その条件を繰り返し使って自動処理できます。
          </p>
          <ul className={styles.list}>
            {ruleExamples.map((item) => (
              <li key={item} className={styles.listItem}>
                例: {item}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Free / Pro の違い</h2>
          <div className={styles.planGrid}>
            <article className={styles.planCard}>
              <h3 className={styles.planName}>Free</h3>
              <p className={styles.planText}>
                まずは3ルールまで無料で試せます。広告表示あり。
              </p>
            </article>
            <article className={styles.planCard}>
              <h3 className={styles.planName}>Pro</h3>
              <p className={styles.planText}>
                複数のルールを管理し、継続的な書類整理に使えます。月額980円、広告なし。
              </p>
            </article>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>注意点</h2>
          <ul className={styles.list}>
            {notes.map((item) => (
              <li key={item} className={styles.listItem}>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.ctaSection}>
          <Link href="/login" className={styles.primaryButton}>
            無料で始める
          </Link>
          <Link href="/" className={styles.secondaryButton}>
            トップへ戻る
          </Link>
        </section>
      </div>
    </main>
  );
}
