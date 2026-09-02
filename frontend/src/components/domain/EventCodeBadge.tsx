import styles from "./EventCodeBadge.module.css";

export function EventCodeBadge({ code }: { code: string }) {
  return <span className={styles.badge}>{code}</span>;
}
