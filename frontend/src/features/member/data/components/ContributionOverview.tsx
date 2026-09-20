"use client";

import { CalendarDays, Gift, HandCoins } from "lucide-react";
import { formatMoney } from "@/lib/format";
import type { SponsorshipWorkspace } from "../types";
import styles from "../styles/program-allocation.module.css";

const TYPE_ORDER = ["STANDARD", "CAMPAIGN", "TIME_BASED"] as const;
const TYPE_META = {
  STANDARD: { label: "Standard", icon: <HandCoins size={18} /> },
  CAMPAIGN: { label: "Campaign", icon: <Gift size={18} /> },
  TIME_BASED: { label: "Time-based", icon: <CalendarDays size={18} /> }
} as const;

export function ContributionOverview({ totals }: { totals: SponsorshipWorkspace["contributionTotals"] }) {
  return <section className={styles.section} aria-labelledby="pa-contribution-title">
    <div className={styles.sectionHead}>
      <div><h2 id="pa-contribution-title">Contribution</h2><p>Konteks finansial dari Riwayat Donasi. Allocation tidak mengubah nilai ini.</p></div>
    </div>
    <div className={styles.typeSummary}>
      {TYPE_ORDER.map(type => <article key={type} className={styles.typeTile} data-type={type}>
        <span className={styles.typeIcon} aria-hidden="true">{TYPE_META[type].icon}</span>
        <div>
          <span>{TYPE_META[type].label}</span>
          <strong className={styles.money}>{formatMoney(totals[type]?.amount ?? "0")}</strong>
          <small>{totals[type]?.transactionCount ?? 0} transaksi</small>
        </div>
      </article>)}
    </div>
  </section>;
}
