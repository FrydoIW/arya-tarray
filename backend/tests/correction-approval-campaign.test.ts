import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HttpError } from "../src/lib/http.js";
import {
  STALE_CAMPAIGN_PROPOSAL_MESSAGE,
  assertCorrectionApprovalCampaignValid,
  assertCorrectionCampaignStillValid,
  correctionItemRequiresClassification,
  type CorrectionApprovalItem,
  type PersistedCampaign,
  type PersistedEventCode
} from "../src/modules/reconciliation/correction-approval-campaign.js";

/**
 * Behavioural coverage for approval-time Campaign revalidation.
 *
 * A correction proposal is only staged intent. These tests exercise the
 * revalidation that runs inside the approval transaction with the CURRENTLY
 * persisted Event Code / Campaign state, and prove that a proposal which became
 * stale after Execute is refused before any official mutation.
 */

const campaignEvent: PersistedEventCode = { id: "event-campaign", eventType: "CAMPAIGN", activeFlag: true };
const standardEvent: PersistedEventCode = { id: "event-standard", eventType: "STANDARD", activeFlag: true };
const timeBasedEvent: PersistedEventCode = { id: "event-time-based", eventType: "TIME_BASED", activeFlag: true };

/** 01 Oct 2026 → 31 Oct 2026, the period in force when the proposal was created. */
const octoberCampaign: PersistedCampaign = {
  id: "campaign-october",
  eventCodeId: campaignEvent.id,
  activeFlag: true,
  startDate: new Date("2026-10-01T00:00:00.000Z"),
  endDate: new Date("2026-10-31T00:00:00.000Z")
};

/** 20 Oct 2026 → 31 Oct 2026, the period after an operator narrows the Campaign. */
const narrowedOctoberCampaign: PersistedCampaign = {
  ...octoberCampaign,
  startDate: new Date("2026-10-20T00:00:00.000Z")
};

const transactionDate = new Date("2026-10-15T00:00:00.000Z");

function bankTransaction(overrides: Partial<NonNullable<CorrectionApprovalItem["bankTransaction"]>> = {}) {
  return {
    id: "transaction-1",
    eventCodeId: null,
    eventCampaignId: null,
    remark: null,
    reconciliationExcludedAt: null,
    transactionDate,
    transactionType: "CR",
    originalAmount: "1500000.00",
    ...overrides
  };
}

/** A valid MODIFIED proposal that assigns the transaction to the October Campaign. */
function modifiedItem(overrides: Partial<CorrectionApprovalItem> = {}): CorrectionApprovalItem {
  return {
    action: "MODIFIED",
    beforeEventCodeId: null,
    beforeEventCampaignId: null,
    proposedEventCodeId: campaignEvent.id,
    proposedEventCampaignId: octoberCampaign.id,
    manualTransactionType: null,
    manualTransactionDate: null,
    bankTransaction: bankTransaction(),
    ...overrides
  };
}

/** A valid ADDED manual adjustment classified into the October Campaign. */
function addedItem(overrides: Partial<CorrectionApprovalItem> = {}): CorrectionApprovalItem {
  return {
    action: "ADDED",
    beforeEventCodeId: null,
    beforeEventCampaignId: null,
    proposedEventCodeId: campaignEvent.id,
    proposedEventCampaignId: octoberCampaign.id,
    manualTransactionType: "CR",
    manualTransactionDate: transactionDate,
    bankTransaction: null,
    ...overrides
  };
}

function eventCodeMap(...events: PersistedEventCode[]) {
  return new Map(events.map((event) => [event.id, event]));
}

function campaignMap(...campaigns: PersistedCampaign[]) {
  return new Map(campaigns.map((campaign) => [campaign.id, campaign]));
}

/** Minimal in-transaction client double: only the two reads the guard performs. */
function clientWith(events: PersistedEventCode[], campaigns: PersistedCampaign[]) {
  return {
    eventCode: { findMany: async () => events },
    eventCampaign: { findMany: async () => campaigns }
  } as unknown as Parameters<typeof assertCorrectionApprovalCampaignValid>[0];
}

function staleError(error: unknown) {
  assert.ok(error instanceof HttpError, `expected HttpError, received ${String(error)}`);
  assert.equal(error.status, 409);
  assert.ok(
    error.message.startsWith(STALE_CAMPAIGN_PROPOSAL_MESSAGE),
    `expected stale-proposal prefix, received: ${error.message}`
  );
  return error.message;
}

test("approval revalidation refuses a Campaign whose period was narrowed after the proposal", async () => {
  // The proposal was legal on 15 Oct 2026 under 01 Oct → 31 Oct.
  assert.doesNotThrow(() => assertCorrectionCampaignStillValid({
    item: modifiedItem(),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: campaignMap(octoberCampaign),
    transactionDate,
    requiresClassification: true
  }));

  // The operator then narrows the Campaign to 20 Oct → 31 Oct before approval.
  const current = campaignMap(narrowedOctoberCampaign);
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem(),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: current,
    transactionDate,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("Campaign is not valid on the transaction date"));

  await assert.rejects(
    () => assertCorrectionApprovalCampaignValid(clientWith([campaignEvent], [narrowedOctoberCampaign]), [modifiedItem()]),
    (error: unknown) => staleError(error).includes("Campaign is not valid on the transaction date")
  );
});

test("approval revalidation accepts a correction while the Campaign still covers the transaction date", async () => {
  assert.doesNotThrow(() => assertCorrectionCampaignStillValid({
    item: modifiedItem(),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: campaignMap(octoberCampaign),
    transactionDate,
    requiresClassification: true
  }));

  // The guard must load the proposal's classification and resolve without error.
  await assert.doesNotReject(
    () => assertCorrectionApprovalCampaignValid(clientWith([campaignEvent], [octoberCampaign]), [modifiedItem()])
  );

  // Boundary days of the persisted period stay legal.
  for (const boundary of ["2026-10-01T00:00:00.000Z", "2026-10-31T00:00:00.000Z"]) {
    assert.doesNotThrow(() => assertCorrectionCampaignStillValid({
      item: modifiedItem(),
      eventCodeById: eventCodeMap(campaignEvent),
      campaignById: campaignMap(octoberCampaign),
      transactionDate: new Date(boundary),
      requiresClassification: true
    }));
  }

  // A purely additive manual adjustment is revalidated on its own date.
  await assert.doesNotReject(
    () => assertCorrectionApprovalCampaignValid(clientWith([campaignEvent], [octoberCampaign]), [addedItem()])
  );
});

test("approval revalidation refuses a Campaign that no longer belongs to the proposed Event Code", async () => {
  // Campaign reassigned to a different parent Event Code after the proposal.
  const foreignCampaign: PersistedCampaign = { ...octoberCampaign, id: "campaign-foreign", eventCodeId: "event-other" };
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem({ proposedEventCampaignId: foreignCampaign.id }),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: campaignMap(foreignCampaign),
    transactionDate,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("Campaign does not belong to the selected Event Code"));

  await assert.rejects(
    () => assertCorrectionApprovalCampaignValid(clientWith([campaignEvent], [foreignCampaign]), [modifiedItem({ proposedEventCampaignId: foreignCampaign.id })]),
    (error: unknown) => staleError(error).includes("Campaign does not belong to the selected Event Code")
  );

  // The proposed Campaign row still exists but the proposed CAMPAIGN Event Code
  // does not: the classification can no longer be made official.
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem(),
    eventCodeById: eventCodeMap(),
    campaignById: campaignMap(octoberCampaign),
    transactionDate,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("proposed Final Event no longer exists"));

  // A CAMPAIGN Event Code must not be approved without its Campaign.
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem({ proposedEventCampaignId: null }),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: campaignMap(octoberCampaign),
    transactionDate,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("Campaign is required for a CAMPAIGN Final Event"));
});

test("approval revalidation refuses a Campaign or Event Code that became unusable", async () => {
  // Campaign deactivated after the proposal.
  const deactivatedCampaign: PersistedCampaign = { ...octoberCampaign, activeFlag: false };
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem(),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: campaignMap(deactivatedCampaign),
    transactionDate,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("The selected Campaign is inactive"));

  await assert.rejects(
    () => assertCorrectionApprovalCampaignValid(clientWith([campaignEvent], [deactivatedCampaign]), [modifiedItem()]),
    (error: unknown) => staleError(error).includes("The selected Campaign is inactive")
  );

  // Campaign row removed after the proposal.
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem(),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: campaignMap(),
    transactionDate,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("proposed Campaign no longer exists"));

  await assert.rejects(
    () => assertCorrectionApprovalCampaignValid(clientWith([campaignEvent], []), [modifiedItem()]),
    (error: unknown) => staleError(error).includes("proposed Campaign no longer exists")
  );

  // Event Code reconfigured away from CAMPAIGN after the proposal: the row still
  // exists but is no longer a Campaign Event Code, so the Campaign link is illegal.
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem({ proposedEventCodeId: standardEvent.id }),
    eventCodeById: eventCodeMap(standardEvent),
    campaignById: campaignMap(octoberCampaign),
    transactionDate,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("Only CAMPAIGN Event Codes may have a Campaign"));

  // The transaction carries no date, so Campaign eligibility is unprovable.
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem({ bankTransaction: bankTransaction({ transactionDate: null }) }),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: campaignMap(octoberCampaign),
    transactionDate: null,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("Transaction date is required to select a Campaign"));

  // The canonical exemption still protects an already official assignment.
  assert.doesNotThrow(() => assertCorrectionCampaignStillValid({
    item: modifiedItem({
      beforeEventCodeId: campaignEvent.id,
      beforeEventCampaignId: deactivatedCampaign.id,
      bankTransaction: bankTransaction({ eventCodeId: campaignEvent.id, eventCampaignId: deactivatedCampaign.id })
    }),
    eventCodeById: eventCodeMap(campaignEvent),
    campaignById: campaignMap(deactivatedCampaign),
    transactionDate,
    requiresClassification: true
  }));
});

test("approval-time revalidation runs inside the decision transaction before any official mutation", () => {
  const approvalRepository = readFileSync(new URL("../src/modules/approval/sign-approval/sign-approval.repository.ts", import.meta.url), "utf8");

  // The guard is invoked inside the APPROVED branch of decideSignApprovalAtomic.
  assert.match(approvalRepository, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(approvalRepository, /if \(input\.decision === "APPROVED"\) \{\s*(?:\/\/[^\n]*\n\s*)*await assertCorrectionApprovalCampaignValid\(tx, correctionProposal\.items\);/);

  // No BankTransaction write may be reachable before the revalidation call.
  const upToGuard = approvalRepository.slice(0, approvalRepository.indexOf("await assertCorrectionApprovalCampaignValid"));
  assert.doesNotMatch(upToGuard, /tx\.bankTransaction\.update\(/);
  assert.doesNotMatch(upToGuard, /tx\.bankTransaction\.create\(/);
  assert.doesNotMatch(upToGuard, /tx\.bankTransaction\.updateMany\(/);

  // The decision transaction stays Serializable so the guard reads stable state.
  assert.match(approvalRepository, /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);

  // Revalidation reuses the canonical Campaign rules rather than a second rule set.
  const guard = readFileSync(new URL("../src/modules/reconciliation/correction-approval-campaign.ts", import.meta.url), "utf8");
  assert.match(guard, /import \{ assertCampaignClassification \} from "\.\/campaign-classification\.js";/);
  assert.match(guard, /assertCampaignClassification\(\{/);
  assert.doesNotMatch(guard, /^function assert/m);

  // The canonical validator itself is unchanged and still the single rule set.
  const canonical = readFileSync(new URL("../src/modules/reconciliation/campaign-classification.ts", import.meta.url), "utf8");
  assert.match(canonical, /export function assertCampaignClassification\(/);
  assert.doesNotMatch(canonical, /correction/);
});

test("STANDARD corrections keep their existing behaviour and need no Campaign revalidation", async () => {
  const standardItem = modifiedItem({
    proposedEventCodeId: standardEvent.id,
    proposedEventCampaignId: null
  });

  assert.doesNotThrow(() => assertCorrectionCampaignStillValid({
    item: standardItem,
    eventCodeById: eventCodeMap(standardEvent),
    campaignById: campaignMap(),
    transactionDate,
    requiresClassification: true
  }));

  // A STANDARD proposal that still carries a Campaign is refused rather than
  // silently downgraded or silently reassigned.
  assert.throws(() => assertCorrectionCampaignStillValid({
    item: modifiedItem({ proposedEventCodeId: standardEvent.id }),
    eventCodeById: eventCodeMap(standardEvent),
    campaignById: campaignMap(octoberCampaign),
    transactionDate,
    requiresClassification: true
  }), (error: unknown) => staleError(error).includes("Only CAMPAIGN Event Codes may have a Campaign"));

  // Non-classifiable transactions (debit, BUNGA, CR KOREKSI BUNGA) are exempt.
  for (const transactionType of ["DB", "BUNGA", "CR KOREKSI BUNGA"]) {
    const item = modifiedItem({
      proposedEventCodeId: null,
      proposedEventCampaignId: null,
      bankTransaction: bankTransaction({ transactionType, originalAmount: "-925000.00" })
    });
    assert.equal(correctionItemRequiresClassification(item), false, `${transactionType} must not require classification`);
    assert.doesNotThrow(() => assertCorrectionCampaignStillValid({
      item,
      eventCodeById: eventCodeMap(),
      campaignById: campaignMap(),
      transactionDate,
      requiresClassification: false
    }));
  }

  // STANDARD corrections resolve against the persisted Event Code and never
  // consult Campaign state.
  await assert.doesNotReject(
    () => assertCorrectionApprovalCampaignValid(clientWith([standardEvent], []), [standardItem])
  );
});

test("TIME_BASED corrections and carry-forward are unaffected by Campaign revalidation", async () => {
  const timeBasedItem = modifiedItem({
    proposedEventCodeId: timeBasedEvent.id,
    proposedEventCampaignId: null
  });

  assert.doesNotThrow(() => assertCorrectionCampaignStillValid({
    item: timeBasedItem,
    eventCodeById: eventCodeMap(timeBasedEvent),
    campaignById: campaignMap(),
    transactionDate,
    requiresClassification: true
  }));

  await assert.doesNotReject(
    () => assertCorrectionApprovalCampaignValid(clientWith([timeBasedEvent], []), [timeBasedItem])
  );

  // Exclusions and remark-only corrections make no classification claim.
  const excludedOnly = modifiedItem({ action: "EXCLUDED", proposedEventCodeId: null, proposedEventCampaignId: null });
  await assert.doesNotReject(
    () => assertCorrectionApprovalCampaignValid(clientWith([], []), [excludedOnly])
  );

  // An empty proposal is a no-op for this guard.
  await assert.doesNotReject(
    () => assertCorrectionApprovalCampaignValid(clientWith([], []), [])
  );

  // A classification-free correction (no Final Event proposed) is never blocked
  // by Campaign state that is no longer readable.
  await assert.doesNotReject(
    () => assertCorrectionApprovalCampaignValid(
      clientWith([], []),
      [modifiedItem({
        proposedEventCodeId: null,
        proposedEventCampaignId: null,
        bankTransaction: bankTransaction({ transactionType: "DB", originalAmount: "-925000.00" })
      })]
    )
  );
});
