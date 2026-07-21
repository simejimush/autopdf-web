import Link from "next/link";
import styles from "../help/HelpPage.module.css";

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.ctaSection}>
          <Link href="/" className={styles.secondaryButton}>
            AutoPDFへ戻る
          </Link>
        </div>

        <header className={styles.header}>
          <h1 className={styles.title}>プライバシーポリシー</h1>
          <p className={styles.description}>
            AutoPDF運営者（以下「運営者」といいます。）は、AutoPDF（以下「本サービス」といいます。）における利用者情報を、以下の方針に従って取り扱います。
          </p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>1. 適用範囲</h2>
          <p className={styles.paragraph}>
            本ポリシーは、本サービスの提供に伴い運営者が取得し、または取り扱う情報に適用されます。外部サービス上での情報の取り扱いには、各事業者の規約やプライバシーポリシーも適用されます。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>2. 取得する情報</h2>
          <ul className={styles.list}>
            <li className={styles.listItem}>Googleアカウントの基本情報</li>
            <li className={styles.listItem}>
              Gmailの検索、メールのPDF生成およびGoogle Driveへの保存に必要な情報
            </li>
            <li className={styles.listItem}>
              アカウント情報、契約・決済状況、サービスの利用状況および問い合わせ内容
            </li>
            <li className={styles.listItem}>
              Cookie等を通じて取得する端末・ブラウザ情報、アクセス情報および障害調査に必要な情報
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>3. 利用目的</h2>
          <ul className={styles.list}>
            <li className={styles.listItem}>本サービスの提供、本人確認およびアカウント管理</li>
            <li className={styles.listItem}>メールの検索、PDF生成およびGoogle Driveへの保存</li>
            <li className={styles.listItem}>契約・決済の管理、利用状況の確認およびサポート対応</li>
            <li className={styles.listItem}>不正利用の防止、安全性の確保、障害対応およびサービス改善</li>
            <li className={styles.listItem}>法令上必要な対応</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>4. Googleユーザーデータの取り扱い</h2>
          <p className={styles.paragraph}>
            Gmailの本文その他のGoogleユーザーデータは、利用者が設定した条件に基づくPDF生成・保存処理およびそのために必要なサービス提供に使用します。広告のターゲティングには使用せず、本サービスの提供に必要な範囲を超えて利用しません。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>5. Google Driveへの保存</h2>
          <p className={styles.paragraph}>
            生成したPDFは、利用者が指定したGoogle Driveのフォルダへ保存します。保存後のファイルは、利用者のGoogleアカウントおよびGoogle Drive上の設定に従って管理されます。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>6. 外部サービス</h2>
          <p className={styles.paragraph}>
            本サービスでは、認証・データ管理、決済、ホスティング等のために、Google、Stripe、Supabase、Vercel等の外部サービスを利用する場合があります。各事業者は、その提供業務に必要な範囲で情報を取り扱います。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>7. 第三者提供と業務委託</h2>
          <p className={styles.paragraph}>
            運営者は、法令に基づく場合、利用者の同意がある場合、または本サービスの提供に必要な業務委託先へ取り扱いを委託する場合を除き、利用者情報を第三者に提供しません。委託する場合は、必要な範囲に限定し、適切な管理に努めます。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>8. 保存期間と削除</h2>
          <p className={styles.paragraph}>
            利用者情報は、利用目的の達成に必要な期間保存します。利用者によるGoogle連携の解除、退会または削除依頼には、確認のうえ対応します。ただし、法令への対応、不正利用の防止、決済記録または監査上必要な情報は、必要な期間保持する場合があります。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>9. 安全管理</h2>
          <p className={styles.paragraph}>
            運営者は、利用者情報への不正アクセス、漏えい、滅失または毀損を防ぐため、合理的な安全管理措置を講じるよう努めます。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>10. Cookie等</h2>
          <p className={styles.paragraph}>
            本サービスは、ログイン状態の維持、設定の保存、安全な提供および利用状況の把握のため、Cookieその他これに類する技術を使用する場合があります。ブラウザの設定によりCookieを制限できますが、一部機能が利用できなくなることがあります。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>11. 利用者の権利と問い合わせ</h2>
          <p className={styles.paragraph}>
            利用者は、法令に従い、自己の情報の開示、訂正、利用停止または削除等を求めることができます。本人確認や、法令上認められる範囲での対応となる場合があります。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>12. 改定</h2>
          <p className={styles.paragraph}>
            運営者は、法令、本サービスの内容または運用の変更等に応じて、本ポリシーを改定することがあります。重要な変更がある場合は、本サービス上その他適切な方法でお知らせします。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>13. 問い合わせ先</h2>
          <p className={styles.paragraph}>
            運営者: AutoPDF運営者
            <br />
            メールアドレス: support@serpix.net
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>14. 制定日</h2>
          <p className={styles.paragraph}>2026年7月21日</p>
        </section>
      </div>
    </main>
  );
}
