import { UserPlus, UserCheck, UserMinus } from "lucide-react";
import { MetricCard } from "@/components/ui/MetricCard";
import type { Workspace } from "../types";
import styles from "../styles/member-registration.module.css";
export function MemberRegistrationSummary({ summary }: { summary: Workspace["summary"] }) {
  return <section className={styles.summary}>
    <MetricCard label="Belum Registrasi" value={summary.unverified} detail="identitas menunggu keputusan" icon={<UserPlus size={20} />} tone="gold" />
    <MetricCard label="Terverifikasi" value={summary.verified} detail="identitas terhubung ke donatur" icon={<UserCheck size={20} />} tone="green" />
    <MetricCard label="Diabaikan" value={summary.ignored} detail="tetap tersimpan untuk penelusuran" icon={<UserMinus size={20} />} tone="blue" />
  </section>;
}
