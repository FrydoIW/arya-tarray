import { Modal } from "@/components/ui/Modal";
import type { Candidate, MemberInput } from "../types";
import { IdentityContext } from "./IdentityContext";
import { MemberRegistrationForm } from "./MemberRegistrationForm";
import styles from "../styles/member-registration.module.css";
export function RegisterNewMemberModal({ candidate, busy, error, onClose, onSubmit }: { candidate: Candidate; busy: boolean; error: string; onClose: () => void; onSubmit: (input: MemberInput) => Promise<boolean> }) {
  return <Modal open title="Registrasi Donatur" description="Konfirmasi data donatur dari identitas statement." onClose={() => { if (!busy) onClose(); }}>
    <div className={styles.modalBody}><IdentityContext candidate={candidate} /><MemberRegistrationForm name={candidate.accountName} initialName={candidate.initialName ?? ""} busy={busy} error={error} onClose={onClose} onSubmit={onSubmit} /></div>
  </Modal>;
}
