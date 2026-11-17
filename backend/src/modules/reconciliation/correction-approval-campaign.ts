import type { Prisma } from "@prisma/client";
import { HttpError } from "../../lib/http.js";
import { assertCampaignClassification } from "./campaign-classification.js";
import { assertChildClassification } from "./event-child-classification.js";
import { storedTransactionRequiresClassification } from "./reconciliation-classification.js";

/**
 * Approval-time Campaign revalidation for Edit Income corrections.
 *
 * A correction proposal is only a staged intent. The Event Code or its Campaign
 * can be edited between Execute and Sign Approval, so the proposal's own
 * creation-time validation is not sufficient evidence that the classification is
 * still legal. These helpers re-check the exact values that are about to become
 * official, against the CURRENTLY persisted configuration, inside the same
 * transaction that mutates BankTransaction.
 */

/** A correction proposal item as read by the approval decision transaction. */
export type CorrectionApprovalItem = {
  action: string;
  beforeEventCodeId: string | null;
  beforeEventCodeChildId: string | null;
  beforeEventCampaignId: string | null;
  proposedEventCodeId: string | null;
  proposedEventCodeChildId: string | null;
  proposedEventCampaignId: string | null;
  manualTransactionType: string | null;
  manualTransactionDate: Date | null;
  bankTransaction: {
    id: string;
    eventCodeId: string | null;
    eventCodeChildId: string | null;
    eventCampaignId: string | null;
    remark: string | null;
    reconciliationExcludedAt: Date | null;
    transactionDate: Date | null;
    transactionType: string | null;
    originalAmount: { toString(): string };
  } | null;
};

/** Persisted Event Code projection required by the canonical Campaign rules. */
export type PersistedEventCode = {
  id: string;
  eventType: string;
  activeFlag: boolean;
};

/** Persisted Campaign projection required by the canonical Campaign rules. */
export type PersistedCampaign = {
  id: string;
  eventCodeId: string;
  activeFlag: boolean;
  startDate: Date | null;
  endDate: Date | null;
};

/** Persisted Child projection required by the canonical Child rules. */
export type PersistedEventCodeChild = {
  id: string;
  eventCodeId: string;
  childCode: string;
  childName: string;
  activeFlag: boolean;
};

export const STALE_CAMPAIGN_PROPOSAL_MESSAGE =
  "Campaign configuration changed after this correction was proposed. Refresh or recreate the correction before approval.";

export const STALE_CHILD_PROPOSAL_MESSAGE =
  "Child configuration changed after this correction was proposed. Refresh or recreate the correction before approval.";

/**
 * Loads the CURRENT persisted Event Code, Child, and Campaign state for every
 * classification a correction proposal intends to make official. Only the
 * distinct ids actually referenced by the proposal are read.
 */
export async function loadPersistedCorrectionClassification(tx: Prisma.TransactionClient, items: CorrectionApprovalItem[]) {
  const eventCodeIds = [...new Set(items.flatMap((item) =>
    item.action !== "EXCLUDED" && item.proposedEventCodeId ? [item.proposedEventCodeId] : []
  ))];
  const campaignIds = [...new Set(items.flatMap((item) =>
    item.action !== "EXCLUDED" && item.proposedEventCampaignId ? [item.proposedEventCampaignId] : []
  ))];
  const childIds = [...new Set(items.flatMap((item) =>
    item.action !== "EXCLUDED" && item.proposedEventCodeChildId ? [item.proposedEventCodeChildId] : []
  ))];

  const [eventCodes, campaigns, children] = await Promise.all([
    eventCodeIds.length
      ? tx.eventCode.findMany({
          where: { id: { in: eventCodeIds } },
          select: { id: true, eventType: true, activeFlag: true }
        })
      : Promise.resolve([] as PersistedEventCode[]),
    campaignIds.length
      ? tx.eventCampaign.findMany({
          where: { id: { in: campaignIds } },
          select: { id: true, eventCodeId: true, activeFlag: true, startDate: true, endDate: true }
        })
      : Promise.resolve([] as PersistedCampaign[]),
    childIds.length
      ? tx.eventCodeChild.findMany({
          where: { id: { in: childIds } },
          select: { id: true, eventCodeId: true, childCode: true, childName: true, activeFlag: true }
        })
      : Promise.resolve([] as PersistedEventCodeChild[])
  ]);

  return {
    eventCodeById: new Map(eventCodes.map((event) => [event.id, event])),
    campaignById: new Map(campaigns.map((campaign) => [campaign.id, campaign])),
    childById: new Map(children.map((child) => [child.id, child])),
    childrenByParentId: children.reduce((grouped, child) => {
      const group = grouped.get(child.eventCodeId) ?? [];
      group.push(child);
      grouped.set(child.eventCodeId, group);
      return grouped;
    }, new Map<string, PersistedEventCodeChild[]>())
  };
}

/**
 * True when the stored transaction is an eligible incoming credit and therefore
 * must carry a Final Event. Manual adjustments are staged as CR when incoming,
 * so they always require classification.
 */
export function correctionItemRequiresClassification(item: CorrectionApprovalItem) {
  if (item.action === "ADDED") return item.manualTransactionType === "CR";
  if (!item.bankTransaction) return false;
  return storedTransactionRequiresClassification(item.bankTransaction);
}

/**
 * Revalidates ONE proposal item against the currently persisted classification.
 * Reuses the canonical Campaign eligibility rules used by Statement Upload and
 * Edit Income proposal creation - no second rule set is introduced.
 *
 * `historicalCampaignId` keeps the canonical exemption for a Campaign that the
 * transaction is already officially linked to, mirroring the proposal-time call.
 */
export function assertCorrectionCampaignStillValid(input: {
  item: CorrectionApprovalItem;
  eventCodeById: Map<string, PersistedEventCode>;
  campaignById: Map<string, PersistedCampaign>;
  transactionDate: Date | null;
  requiresClassification: boolean;
}) {
  const { item, eventCodeById, campaignById } = input;
  const proposedEventCodeId = item.proposedEventCodeId ?? null;
  const proposedCampaignId = item.proposedEventCampaignId ?? null;

  if (proposedEventCodeId && !eventCodeById.has(proposedEventCodeId)) {
    throw new HttpError(409, `${STALE_CAMPAIGN_PROPOSAL_MESSAGE} The proposed Final Event no longer exists.`);
  }

  const eventCode = proposedEventCodeId ? eventCodeById.get(proposedEventCodeId) ?? null : null;
  if (eventCode && eventCode.eventType === "CAMPAIGN" && proposedCampaignId && !campaignById.has(proposedCampaignId)) {
    throw new HttpError(409, `${STALE_CAMPAIGN_PROPOSAL_MESSAGE} The proposed Campaign no longer exists.`);
  }

  const campaign = proposedCampaignId ? campaignById.get(proposedCampaignId) ?? null : null;

  try {
    assertCampaignClassification({
      eventCode,
      campaignId: proposedCampaignId,
      campaign,
      transactionDate: input.transactionDate,
      requiresClassification: input.requiresClassification,
      requireComplete: true,
      historicalCampaignId: item.bankTransaction?.eventCampaignId ?? null
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(409, `${STALE_CAMPAIGN_PROPOSAL_MESSAGE} ${error.message}`);
    }
    throw error;
  }
}

/**
 * Revalidates every classification a correction approval is about to apply.
 * Call this BEFORE any BankTransaction mutation so that a stale proposal aborts
 * the whole approval transaction without partial side effects.
 */
export async function assertCorrectionApprovalCampaignValid(tx: Prisma.TransactionClient, items: CorrectionApprovalItem[]) {
  const relevant = items.filter((item) => item.action === "MODIFIED" || item.action === "ADDED");
  if (relevant.length === 0) return;

  const { eventCodeById, campaignById, childById, childrenByParentId } = await loadPersistedCorrectionClassification(tx, relevant);

  for (const item of relevant) {
    const requiresClassification = correctionItemRequiresClassification(item);
    const transactionDate = item.action === "ADDED" ? item.manualTransactionDate : item.bankTransaction?.transactionDate ?? null;
    assertCorrectionCampaignStillValid({ item, eventCodeById, campaignById, transactionDate, requiresClassification });
    assertCorrectionChildStillValid({ item, eventCodeById, childById, childrenByParentId, requiresClassification });
  }
}

/**
 * Revalidates the Child portion of a proposal item against the CURRENTLY
 * persisted Child configuration. Reuses the canonical Child rules; a stale,
 * cross-parent, or newly-inactive proposed child aborts the approval with no
 * partial writes. The stored official child keeps its historical exemption.
 */
export function assertCorrectionChildStillValid(input: {
  item: CorrectionApprovalItem;
  eventCodeById: Map<string, PersistedEventCode>;
  childById: Map<string, PersistedEventCodeChild>;
  childrenByParentId: Map<string, PersistedEventCodeChild[]>;
  requiresClassification: boolean;
}) {
  const { item, eventCodeById, childById, childrenByParentId } = input;
  const proposedEventCodeId = item.proposedEventCodeId ?? null;
  const proposedChildId = item.proposedEventCodeChildId ?? null;

  const eventCode = proposedEventCodeId ? eventCodeById.get(proposedEventCodeId) ?? null : null;
  const child = proposedChildId ? childById.get(proposedChildId) ?? null : null;
  const children = proposedEventCodeId ? childrenByParentId.get(proposedEventCodeId) ?? [] : [];

  try {
    assertChildClassification({
      eventCode,
      childId: proposedChildId,
      child,
      children,
      requiresClassification: input.requiresClassification,
      requireComplete: true,
      historicalChildId: item.bankTransaction?.eventCodeChildId ?? null
    });
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(409, `${STALE_CHILD_PROPOSAL_MESSAGE} ${error.message}`);
    }
    throw error;
  }
}
