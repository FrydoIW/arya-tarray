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
  </dl>;
}
