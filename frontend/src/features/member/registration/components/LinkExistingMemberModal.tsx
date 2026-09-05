"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/SearchInput";
import { isAbortError } from "@/lib/api";
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
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSearchError("");
    const timer = setTimeout(() => {
      getMemberOptions(search.trim(), controller.signal).then(rows => { if (!controller.signal.aborted) setResults(rows); })
        .catch(caught => {
          if (!isAbortError(caught)) {
            setResults([]);
            setSearchError(caught instanceof Error ? caught.message : "Pencarian gagal.");
          }
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, retryKey]);
  return <Modal open title="Link Existing Donatur" description="Pilih donatur secara eksplisit untuk identitas ini." onClose={() => { if (!busy) onClose(); }}>
    <div className={styles.modalBody}>
      <IdentityContext candidate={candidate} />
      <SearchInput value={search} maxLength={150} disabled={busy} aria-label="Cari donatur aktif" placeholder="Cari nama, kode, initial, kota"
        onChange={e => { setSearch(e.target.value); setSelected(""); setResults([]); setLoading(true); setSearchError(""); }} />
      <fieldset className={styles.options} disabled={busy || loading}><legend>Donatur aktif</legend>
        {loading ? <p role="status">Mencari…</p> : searchError
          ? <div className="ui-alert ui-alert-error" role="alert">{searchError} <Button type="button" size="sm" variant="ghost" onClick={() => setRetryKey(value => value + 1)}>Coba lagi</Button></div>
          : results.length === 0 ? <p>Tidak ada donatur ditemukan.</p> : results.map(member => <label key={member.memberId}>
          <input type="radio" name="member" value={member.memberId} checked={selected === member.memberId} onChange={() => setSelected(member.memberId)} />
          <span><strong>{member.memberCode} · {member.memberName}</strong><small>{[member.initialName, member.city].filter(Boolean).join(" · ") || "—"}</small></span>
        </label>)}
      </fieldset>
      {error ? <p className="ui-alert ui-alert-error" role="alert">{error}</p> : null}
      <div className={styles.footer}><Button variant="secondary" disabled={busy} onClick={onClose}>Batal</Button>
        <Button disabled={busy || loading || !selected} onClick={async () => { if (await onSubmit(selected)) onClose(); }}>{busy ? "Menyimpan…" : "Link"}</Button></div>
    </div>
  </Modal>;
}
