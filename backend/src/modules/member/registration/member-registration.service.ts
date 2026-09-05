import * as repository from "./member-registration.repository.js";
import type { MemberInput, WorkspaceQuery } from "./member-registration.schema.js";

function memberSummary(member: Awaited<ReturnType<typeof repository.memberOptions>>[number]) {
  const { id, ...fields } = member;
  return { memberId: id, ...fields };
}
export async function getWorkspace(query: WorkspaceQuery) {
  const records = await repository.workspaceRecords(query);
  const aggregateById = new Map(records.aggregates.map(row => [row.memberIdentityId, row]));
  const count = (status: string) => records.counts.find(row => row.verificationStatus === status)?._count._all ?? 0;
  return {
    summary: { unverified: count("UNVERIFIED"), verified: count("VERIFIED"), ignored: count("IGNORED") },
    rows: records.rows.map(({ id, member, ...row }) => ({
      ...row, memberIdentityId: id, member: member ? memberSummary(member) : null,
      transactionCount: aggregateById.get(id)?._count._all ?? 0,
      observedAmount: aggregateById.get(id)?._sum.originalAmount?.toString() ?? "0.00"
    })),
    pagination: { page: records.page, pageSize: query.pageSize, total: records.total, totalPages: Math.max(1, Math.ceil(records.total / query.pageSize)) }
  };
}
export async function getMemberOptions(search: string) { return (await repository.memberOptions(search)).map(memberSummary); }
export async function register(input: MemberInput, userId: string, identityId?: string) {
  return memberSummary(await repository.registerMember(input, userId, identityId));
}
export async function link(identityId: string, memberId: string, userId: string) {
  return memberSummary(await repository.linkMember(identityId, memberId, userId));
}
export const ignore = repository.ignoreIdentity;
