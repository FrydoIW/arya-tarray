import type { AccountingFiscalYear } from '../types';
import type { ApprovalDetail } from '../core/types';
import type { RetainedApproval } from '../schedules/types';

export const partialMonths = ['FULL_MONTH', 'NEXT_MONTH', 'ACTUAL_DAYS'] as const;
export type Policy = {
  policyReference: string; capitalizationThreshold: string; partialMonthPolicy: typeof partialMonths[number];
  impairmentEnabled: boolean; impairmentPolicyReference: string | null;
};
export type CategoryInput = {
  categoryCode: string; categoryName: string; defaultUsefulLifeMonths: number; defaultMethod: 'STRAIGHT_LINE';
  activeFlag: boolean; policy: Policy | null;
  assetAccountId: string; accumulatedDepreciationAccountId: string; depreciationExpenseAccountId: string;
  gainAccountId: string | null; lossAccountId: string | null; impairmentExpenseAccountId: string | null;
  impairmentAllowanceAccountId: string | null; disposalClearingAccountId: string | null;
};
export type Category = CategoryInput & { id: string; revision: number };
export type AssetInput = {
  assetNumber: string; assetName: string; description: string | null; location: string | null; custodianId: string | null;
  assetCategoryId: string; acquisitionJournalLineId: string; acquiredOn: string; inServiceOn: string;
  depreciationStartOn: string; usefulLifeMonths: number; residualValue: string; supportingEvidence: string;
};
export type DraftSource = { id: string; createdById: string; revision: number; status: string };
export type AssetRow = DraftSource & Omit<AssetInput, 'supportingEvidence'> & {
  acquisitionCost: string; sourceDocumentId: string | null; vendorId: string | null; depreciationMethod: string;
  policySnapshot: (Partial<Policy> & { supportingEvidence?: string }) | null; disposedOn: string | null;
  createdAt: string; updatedAt: string; updatedById: string;
};
export type AssetJournal = {
  id: string; journalNumber: string; accountingDate: string; journalType: string; sourceKind: string; sourceReference: string | null;
  reversalOfJournalId: string | null; revFkAccJournalReversal?: { id: string; journalNumber: string } | null;
  lines: { id: string; accountId: string; accountCodeSnapshot: string; accountNameSnapshot: string; debit: string; credit: string }[];
};
type ClaimedLine = { id: string; journalId: string; journal: Omit<AssetJournal, 'lines'>; debit: string; credit: string; accountId: string };
export type SourceLine = ClaimedLine & { journal: AssetJournal };
type Estimate = { residualValue: string; remainingLifeMonths: number };
export type ChangeInput = { effectiveDate: string; reason: string } & (
  | ({ action: 'ESTIMATE' } & Estimate)
  | ({ action: 'ADDITIONAL'; sourceJournalLineId: string } & Estimate)
  | { action: 'CORRECTION'; assetName?: string; description?: string | null; location?: string | null; custodianId?: string | null; acquiredOn?: string }
  | { action: 'RECLASSIFY'; categoryId: string }
  | ({ action: 'IMPAIRMENT'; recoverableAmount: string; assessmentEvidence: string } & Estimate)
  | { action: 'DISPOSE'; proceeds: string; considerationJournalLineId: string | null; costJournalLineId: string | null }
  | { action: 'WRITE_OFF' | 'DEACTIVATE' }
);
export type ChangeCommand = ChangeInput | { action: 'IMPAIRMENT_REVERSAL'; effectiveDate: string; reason: string; assessmentEvidence: string };
export type ChangeDraft = DraftSource & {
  accountingDate: string; draftNumber: string; sourceKind: 'ASSET_CHANGE' | 'ASSET_JOURNAL'; fixedAssetId: string;
  assetMetadata: ChangeCommand; postedJournalId: string | null; assetSourceLineId: string | null; assetCostLineId: string | null;
};
export type ChangeResult = ChangeDraft & { policyStatus: string; policyReason?: string };
export type AssetRecord = AssetRow & {
  relFkAccFixedAssetCat: Category; relFkAccFixedAssetSource: SourceLine; relFkAccFixedAssetDisposal: AssetJournal | null;
  changes: (ChangeDraft & { postedJournal: AssetJournal | null; assetSourceLine: ClaimedLine | null; assetCostLine: ClaimedLine | null })[];
  revFkAccDepRunAssetAsset: (RunLine & {
    relFkAccDepRunAssetRun: RunRow & { relFkAccDepRunJournal: AssetJournal | null; relFkAccDepRunPeriod: Period };
    relFkAccDepRunAssetAccum: { credit: string; debit: string } | null;
  })[];
};
export type AssetDetail = AssetRecord & {
  grossCost: string; accumulatedDepreciation: string; impairment: string; carryingAmount: string;
  depreciationState: string; policyStatus: string; approvalHistory: RetainedApproval[]; relatedLimit: number;
  payments: { id: string; allocatedAmount: string; relFkAccAllocationSettlement: { id: string; settlementReference: string; status: string; postingJournalId: string | null } }[];
};
export type ChangeDetail = { draft: ChangeDraft; command: ChangeCommand; asset: AssetRecord };
export type Period = AccountingFiscalYear['revFkAccPeriodFy'][number];
export type RunInput = { runReference: string; accountingPeriodId: string; assetIds: string[] };
export type AssetSnapshot = {
  id: string; revision: string; status: string; code: string; name: string; category: string;
  source: string; acquired: string; available: string; start: string; life: string; residual: string;
  cost: string; accumulated: string; impairment: string; policy: AssetRow['policySnapshot'];
};
export type DepreciationSnapshot = { asset: AssetSnapshot; periodStart: string; periodEnd: string; prospectiveBasis: string; expectedBefore: string; amount: string };
export type RunPreview = { period: Period; rows: { assetId: string; amount: string; snapshot: DepreciationSnapshot }[]; postingAutomatic: false };
export type RunRow = DraftSource & { runReference: string; accountingPeriodId: string; runDate: string; postingJournalId: string | null };
export type RunLine = {
  id: string; fixedAssetId: string; plannedAmount: string; activePeriodId: string | null; assetSnapshot: DepreciationSnapshot;
  expenseJournalLineId: string | null; accumulatedJournalLineId: string | null;
};
export type RunDetail = RunRow & { relFkAccDepRunPeriod: Period; relFkAccDepRunJournal: AssetJournal | null; revFkAccDepRunAssetRun: RunLine[] };
export type AssetReconciliation = {
  reconciled: boolean; basis: string;
  rows: { role: string; accountId: string; register: string; generalLedger: string; variance: string; reconciled: boolean }[];
};
export type ApprovalAction = Pick<ApprovalDetail, 'id' | 'status' | 'sourceVersion' | 'sourceDocumentId'>;
export type SourcePath = 'assets' | 'depreciation-runs' | 'asset-changes';
