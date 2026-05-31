import Link from "next/link";
import styles from "./HelpPage.module.css";

const capabilities = [
  "Gmailで届いたメールを条件に合わせて探す",
  "メール本文をPDF化する",
  "Google Driveの指定フォルダへ保存する",
  "実行履歴で保存状況を確認する",
];

const gettingStartedSteps = [
  "Googleアカウントでログイン",
  "Google連携を許可",
  "保存ルールを作成",
  "保存先のGoogle Driveフォルダを指定",
  "手動実行または自動実行で保存を確認",
];

const ruleExamples = [
  "請求書メール",
  "領収書メール",
  "取引先ごとのメール",
];

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
            Gmailで届く請求書・領収書メールをPDF化し、Google Driveへ保存するための基本的な流れを説明します。
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
            どのメールを、どのDriveフォルダに保存するかを決める設定です。
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
              <p className={styles.planText}>ルール3件まで、広告表示あり</p>
            </article>
            <article className={styles.planCard}>
              <h3 className={styles.planName}>Pro</h3>
              <p className={styles.planText}>
                ルール数を拡張、広告なし、本格運用向け
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
