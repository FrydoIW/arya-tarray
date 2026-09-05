import Image from "next/image";
import { Heart, Leaf, Users } from "lucide-react";
import loginHero from "@/assets/login/login-hero-clean.png";
import styles from "../styles/login.module.css";

const heroValues = [
  {
    icon: Users,
    title: "Pelayanan Umat",
    description: "Mendukung kegiatan keagamaan dan sosial secara tertata."
  },
  {
    icon: Heart,
    title: "Kebersamaan",
    description: "Membangun komunitas wihara yang hangat dan harmonis."
  },
  {
    icon: Leaf,
    title: "Masa Depan",
    description: "Menjaga tata kelola yang rapi untuk perkembangan berkelanjutan."
  }
];

export function LoginHero() {
  return (
    <aside className={styles.heroPanel} aria-label="Arya Tarray introduction">
      <div className={styles.heroMedia} aria-hidden="true">
        <Image
          src={loginHero}
          alt=""
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 52vw"
          className={styles.heroImage}
        />
        <div className={styles.heroOverlay} />
      </div>

      <div className={styles.heroContent}>
        <div className={styles.heroCopy}>
          <span className={styles.heroEyebrow}>Arya Tarray Nusantara</span>
          <h2>Bersama dalam Mewujudkan Kebajikan</h2>
          <p>
            Teknologi untuk mendukung kegiatan wihara, pelayanan umat,
            dan pengelolaan operasional yang lebih rapi, aman, dan berkelanjutan.
          </p>
        </div>

        <div className={styles.heroValues}>
          {heroValues.map(({ icon: Icon, title, description }) => (
            <article key={title} className={styles.heroValueCard}>
              <span className={styles.heroValueIcon} aria-hidden="true">
                <Icon size={18} />
              </span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </aside>
  );
}
