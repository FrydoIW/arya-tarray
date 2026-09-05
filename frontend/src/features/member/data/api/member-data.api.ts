import { apiFetch } from "@/lib/api";
import type { DonationQuery, DonationWorkspace, IdentityOption, MemberDataQuery, MemberDetail, MemberOption, MemberProfileInput, MemberRow, MemberWorkspace } from "../types";

const base = "/member/data";
export function getWorkspace(query: MemberDataQuery, signal?: AbortSignal) {
  return apiFetch<MemberWorkspace>(base + "/workspace?" + new URLSearchParams({
    search: query.search, status: query.status, city: query.city, registrationSource: query.registrationSource,
    periodMode: query.periodMode, month: query.month, date: query.date, ...(query.eventCodeId ? { eventCodeId: query.eventCodeId } : {}),
    page: String(query.page), pageSize: String(query.pageSize)
  }), { signal });
}
export function getDetail(memberId: string, signal?: AbortSignal) { return apiFetch<MemberDetail>(base + "/" + encodeURIComponent(memberId), { signal }); }
export function getDonations(memberId: string, query: DonationQuery, signal?: AbortSignal) {
  return apiFetch<DonationWorkspace>(`${base}/${encodeURIComponent(memberId)}/donations?` + new URLSearchParams({
    periodMode: query.periodMode, month: query.month, date: query.date, ...(query.eventCodeId ? { eventCodeId: query.eventCodeId } : {}),
    page: String(query.page), pageSize: String(query.pageSize)
  }), { signal });
}
export function getIdentityOptions(search: string, signal?: AbortSignal) { return apiFetch<IdentityOption[]>(base + "/identity-options?" + new URLSearchParams({ search }), { signal }); }
export function getMemberOptions(search: string, excludeMemberId: string, signal?: AbortSignal) {
  return apiFetch<MemberOption[]>(base + "/member-options?" + new URLSearchParams({ search, excludeMemberId }), { signal });
}
export function updateProfile(memberId: string, input: MemberProfileInput) {
  return apiFetch<MemberRow>(base + "/" + encodeURIComponent(memberId), { method: "PATCH", body: JSON.stringify(input) });
}
function identityAction(memberId: string, identityId: string, action: string, payload?: unknown) {
  return apiFetch<{ message: string }>(`${base}/${encodeURIComponent(memberId)}/identities/${encodeURIComponent(identityId)}/${action}`,
    { method: "POST", body: payload === undefined ? undefined : JSON.stringify(payload) });
}
export function attachIdentity(memberId: string, identityId: string) { return identityAction(memberId, identityId, "attach"); }
export function moveIdentity(memberId: string, identityId: string, destinationMemberId: string) { return identityAction(memberId, identityId, "move", { destinationMemberId }); }
export function detachIdentity(memberId: string, identityId: string) { return identityAction(memberId, identityId, "detach"); }
export function updateIdentity(memberId: string, identityId: string, input: { initialName?: string | null; remark?: string | null }) {
  return apiFetch<{ message: string }>(`${base}/${encodeURIComponent(memberId)}/identities/${encodeURIComponent(identityId)}`,
    { method: "PATCH", body: JSON.stringify(input) });
}
