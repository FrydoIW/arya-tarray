import Image from "next/image";
import aryaLogo from "@/assets/brand/arya-lotus.svg";
import styles from "../styles/login.module.css";

export function AryaBrand() {
  return (
    <div className={styles.brand}>
      <div className={styles.brandRow}>
        <div className={styles.brandLogoWrap} aria-hidden="true">
          <Image
            src={aryaLogo}
            alt=""
            width={116}
            height={92}
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
