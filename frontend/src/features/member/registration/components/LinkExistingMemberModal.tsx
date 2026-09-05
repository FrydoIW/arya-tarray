"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import { getMemberOptions } from "../api/member-registration.api";
import type { Candidate, MemberOption } from "../types";
import { IdentityContext } from "./IdentityContext";
import styles from "../styles/member-registration.module.css";
export function LinkExistingMemberModal({ candidate, busy, error, onClose, onSubmit }: {
  candidate: Candidate; busy: boolean; error: string; onClose: () => void; onSubmit: (memberId: string) => Promise<boolean>;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MemberOption[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getMemberOptions(search.trim(), controller.signal).then(rows => { if (!controller.signal.aborted) setResults(rows); })
        .catch(caught => { if (!controller.signal.aborted) setSearchError(caught instanceof Error ? caught.message : "Pencarian gagal."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);
  return <Modal open title="Link Existing Donatur" description="Pilih donatur secara eksplisit untuk identitas ini." onClose={() => { if (!busy) onClose(); }}>
    <div className={styles.modalBody}>
      <IdentityContext candidate={candidate} />
      <SearchInput value={search} maxLength={150} disabled={busy} aria-label="Cari donatur aktif" placeholder="Cari nama, kode, initial, kota"
        onChange={e => { setSearch(e.target.value); setSelected(""); setResults([]); setLoading(true); setSearchError(""); }} />
      <fieldset className={styles.options} disabled={busy || loading}><legend>Donatur aktif</legend>
        {loading ? <p role="status">Mencari…</p> : results.length === 0 ? <p>Tidak ada donatur ditemukan.</p> : results.map(member => <label key={member.memberId}>
          <input type="radio" name="member" value={member.memberId} checked={selected === member.memberId} onChange={() => setSelected(member.memberId)} />
          <span><strong>{member.memberCode} · {member.memberName}</strong><small>{[member.initialName, member.city].filter(Boolean).join(" · ") || "—"}</small></span>
        </label>)}
      </fieldset>
      {error || searchError ? <p className="ui-alert ui-alert-error" role="alert">{error || searchError}</p> : null}
      <div className={styles.footer}><Button variant="secondary" disabled={busy} onClick={onClose}>Batal</Button>
        <Button disabled={busy || loading || !selected} onClick={async () => { if (await onSubmit(selected)) onClose(); }}>{busy ? "Menyimpan…" : "Link"}</Button></div>
    </div>
  </Modal>;
}
