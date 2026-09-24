import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { campaignBackfillVerdict, reconcileCampaignContribution } from "../src/modules/member/campaign/member-campaign-wallet.service.js";

const usage = `Deterministic Campaign evidence reconciliation

Usage: npm run campaign:backfill -- [--dry-run] [--apply]

--dry-run (default) only reports legacy finalized Campaign contributions without
           direct allocation evidence and whether their target can absorb them.
--apply   materialises evidence for SAFE campaigns only, transaction by transaction,
           in deterministic (transactionDate, id) order inside one serializable
           transaction per campaign. Unsafe campaigns are reported for manual review.

Legacy transactions are currently counted as fully applied. A campaign is SAFE only
when it is unlimited or when the whole legacy total fits the remaining target, so no
overflow is ever fabricated.`;

function parseOptions(args: string[]) {
  let apply = false;
  for (const arg of args) {
    if (arg === "--dry-run") apply = false;
    else if (arg === "--apply") apply = true;
    else if (arg === "--help") return { help: true, apply: false };
    else throw new Error(`Unknown option: ${arg}`);
  }
  return { help: false, apply };
}

const cents = (value: { toString(): string } | null | undefined) => {
  const text = value?.toString() ?? "0";
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const amount = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -amount : amount;
};
const money = (value: bigint) => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
};

async function collectPlan() {
  const campaigns = await prisma.eventCampaign.findMany({
    where: { eventCode: { eventType: "CAMPAIGN" } },
    select: { id: true, campaignName: true, targetAmount: true, eventCode: { select: { code: true, eventName: true } } },
    orderBy: { id: "asc" }
  });
  const plan = [];
  for (const campaign of campaigns) {
    const [explicit, legacy] = await Promise.all([
      prisma.memberEventCampaignAllocation.aggregate({ where: { eventCampaignId: campaign.id, allocationStatus: "ACTIVE" }, _sum: { amountDelta: true } }),
      prisma.bankTransaction.findMany({
        where: { eventCampaignId: campaign.id, status: "FINALIZED", reconciliationExcludedAt: null, originalAmount: { gt: 0 },
          memberEventCampaignAllocations: { none: {} } },
        select: { id: true, originalAmount: true, memberIdentity: { select: { memberId: true, verificationStatus: true } } },
        orderBy: [{ transactionDate: "asc" }, { id: "asc" }]
      })
    ]);
    if (!legacy.length) continue;
    const target = campaign.targetAmount ? cents(campaign.targetAmount) : null;
    const explicitApplied = cents(explicit._sum.amountDelta);
    const legacyTotal = legacy.reduce((sum, row) => sum + cents(row.originalAmount), 0n);
    const verdict = campaignBackfillVerdict({ target, explicitApplied, legacyTotal });
    plan.push({ campaign, target, explicitApplied, legacyTotal, verdict,
      unattributable: legacy.filter(row => row.memberIdentity?.verificationStatus !== "VERIFIED" || !row.memberIdentity.memberId).length,
      transactions: legacy });
  }
  return plan;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  const plan = await collectPlan();
  if (!plan.length) { console.log("No legacy Campaign contributions require reconciliation."); return; }
  let appliedCount = 0;
  let skippedCount = 0;
  for (const item of plan) {
    const label = `${item.campaign.eventCode.code} · ${item.campaign.campaignName} (${item.campaign.id})`;
    console.log(`${label}: legacy=${item.transactions.length} total=${money(item.legacyTotal)} explicit=${money(item.explicitApplied)} target=${item.target === null ? "unlimited" : money(item.target)} verdict=${item.verdict.safe ? "SAFE" : "MANUAL_REVIEW"}:${item.verdict.reason}${item.unattributable ? ` unattributable=${item.unattributable}` : ""}`);
    if (!options.apply || !item.verdict.safe) { skippedCount += item.transactions.length; continue; }
    const result = await prisma.$transaction(async tx => {
      const states: string[] = [];
      for (const transaction of item.transactions) {
        const outcome = await reconcileCampaignContribution(tx, transaction.id, "backfill", {
          reason: "Campaign evidence backfill from the legacy finished contribution"
        });
        states.push(outcome.state);
      }
      return states;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 });
    appliedCount += result.filter(state => state === "ALLOCATED").length;
    skippedCount += result.filter(state => state !== "ALLOCATED").length;
    console.log(`  applied states: ${result.join(", ")}`);
  }
  console.log(`${options.apply ? "APPLY" : "DRY-RUN"} complete: applied=${appliedCount} skipped=${skippedCount}`);
  if (!options.apply) console.log("Re-run with --apply only after reviewing every campaign above.");
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Campaign backfill failed."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
