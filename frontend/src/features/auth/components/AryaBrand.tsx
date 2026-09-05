import Image from "next/image";
import aryaLogo from "@/assets/brand/arya-logo.png";
import styles from "../styles/login.module.css";

export function AryaBrand() {
  return (
    <div className={styles.brand}>
      <div className={styles.brandRow}>
        <div className={styles.brandLogoWrap} aria-hidden="true">
          <Image
            src={aryaLogo}
            alt=""
            width={148}
            height={98}
            className={styles.brandLogo}
            priority
          />
        </div>

        <div className={styles.brandTextGroup}>
          <h2 className={styles.brandName}>Arya Tarray</h2>
          <span className={styles.brandSub}>NUSANTARA</span>
        </div>
      </div>

      <p className={styles.brandTagline}>Faith • Compassion • Community</p>
    </div>
  );
}
