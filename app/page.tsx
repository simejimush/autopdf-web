import Link from "next/link";
import styles from "./HomePage.module.css";

const flowItems = [
  {
    title: "Gmail",
    description: "受信した請求書・領収書メールを検索条件で抽出します。",
  },
  {
    title: "AutoPDF",
    description: "本文をPDF化し、保存しやすい形に整えます。",
  },
  {
    title: "Google Drive",
    description: "指定フォルダへ保存し、後から実行履歴で確認できます。",
  },
];

const painPoints = [
  "請求書メールを毎回探す手間がかかる",
  "PDF保存を手作業で行っている",
  "Drive内の保存忘れ・整理漏れが起きる",
];

const steps = [
  "Googleアカウントを接続",
  "保存ルールを作成",
  "自動でPDF保存",
];

const features = [
  "Gmail検索条件をルール化",
  "Google Driveへ保存",
  "実行履歴を確認可能",
  "Free / Proプランに対応",
];

const trustItems = [
  "Google OAuth連携",
  "Stripe決済",
  "実行履歴で確認可能",
  "エラーは記録される",
];

export default function HomePage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>AutoPDF</div>
        <nav className={styles.nav}>
          <Link href="/login" className={styles.loginLink}>
            ログイン
          </Link>
          <Link href="/login" className={styles.primaryButton}>
            無料で始める
          </Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>
          Gmailの請求書・領収書を、PDF化してGoogle Driveへ自動保存
        </h1>
        <p className={styles.heroDescription}>
          メールを探して、PDFにして、Driveへ保存する作業をAutoPDFが自動化します。
        </p>
        <div className={styles.heroActions}>
          <Link href="/login" className={styles.primaryButton}>
            無料で始める
          </Link>
          <a href="#how-it-works" className={styles.secondaryButton}>
            使い方を見る
          </a>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Gmail → AutoPDF → Google Drive</h2>
        <div className={styles.cardGrid}>
          {flowItems.map((item) => (
            <article key={item.title} className={styles.card}>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              <p className={styles.cardText}>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>よくある手作業を減らす</h2>
        <ul className={styles.list}>
          {painPoints.map((item) => (
            <li key={item} className={styles.listItem}>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section id="how-it-works" className={styles.section}>
        <h2 className={styles.sectionTitle}>使い方</h2>
        <ol className={styles.stepList}>
          {steps.map((item) => (
            <li key={item} className={styles.stepItem}>
              {item}
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>主な機能</h2>
        <div className={styles.featureGrid}>
          {features.map((item) => (
            <div key={item} className={styles.pill}>
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>料金</h2>
        <div className={styles.pricingGrid}>
          <article className={styles.pricingCard}>
            <h3 className={styles.cardTitle}>Free</h3>
            <p className={styles.price}>まず試す</p>
            <p className={styles.cardText}>ルール3件まで</p>
          </article>
          <article className={styles.pricingCard}>
            <h3 className={styles.cardTitle}>Pro</h3>
            <p className={styles.price}>月額980円</p>
            <p className={styles.cardText}>より多くのルールで自動化</p>
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>安心して使える設計</h2>
        <div className={styles.featureGrid}>
          {trustItems.map((item) => (
            <div key={item} className={styles.pill}>
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.footerCta}>
        <h2 className={styles.footerTitle}>まずはFreeで始められます</h2>
        <Link href="/login" className={styles.primaryButton}>
          無料で始める
        </Link>
      </section>
    </main>
  );
}
