import Image from "next/image";
import styles from "../styles/login.module.css";

export function AryaBrand() {
  return (
    <div className={styles.brand}>
      <Image
        src="/images/login/dharma-wheel.png"
        alt="Dharma Wheel Arya Tarray Nusantara"
        width={92}
        height={92}
        priority
        className={styles.brandMark}
      />

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
