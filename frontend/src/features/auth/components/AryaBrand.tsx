import styles from "../styles/login.module.css";

export function AryaBrand() {
  return (
    <div className={styles.brand}>
      <h2 className={styles.brandName}>Arya Tarray Nusantara</h2>

      <div className={styles.brandDivider} aria-hidden="true">
        <span />
        <i>◇</i>
        <span />
      </div>

      <p className={styles.brandTagline}>Temple Management Dashboard</p>
    </div>
  );
}
