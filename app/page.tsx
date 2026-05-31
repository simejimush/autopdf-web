import Link from "next/link";
import styles from "./HomePage.module.css";

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

const freeFeatures = [
  "ルール3件まで",
  "自動PDF生成",
  "Google Drive保存",
  "自動実行",
  "手動実行",
  "実行履歴の確認",
  "Gmail検索条件の作成",
  "保存先フォルダ指定",
  "AIファイル名提案",
  "AI書類種別判定",
];

const proFeatures = [
  "Freeのすべての機能",
  "ルール数を拡張",
  "広告なし",
  "より多くの保存ルールを管理",
  "複数パターンの請求書・領収書メールに対応しやすい",
  "Gmail検索条件を柔軟に設定",
  "Google Driveの保存先をルールごとに指定",
  "実行履歴で保存状況を確認",
  "AIファイル名提案",
  "AI書類種別判定",
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
          Gmailの請求書・領収書を、
          <br />
          <span className={styles.heroAccent}>
            PDF化してGoogle Driveへ自動保存
          </span>
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
        <div className={styles.flowLane} aria-label="GmailからDriveへの保存フロー">
          <div className={styles.laneCard}>
            <div className={styles.laneTitle}>Gmail</div>
            <p className={styles.laneText}>条件に合うメールを抽出</p>
          </div>
          <div className={styles.laneArrow} aria-hidden="true">
            →
          </div>
          <div className={styles.laneCard}>
            <div className={styles.laneTitle}>PDF化</div>
            <p className={styles.laneText}>本文を保存しやすい形へ</p>
          </div>
          <div className={styles.laneArrow} aria-hidden="true">
            →
          </div>
          <div className={styles.laneCard}>
            <div className={styles.laneTitle}>Google Drive</div>
            <p className={styles.laneText}>指定フォルダへ保存</p>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>よくある手作業を減らす</h2>
        <div className={styles.beforeAfterGrid}>
          <article className={styles.beforeCard}>
            <h3 className={styles.beforeAfterTitle}>Before</h3>
            <ul className={styles.list}>
              {painPoints.map((item) => (
                <li key={item} className={styles.listItem}>
                  {item}
                </li>
              ))}
            </ul>
          </article>
          <article className={styles.afterCard}>
            <h3 className={styles.beforeAfterTitle}>After</h3>
            <p className={styles.afterText}>
              条件に合うメールをPDF化し、Google Driveへ保存。
              日々の確認と整理の手間を減らして、必要な書類を追いやすくします。
            </p>
          </article>
        </div>
      </section>

      <section id="how-it-works" className={styles.section}>
        <h2 className={styles.sectionTitle}>使い方</h2>
        <div className={styles.stepCards}>
          {steps.map((item, index) => (
            <article key={item} className={styles.stepCard}>
              <div className={styles.stepNumber}>{index + 1}</div>
              <p className={styles.stepCardText}>{item}</p>
            </article>
          ))}
        </div>
        <Link href="/help" className={styles.helpLink}>
          詳しい使い方を見る
        </Link>
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
            <p className={styles.price}>¥0</p>
            <p className={styles.cardText}>まず試す</p>
            <ul className={styles.pricingList}>
              {freeFeatures.map((item) => (
                <li key={item} className={styles.pricingItem}>
                  {item}
                </li>
              ))}
            </ul>
            <div className={styles.limitBox}>
              <div>広告表示あり</div>
              <div>ルール数に上限あり</div>
            </div>
            <Link href="/login" className={styles.pricingCta}>
              無料で始める
            </Link>
          </article>
          <article className={`${styles.pricingCard} ${styles.proCard}`}>
            <div className={styles.proBadge}>本格運用向け</div>
            <h3 className={styles.cardTitle}>Pro</h3>
            <p className={styles.price}>¥980 / 月</p>
            <p className={styles.cardText}>日々の保存作業をまとめて自動化</p>
            <ul className={styles.pricingList}>
              {proFeatures.map((item) => (
                <li key={item} className={styles.pricingItem}>
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/login" className={styles.pricingCta}>
              Proで始める
            </Link>
            <p className={styles.pricingNote}>
              ログイン後、決済画面へ進めます
            </p>
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
        <Link href="/help" className={styles.footerHelpLink}>
          詳しい使い方を見る
        </Link>
      </section>
    </main>
  );
}
