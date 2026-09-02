import Image from "next/image";
import styles from "../styles/login.module.css";

export function LoginHero() {
  return (
    <div className={styles.backgroundLayer} aria-hidden="true">
      <Image
        src="/images/login/login-temple-bg.webp"
        alt=""
        fill
        priority
        sizes="100vw"
        className={styles.backgroundImage}
      />
      <div className={styles.backgroundOverlay} />
    </div>
  );
}
