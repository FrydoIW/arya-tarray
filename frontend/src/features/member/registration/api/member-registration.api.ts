import { apiFetch } from "@/lib/api";
import type { MemberInput, MemberOption, Workspace, WorkspaceQuery } from "../types";
const base = "/member/registration";
export function getWorkspace(query: WorkspaceQuery, signal?: AbortSignal) {
  return apiFetch<Workspace>(base + "/workspace?" + new URLSearchParams({
    search: query.search, status: query.status, page: String(query.page), pageSize: String(query.pageSize)
  }), { signal });
}
export function getMemberOptions(search: string, signal?: AbortSignal) {
  return apiFetch<MemberOption[]>(base + "/member-options?" + new URLSearchParams({ search }), { signal });
}
function post<T>(path: string, payload: unknown) { return apiFetch<T>(base + path, { method: "POST", body: JSON.stringify(payload) }); }
export function registerMember(input: MemberInput, identityId?: string) {
  return post<MemberOption>(identityId ? "/" + encodeURIComponent(identityId) + "/register" : "/manual", input);
}
export function linkMember(identityId: string, memberId: string) {
  return post<MemberOption>("/" + encodeURIComponent(identityId) + "/link", { memberId });
}
export function ignoreIdentity(identityId: string, reason: string) {
  return post<{ message: string }>("/" + encodeURIComponent(identityId) + "/ignore", { reason });
}
