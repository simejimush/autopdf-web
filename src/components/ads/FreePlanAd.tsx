import styles from "./FreePlanAd.module.css";

export default function FreePlanAd() {
  return (
    <aside className={styles.adBox} aria-label="スポンサー広告">
      <div className={styles.label}>スポンサー</div>
      <p className={styles.title}>広告枠</p>
      <p className={styles.text}>
        Freeプランでは広告が表示されます。Proにアップグレードすると非表示になります。
      </p>
    </aside>
  );
}
