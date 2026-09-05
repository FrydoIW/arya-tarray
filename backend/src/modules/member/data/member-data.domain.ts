export function deriveAge(birthDate: Date | string | null, today: string) {
  if (!birthDate) return null;
  const value = birthDate instanceof Date ? birthDate.toISOString().slice(0, 10) : birthDate.slice(0, 10);
  const [birthYear, birthMonth, birthDay] = value.split("-").map(Number);
  const [year, month, day] = today.split("-").map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age--;
  return Math.max(0, age);
}

export function mayAttachIdentity(identity: { memberId: string | null; verificationStatus: string }) {
  return identity.memberId === null && identity.verificationStatus === "UNVERIFIED";
}

export function mayMoveIdentity(identity: { memberId: string | null; verificationStatus: string }, sourceMemberId: string, destinationMemberId: string, destinationActive: boolean) {
  return destinationActive && sourceMemberId !== destinationMemberId && identity.memberId === sourceMemberId && identity.verificationStatus === "VERIFIED";
}

export function mayDetachIdentity(identity: { memberId: string | null; verificationStatus: string }, sourceMemberId: string) {
  return identity.memberId === sourceMemberId && identity.verificationStatus === "VERIFIED";
}

export function verifiedIdentityData(memberId: string, userId: string, now: Date) {
  return { memberId, verificationStatus: "VERIFIED", verifiedAt: now, verifiedById: userId, updatedById: userId } as const;
}

export function detachedIdentityData(userId: string) {
  return { memberId: null, verificationStatus: "UNVERIFIED", verifiedAt: null, verifiedById: null, updatedById: userId } as const;
}
