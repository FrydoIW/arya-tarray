import { apiFetch } from "@/lib/api";
import type { DonationQuery, DonationWorkspace, IdentityHistoryWorkspace, IdentityMetadataInput, IdentityOption, MemberDataQuery, MemberDetail, MemberOption, MemberProfileInput, MemberRow, MemberWorkspace } from "../types";

const base = "/member/data";
export function getWorkspace(query: MemberDataQuery, signal?: AbortSignal) {
  return apiFetch<MemberWorkspace>(base + "/workspace?" + new URLSearchParams({
    search: query.search, status: query.status, city: query.city, registrationSource: query.registrationSource,
    page: String(query.page), pageSize: String(query.pageSize)
  }), { signal });
}
export function getDetail(memberId: string, signal?: AbortSignal) { return apiFetch<MemberDetail>(base + "/" + encodeURIComponent(memberId), { signal }); }
export function getDonations(memberId: string, query: DonationQuery, signal?: AbortSignal) {
  return apiFetch<DonationWorkspace>(`${base}/${encodeURIComponent(memberId)}/donations?` + new URLSearchParams({
    periodMode: query.periodMode, month: query.month, date: query.date, ...(query.eventCodeId ? { eventCodeId: query.eventCodeId } : {}),
    search: query.search, page: String(query.page), pageSize: String(query.pageSize)
  }), { signal });
}
export function getIdentityHistory(memberId: string, page: number, pageSize: number, signal?: AbortSignal) {
  return apiFetch<IdentityHistoryWorkspace>(`${base}/${encodeURIComponent(memberId)}/identity-history?` + new URLSearchParams({
    page: String(page), pageSize: String(pageSize)
  }), { signal });
}
export function getIdentityOptions(search: string, signal?: AbortSignal) { return apiFetch<IdentityOption[]>(base + "/identity-options?" + new URLSearchParams({ search }), { signal }); }
export function getMemberOptions(search: string, excludeMemberId: string, signal?: AbortSignal) {
  return apiFetch<MemberOption[]>(base + "/member-options?" + new URLSearchParams({ search, excludeMemberId }), { signal });
}
export function updateProfile(memberId: string, input: MemberProfileInput) {
  return apiFetch<MemberRow>(base + "/" + encodeURIComponent(memberId), { method: "PATCH", body: JSON.stringify(input) });
}
export function updateLifecycle(memberId: string, activeFlag: boolean) {
  return apiFetch<MemberRow>(base + "/" + encodeURIComponent(memberId) + "/lifecycle", { method: "PATCH", body: JSON.stringify({ activeFlag }) });
}
function identityAction(memberId: string, identityId: string, action: string, payload?: unknown) {
  return apiFetch<{ message: string }>(`${base}/${encodeURIComponent(memberId)}/identities/${encodeURIComponent(identityId)}/${action}`,
    { method: "POST", body: payload === undefined ? undefined : JSON.stringify(payload) });
}
export function attachIdentity(memberId: string, identityId: string) { return identityAction(memberId, identityId, "attach"); }
export function moveIdentity(memberId: string, identityId: string, destinationMemberId: string, reason: string) { return identityAction(memberId, identityId, "move", { destinationMemberId, reason }); }
export function detachIdentity(memberId: string, identityId: string, reason: string) { return identityAction(memberId, identityId, "detach", { reason }); }
export function updateIdentity(memberId: string, identityId: string, input: IdentityMetadataInput) {
  return apiFetch<{ message: string }>(`${base}/${encodeURIComponent(memberId)}/identities/${encodeURIComponent(identityId)}`,
    { method: "PATCH", body: JSON.stringify(input) });
}
