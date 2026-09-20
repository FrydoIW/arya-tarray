import { apiFetch } from "@/lib/api";
import type { CarryTransferHistory, CarryTransferInput, CarryTransferResult, CarryTransferReverseInput, CarryTransferReversalResult, DonationQuery, DonationWorkspace, IdentityHistoryWorkspace, IdentityMetadataInput, IdentityOption, MemberDataQuery, MemberDetail, MemberOption, MemberProfileInput, MemberRow, MemberWorkspace, OpeningCoverageInput, SponsorshipWorkspace, SubscriptionInput } from "../types";

const base = "/member/data";
export function getWorkspace(query: MemberDataQuery, signal?: AbortSignal) {
  return apiFetch<MemberWorkspace>(base + "/workspace?" + new URLSearchParams({
    search: query.search, status: query.status, city: query.city, registrationSource: query.registrationSource, programBalance: query.programBalance,
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
export function getSponsorship(memberId: string, signal?: AbortSignal) { return apiFetch<SponsorshipWorkspace>(`${base}/${encodeURIComponent(memberId)}/sponsorship`, { signal }); }
export function createSubscription(memberId: string, input: SubscriptionInput) { return apiFetch<SponsorshipWorkspace>(`${base}/${encodeURIComponent(memberId)}/subscriptions`, { method: "POST", body: JSON.stringify(input) }); }
export function updateSubscription(memberId: string, subscriptionId: string, input: Omit<SubscriptionInput, "eventCodeId">) { return apiFetch<SponsorshipWorkspace>(`${base}/${encodeURIComponent(memberId)}/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "PATCH", body: JSON.stringify(input) }); }
export function allocateSponsorshipPayment(memberId: string, subscriptionId: string, transactionId: string) { return apiFetch<SponsorshipWorkspace>(`${base}/${encodeURIComponent(memberId)}/subscriptions/${encodeURIComponent(subscriptionId)}/allocate`, { method: "POST", body: JSON.stringify({ transactionId }) }); }
export function addOpeningCoverage(memberId: string, subscriptionId: string, input: OpeningCoverageInput) { return apiFetch<SponsorshipWorkspace>(`${base}/${encodeURIComponent(memberId)}/subscriptions/${encodeURIComponent(subscriptionId)}/opening-coverage`, { method: "POST", body: JSON.stringify(input) }); }
export function voidOpeningCoverage(memberId: string, subscriptionId: string, coverageId: string, reason: string) { return apiFetch<SponsorshipWorkspace>(`${base}/${encodeURIComponent(memberId)}/subscriptions/${encodeURIComponent(subscriptionId)}/opening-coverage/${encodeURIComponent(coverageId)}/void`, { method: "POST", body: JSON.stringify({ reason }) }); }
export function retryAllocation(memberId: string, subscriptionId: string, transactionId: string) { return apiFetch<SponsorshipWorkspace>(`${base}/${encodeURIComponent(memberId)}/subscriptions/${encodeURIComponent(subscriptionId)}/retry-allocation`, { method: "POST", body: JSON.stringify({ transactionId }) }); }
export function getCarryTransfers(memberId: string, page: number, pageSize: number, signal?: AbortSignal) {
  return apiFetch<CarryTransferHistory>(`${base}/${encodeURIComponent(memberId)}/carry-transfers?` + new URLSearchParams({
    page: String(page), pageSize: String(pageSize)
  }), { signal });
}
export function createCarryTransfer(memberId: string, sourceSubscriptionId: string, input: CarryTransferInput) {
  return apiFetch<CarryTransferResult>(`${base}/${encodeURIComponent(memberId)}/subscriptions/${encodeURIComponent(sourceSubscriptionId)}/carry-transfers`,
    { method: "POST", body: JSON.stringify(input) });
}
export function reverseCarryTransfer(memberId: string, transferId: string, input: CarryTransferReverseInput) {
  return apiFetch<CarryTransferReversalResult>(`${base}/${encodeURIComponent(memberId)}/carry-transfers/${encodeURIComponent(transferId)}/reverse`,
    { method: "POST", body: JSON.stringify(input) });
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
