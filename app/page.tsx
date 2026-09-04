import Image from "next/image";
import Link from "next/link";
import styles from "./HomePage.module.css";

const painPoints = [
  "請求書メールを毎回探す手間がかかる",
  "PDF保存を手作業で行っている",
  "Drive内の保存忘れ・整理漏れが起きる",
];

const steps = [
  "Googleアカウントを接続",
  "保存ルールを一度設定",
  "あとは自動で保存",
];

const features = [
  "条件に合うメールだけを処理",
  "Google Driveの指定先へ保存",
  "同じメールの重複保存を防止",
  "実行履歴で処理結果を確認",
];

const trustItems = [
  "同じメールを重複保存しない",
  "実行履歴から保存結果を確認",
  "エラーも記録",
  "Googleアカウント連携で動作",
];

const freeFeatures = [
  "ルール3件まで",
  "月10件までPDF保存",
  "Gmailの条件に合うメールをPDF化",
  "Google Driveへ保存",
  "手動実行",
  "自動実行",
  "実行履歴の確認",
  "Gmail検索条件の作成",
  "保存先フォルダ指定",
];

const proFeatures = [
  "月500件まで自動保存",
  "複数の保存ルールを管理",
  "ルールごとにGoogle Drive保存先を指定",
  "同じメールの重複保存を防止",
  "実行履歴で保存状況を確認",
  "AIファイル名設定（書類種別を含めた命名）",
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
        <div className={styles.heroContent}>
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle}>
              <span className={`${styles.heroAccent} ${styles.heroLine}`}>
                必要なメール書類は、
              </span>
              <span className={`${styles.heroAccent} ${styles.heroLine}`}>
                届いたらもう整理済み。
              </span>
            </h1>
            <p className={styles.heroDescription}>
              Gmailに届く請求書・領収書などを、設定したルールに沿ってPDF化し、Google
              Driveへ自動保存。一度設定すれば、毎回探したり、保存したり、指示したりする必要はありません。
            </p>
            <div className={styles.heroActions}>
              <Link href="/login" className={styles.primaryButton}>
                無料で始める
              </Link>
              <a href="#how-it-works" className={styles.secondaryButton}>
                使い方を見る
              </a>
            </div>
          </div>
          <div className={styles.heroVisual}>
            <Image
              src="/hero-document-flow.svg"
              alt="メール書類がAutoPDFで処理され、整理済みの書類として保存されるイメージ"
              className={styles.heroIllustration}
              width={560}
              height={430}
              priority
            />
          </div>
        </div>
        <div
          className={styles.flowLane}
          aria-label="メール書類の自動整理フロー"
        >
          <div className={styles.laneCard}>
            <div className={styles.laneTitle}>届く</div>
            <p className={styles.laneText}>必要なメールを自動で見つける</p>
          </div>
          <div className={styles.laneArrow} aria-hidden="true">
            →
          </div>
          <div className={styles.laneCard}>
            <div className={styles.laneTitle}>片付く</div>
            <p className={styles.laneText}>保存できるPDFに自動変換</p>
          </div>
          <div className={styles.laneArrow} aria-hidden="true">
            →
          </div>
          <div className={styles.laneCard}>
            <div className={styles.laneTitle}>残る</div>
            <p className={styles.laneText}>決めたGoogle Driveへ自動保存</p>
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.beforeAfterSection}`}>
        <h2 className={styles.sectionTitle}>
          こんな書類整理を、毎月くり返していませんか？
        </h2>
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
            <h3 className={styles.beforeAfterTitle}>
              一度設定すれば、あとはAutoPDFに。
            </h3>
            <p className={styles.afterText}>
              必要なメールを見つけ、PDF化して、指定したGoogle Driveへ保存。
              メールが届くたびに同じ作業を繰り返す必要がなくなります。
            </p>
          </article>
        </div>
      </section>

      <section className={`${styles.section} ${styles.positioningSection}`}>
        <h2 className={styles.sectionTitle}>
          毎回お願いする自動化ではありません。
        </h2>
        <p className={styles.sectionLead}>
          AutoPDFは、メール書類の保存に必要な流れを最初からひとつにまとめた専用サービスです。
        </p>
        <p className={styles.sectionText}>
          Googleアカウントを接続して保存ルールを設定すれば、その後は対象メールを受信するたびに自動で処理。毎回ログインして指示したり、その都度保存方法を考えたりする必要はありません。
        </p>
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

      <section className={`${styles.section} ${styles.mechanismSection}`}>
        <h2 className={styles.sectionTitle}>任せっぱなしにできる仕組み</h2>
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
              <div>PDF保存は月10件まで</div>
              <div>ルールは3件まで作成できます</div>
            </div>
            <Link href="/login" className={styles.pricingCta}>
              無料で始める
            </Link>
          </article>
          <article className={`${styles.pricingCard} ${styles.proCard}`}>
            <div className={styles.proBadge}>本格運用向け</div>
            <h3 className={styles.cardTitle}>Pro</h3>
            <p className={styles.price}>¥980 / 月</p>
            <p className={styles.cardText}>
              毎月のメール書類整理を手放したい方向け
            </p>
            <ul className={styles.pricingList}>
              {proFeatures.map((item) => (
                <li key={item} className={styles.pricingItem}>
                  {item}
                </li>
              ))}
            </ul>
            <div className={styles.limitBox}>PDF保存は月500件まで</div>
            <Link href="/login" className={styles.pricingCta}>
              Proで始める
            </Link>
            <p className={styles.pricingNote}>ログイン後、決済画面へ進めます</p>
          </article>
        </div>
      </section>

      <section className={`${styles.section} ${styles.trustSection}`}>
        <h2 className={styles.sectionTitle}>安心して任せられるように</h2>
        <div className={styles.featureGrid}>
          {trustItems.map((item) => (
            <div key={item} className={styles.pill}>
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.footerCta}>
        <h2 className={styles.footerTitle}>
          次のメールから、保存作業をひとつ減らしませんか。
        </h2>
        <p className={styles.footerDescription}>Freeなら月10件まで試せます。</p>
        <Link href="/login" className={styles.primaryButton}>
          無料で始める
        </Link>
        <Link href="/help" className={styles.footerHelpLink}>
          詳しい使い方を見る
        </Link>
        <div className={styles.legalLinks}>
          <Link href="/privacy" className={styles.legalLink}>
            プライバシーポリシー
          </Link>
          <Link href="/terms" className={styles.legalLink}>
            利用規約
          </Link>
        </div>
      </section>
    </main>
  );
}
