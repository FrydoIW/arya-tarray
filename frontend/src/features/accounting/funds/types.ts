import type { ApprovalDetail } from '../core/types';
import type { RetainedApproval } from '../schedules/types';

export const fundClasses = ['UNRESTRICTED', 'DONOR_RESTRICTED', 'CONDITIONAL_LIABILITY', 'CONDITIONAL_REVIEW'] as const;
export type FundClass = typeof fundClasses[number];
export type FundPolicy = {
  policyReference: string;
  contributionAccountId: string;
  conditionalObligationEvidence: string | null;
  release: null | {
    mode: 'REVENUE_RECLASSIFICATION' | 'NET_ASSET_RECLASSIFICATION';
    debitAccountId: string;
    creditAccountId: string;
  };
};
export type FundInput = {
  fundCode: string; fundName: string; description: string | null; fundClass: FundClass;
  balanceAccountId: string | null; eventCampaignId: string | null; effectiveOn: string;
  expiresOn: string | null; sourceReference: string; policy: FundPolicy | null;
};
export type Fund = FundInput & {
  id: string; status: string; revision: number; createdById: string; updatedById: string;
  createdAt: string; updatedAt: string; policyStatus?: string;
};
export type FundDetail = Fund & { history: RetainedApproval[]; historyLimit: number };

export type ContributionSource = {
  id: string; journalId: string; sourceKind: string; accountingDate: string;
  bankTransactionId: string | null; eventCodeId: string | null; eventCampaignId: string | null;
  memberIdentityId: string | null; historicalMemberId: string | null; accountType: string;
  originalAmount: string; reservedOrClassifiedAmount: string; unallocatedAmount: string;
};
export type ContributionPage = {
  page: number; pageSize: number; total: number; rows: ContributionSource[];
  classificationStatus: string; recognitionCreated: false;
};

export const restrictionKinds = ['PURPOSE', 'TIME', 'BOTH'] as const;
export const purposeCriteria = ['EXPENSE_INCURRED', 'CAPITAL_ACQUIRED', 'MILESTONE', 'TIME_ONLY'] as const;
export type RestrictionInput = {
  sourceJournalLineId: string; originalAmount: string; donorMemberId: string | null;
  restrictionKind: typeof restrictionKinds[number]; purposeText: string | null; effectiveOn: string;
  releaseOn: string | null; supportingReference: string; termsEvidence: string;
  criteria: { purposeCriterion: typeof purposeCriteria[number]; eligibilityTerms: string; termsEffectiveOn?: string };
  eventCampaignId: string | null;
};
export type Restriction = RestrictionInput & {
  id: string; accountingFundId: string; status: string; classificationJournalId: string | null;
  revision: number; createdById: string; updatedById: string; createdAt: string; updatedAt: string;
  releasedAmount: string; remainingAmount: string;
};
export type RestrictionDetail = Restriction & { history: RetainedApproval[]; historyLimit: number };

export type DesignationInput = { designationReference: string; purposeText: string; amount: string; effectiveOn: string };
export type Designation = DesignationInput & {
  id: string; accountingFundId: string; approvedAt: string | null; approvedById: string | null;
  status: string; revision: number; createdById: string; updatedById: string; createdAt: string;
};
export type DesignationDetail = Designation & { history: RetainedApproval[]; historyLimit: number };

export type FundMovementInput = {
  action: 'CLASSIFY' | 'OPENING'; sourceJournalLineId: string; amount: string;
  accountingDate: string; sourceReference: string; reason: string;
};
export type FundCommand = { accountingDate: string; sourceReference: string; reason: string } & (
  | { action: 'CLOSE' | 'REOPEN' }
  | { action: 'AMEND_TERMS'; restrictionId: string; purposeText: string | null; releaseOn: string | null; termsEvidence: string; criteria: RestrictionInput['criteria'] }
  | { action: 'DESIGNATION_ADJUST'; designationId: string; amount: string; purposeText: string }
  | { action: 'DESIGNATION_RELEASE' | 'DESIGNATION_CANCEL'; designationId: string }
);
export type FundMovement = {
  id: string; accountingFundId: string; fundRestrictionId: string | null; fundDesignationId: string | null;
  accountingDate: string; sourceKind: 'FUND_COMMAND' | 'FUND_JOURNAL' | 'FUND_AUDIT'; sourceReference: string;
  description: string; status: string; revision: number; createdById: string; postedJournalId: string | null;
  fundMetadata: FundMovementInput | FundCommand;
};
export type FundMovementDetail = FundMovement & { history: RetainedApproval[]; historyLimit: number };

export type ReleaseInput = {
  amount: string; releaseReference: string; accountingDate: string; satisfactionDate: string;
  targetFundId: string; releaseReason: string; eligibilityEvidence: string;
  evidenceReference: string; evidenceJournalLineId: string | null;
};
export type FundRelease = {
  id: string; fundRestrictionId: string; releaseReference: string; releaseDate: string;
  releaseReason: string; releaseJournalId: string; createdById: string; createdAt: string;
  amount: string; satisfactionDate: string; eligibilityEvidence: string; evidenceReference: string;
  evidenceJournalLineId: string | null; targetFundId: string; activeEvidenceKey: string | null;
};
export type FundJournal = {
  id: string; journalNumber: string; accountingDate: string; journalType: string;
  sourceKind: string; sourceReference: string | null; reversalOfJournalId: string | null;
};
export type FundMetrics = {
  fundId: string; fundClass: FundClass; scope: string;
  recognizedContributionClassifications: string; classifiedConditionalLiabilityContributions: string;
  openingNetAssetClassifications: string; accountingNetAssets: string; netRevenueIncludingReclassifications: string;
  recognizedExpenses: string; economicNetResources: string; liabilityControlNet: string;
  restrictedOriginalAmount: string; eligibleReleasedAmount: string; unreleasedRestrictions: string;
  internalDesignations: string; managementAvailableNetResources: string | null;
  actualFundTaggedBankCash: string; cashAttribution: string; relatedEligibleRecognizedExpenses: string;
  commitments: null; commitmentStatus: string; campaignWallet: string | null; walletScope: string;
};
export type FundReconciliation = {
  metrics: FundMetrics; exceptions: { code: string; reason: string; sourceId?: string }[];
  reviewRequests: { id: string; sourceDocumentId: string; status: string; decisionRemark: string | null }[];
  reviewRequestsLimit: number; invalidAttemptHandling: string; exceptionsTruncated: boolean;
  automaticAdjustments: false; status: 'RECONCILED' | 'REVIEW_REQUIRED';
};
export type FundApprovalAction = Pick<ApprovalDetail, 'id' | 'status' | 'sourceVersion' | 'sourceDocumentId'>;
export type FundSourcePath = 'funds' | 'fund-restrictions' | 'fund-designations' | 'fund-movements';
