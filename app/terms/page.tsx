import Link from "next/link";
import styles from "../help/HelpPage.module.css";

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.ctaSection}>
          <Link href="/" className={styles.secondaryButton}>
            AutoPDFへ戻る
          </Link>
        </div>

        <header className={styles.header}>
          <h1 className={styles.title}>利用規約</h1>
          <p className={styles.description}>
            本規約は、AutoPDF運営者（以下「運営者」といいます。）が提供するAutoPDF（以下「本サービス」といいます。）の利用条件を定めるものです。
          </p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>1. 適用と同意</h2>
          <p className={styles.paragraph}>
            本規約は、本サービスを利用するすべての利用者に適用されます。利用者は、本規約の内容を確認し、同意したうえで本サービスを利用するものとします。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>2. サービス内容</h2>
          <p className={styles.paragraph}>
            本サービスは、利用者が設定した条件に基づいてGmailのメールを検索し、メール本文等をPDF化して、指定されたGoogle Driveフォルダへ保存する機能等を提供します。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>3. アカウント登録・管理</h2>
          <p className={styles.paragraph}>
            利用者は、正確な情報を用いてアカウントを登録し、自己の責任でアカウントおよび認証手段を管理するものとします。不正利用またはそのおそれを認識した場合は、速やかに運営者へ連絡してください。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>4. Google連携と必要権限</h2>
          <p className={styles.paragraph}>
            本サービスの利用には、Googleアカウントとの連携およびGmailの検索・読み取り、Google Driveへの保存等に必要な権限の許可が必要です。連携解除、権限不足またはトークンの失効等により、一部または全部の機能が利用できない場合があります。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>5. Free / Proプラン</h2>
          <div className={styles.planGrid}>
            <article className={styles.planCard}>
              <h3 className={styles.planName}>Free</h3>
              <p className={styles.planText}>
                保存ルールは3件まで、PDF保存は月10件まで利用できます。
              </p>
            </article>
            <article className={styles.planCard}>
              <h3 className={styles.planName}>Pro</h3>
              <p className={styles.planText}>
                月額980円で、PDF保存件数を大幅に拡張します。具体的な提供内容や適用条件は、申込時の表示に従います。
              </p>
            </article>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>6. 料金、更新、解約</h2>
          <p className={styles.paragraph}>
            ProプランはStripeを通じた継続課金です。料金、課金周期その他の条件は申込画面に表示します。利用者は所定の方法で解約でき、解約後も契約期間の終了まではProプランを利用できる場合があります。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>7. 返金</h2>
          <p className={styles.paragraph}>
            法令上必要な場合または運営者が個別に認めた場合を除き、支払い済み料金は原則として返金しません。返金の可否および方法は、契約状況や決済状況を確認したうえで案内します。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>8. 禁止事項</h2>
          <ul className={styles.list}>
            <li className={styles.listItem}>法令または公序良俗に違反する行為</li>
            <li className={styles.listItem}>第三者の権利または利益を侵害する行為</li>
            <li className={styles.listItem}>他人のアカウントを利用し、または不正アクセスを試みる行為</li>
            <li className={styles.listItem}>本サービスに過度な負荷を与え、運営を妨害する行為</li>
            <li className={styles.listItem}>本サービスを不正な目的で利用する行為</li>
            <li className={styles.listItem}>その他、運営者が不適切と合理的に判断する行為</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>9. ユーザーデータとバックアップ</h2>
          <p className={styles.paragraph}>
            利用者は、本サービスに入力または連携するデータについて必要な権利を有するものとします。生成されたPDFは利用者のGoogle Driveに保存されます。利用者は、重要なデータについて必要に応じて自らバックアップを行うものとします。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>10. 知的財産権</h2>
          <p className={styles.paragraph}>
            本サービスに関するプログラム、画面、文章、商標その他の知的財産権は、運営者または正当な権利者に帰属します。利用者が保有するデータの権利が、本規約によって運営者へ移転するものではありません。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>11. サービス変更・停止</h2>
          <p className={styles.paragraph}>
            運営者は、保守、障害、外部サービスの変更その他必要な事情により、本サービスの内容を変更し、または一時的に停止することがあります。可能な場合は、適切な方法で事前または事後にお知らせします。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>12. 利用制限・契約解除</h2>
          <p className={styles.paragraph}>
            利用者が本規約に違反した場合、料金の支払いを怠った場合、または安全な運営のために必要な場合、運営者は事前の通知なく利用を制限し、または契約を解除することがあります。ただし、状況に応じて合理的な対応に努めます。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>13. 保証の否認</h2>
          <p className={styles.paragraph}>
            運営者は、本サービスについて、特定目的への適合性、常時利用可能であること、処理結果の完全性・正確性、またはエラーやデータ消失が生じないことを保証するものではありません。利用者は、生成結果および保存状況を必要に応じて確認してください。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>14. 責任制限</h2>
          <p className={styles.paragraph}>
            運営者は、法令上許される範囲で、本サービスの利用または利用不能により生じた損害について責任を負わないものとします。運営者が責任を負う場合であっても、故意または重過失がある場合その他法令により制限が認められない場合を除き、その範囲は通常かつ直接の損害に限られます。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>15. 規約変更</h2>
          <p className={styles.paragraph}>
            運営者は、法令または本サービスの変更等に応じて、本規約を変更することがあります。重要な変更がある場合は、本サービス上その他適切な方法でお知らせします。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>16. 準拠法</h2>
          <p className={styles.paragraph}>本規約は、日本法に準拠します。</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>17. 管轄裁判所</h2>
          <p className={styles.paragraph}>
            本サービスまたは本規約に関して紛争が生じた場合、運営者の所在地を管轄する日本の裁判所を管轄裁判所とします。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>18. 問い合わせ先</h2>
          <p className={styles.paragraph}>
            運営者: AutoPDF運営者
            <br />
            メールアドレス: support@serpix.net
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>19. 制定日</h2>
          <p className={styles.paragraph}>2026年7月21日</p>
        </section>
      </div>
    </main>
  );
}
