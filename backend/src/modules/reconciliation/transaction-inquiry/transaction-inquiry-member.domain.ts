export type TransactionInquiryMember = {
  id: string;
  memberCode: string;
  memberName: string;
  initialName: string | null;
  activeFlag: boolean;
};

export function resolveCanonicalTransactionMember(
  identity: { member: TransactionInquiryMember | null } | null | undefined
): TransactionInquiryMember | null {
  return identity?.member ?? null;
}

export function transactionHasCanonicalMember(
  identity: { member: TransactionInquiryMember | null } | null | undefined
) {
  return resolveCanonicalTransactionMember(identity) !== null;
}
