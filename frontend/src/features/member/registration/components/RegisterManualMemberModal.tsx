import { Modal } from "@/components/ui/Modal";
import type { MemberInput } from "../types";
import { MemberRegistrationForm } from "./MemberRegistrationForm";
import styles from "../styles/member-registration.module.css";
export function RegisterManualMemberModal({ busy, error, onClose, onSubmit }: { busy: boolean; error: string; onClose: () => void; onSubmit: (input: MemberInput) => Promise<boolean> }) {
  return <Modal open title="Registrasi Manual" description="Daftarkan donatur tanpa identitas dari statement." onClose={() => { if (!busy) onClose(); }}>
    <div className={styles.modalBody}><MemberRegistrationForm busy={busy} error={error} onClose={onClose} onSubmit={onSubmit} /></div>
  </Modal>;
}
