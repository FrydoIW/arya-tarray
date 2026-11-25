import { formatDateTime, formatMoney } from "@/lib/format";
import type { Candidate } from "../types";
import styles from "../styles/member-registration.module.css";
export function IdentityContext({ candidate }: { candidate: Candidate }) {
  return <dl className={styles.context}>
    <div><dt>Nama Rekening</dt><dd>{candidate.accountName}</dd></div>
    {candidate.bankName ? <div><dt>Bank</dt><dd>{candidate.bankName}</dd></div> : null}
    {candidate.accountNumber ? <div><dt>Account Number</dt><dd>{candidate.accountNumber}</dd></div> : null}
    <div><dt>First Seen</dt><dd>{formatDateTime(candidate.firstSeenAt)}</dd></div>
    <div><dt>Transactions</dt><dd>{candidate.transactionCount}</dd></div>
    <div><dt>Observed Amount</dt><dd>{formatMoney(candidate.observedAmount)}</dd></div>
    {candidate.verificationStatus === "UNVERIFIED" ? <div>
      <dt>Verifikasi pengirim</dt>
      <dd>Cocokkan bukti transfer sebelum registrasi atau tautkan ke donatur yang sudah ada. Nama rekening saja tidak memastikan kepemilikan.</dd>
    </div> : null}
    {candidate.evidence?.map(row => <div key={row.id}>
      <dt>{row.referenceNo || row.id}</dt>
      <dd>{row.fileName} · {row.transactionDate?.slice(0, 10) ?? "—"} · {formatMoney(row.amount)}</dd>
    </div>)}
  </dl>;
}
