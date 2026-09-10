"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import type { Candidate } from "../types";
import { useMemberRegistration } from "../hooks/useMemberRegistration";
import { MemberRegistrationSummary } from "./MemberRegistrationSummary";
import { MemberCandidateTable } from "./MemberCandidateTable";
import { RegisterNewMemberModal } from "./RegisterNewMemberModal";
import { RegisterManualMemberModal } from "./RegisterManualMemberModal";
import { LinkExistingMemberModal } from "./LinkExistingMemberModal";
import { IgnoreIdentityModal } from "./IgnoreIdentityModal";
import styles from "../styles/member-registration.module.css";
type Action = { kind: "register" | "link" | "ignore"; row: Candidate } | { kind: "manual" } | null;
export function MemberRegistrationScreen() {
  const state = useMemberRegistration();
  const [action, setAction] = useState<Action>(null);
  const close = () => setAction(null);
  return <div className="page-stack">
    <PageHeader title="Registrasi Donatur" breadcrumb={["Donatur", "Registrasi Donatur"]} description="Tinjau identitas pengirim dan hubungkan dengan donatur."
      actions={<Button icon={<UserPlus size={16} />} disabled={state.busy} onClick={() => { state.clearError(); setAction({ kind: "manual" }); }}>Registrasi Manual</Button>} />
    {state.message ? <div className="ui-alert ui-alert-success" role="status">{state.message}</div> : null}
    {state.error && !action ? <div className="ui-alert ui-alert-error" role="alert">{state.error}</div> : null}
    <MemberRegistrationSummary summary={state.workspace.summary} />
    <MemberCandidateTable workspace={state.workspace} query={state.query} search={state.search} loading={state.loading} busy={state.busy}
      onSearch={state.setSearch} onStatus={state.changeStatus} onPage={state.changePage} onPageSize={state.changePageSize} onReload={state.refresh}
      onAction={(kind, row) => { state.clearError(); setAction({ kind, row }); }} />
    <p className={styles.note}>Observed Amount adalah konteks transaksi yang terhubung ke identitas, bukan total donasi seumur hidup.</p>
    {action?.kind === "manual" ? <RegisterManualMemberModal busy={state.busy} error={state.error} onClose={close} onSubmit={input => state.register(input)} /> : null}
    {action?.kind === "register" ? <RegisterNewMemberModal candidate={action.row} busy={state.busy} error={state.error} onClose={close} onSubmit={input => state.register(input, action.row.memberIdentityId)} /> : null}
    {action?.kind === "link" ? <LinkExistingMemberModal candidate={action.row} busy={state.busy} error={state.error} onClose={close} onSubmit={id => state.link(action.row.memberIdentityId, id)} /> : null}
    {action?.kind === "ignore" ? <IgnoreIdentityModal candidate={action.row} busy={state.busy} error={state.error} onClose={close} onSubmit={reason => state.ignore(action.row.memberIdentityId, reason)} /> : null}
  </div>;
}
