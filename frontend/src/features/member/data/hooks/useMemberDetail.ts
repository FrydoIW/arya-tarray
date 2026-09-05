"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api/member-data.api";
import type { MemberDetail, MemberProfileInput } from "../types";

export function useMemberDetail(memberId: string) {
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [reload, setReload] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    api.getDetail(memberId, controller.signal).then(data => { if (!controller.signal.aborted) setDetail(data); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Gagal memuat profil donatur."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [memberId, reload]);
  const refresh = useCallback(() => setReload(value => value + 1), []);
  async function perform(action: () => Promise<unknown>, success: string) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); setMessage(success); refresh(); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Tindakan gagal."); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  return { detail, loading, busy, error, message, clearError: () => setError(""), refresh,
    updateProfile: (input: MemberProfileInput) => perform(() => api.updateProfile(memberId, input), "Profil donatur diperbarui."),
    attach: (identityId: string) => perform(() => api.attachIdentity(memberId, identityId), "Identitas ditambahkan."),
    move: (identityId: string, destinationMemberId: string) => perform(() => api.moveIdentity(memberId, identityId, destinationMemberId), "Identitas dipindahkan."),
    detach: (identityId: string) => perform(() => api.detachIdentity(memberId, identityId), "Identitas dilepas ke Registrasi Donatur."),
    updateIdentity: (identityId: string, input: { initialName?: string | null; remark?: string | null }) => perform(() => api.updateIdentity(memberId, identityId, input), "Metadata identitas diperbarui.") };
}
