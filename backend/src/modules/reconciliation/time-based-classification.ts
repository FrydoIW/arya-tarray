import { HttpError } from "../../lib/http.js";

export type TimeRule = { unitAmount: { toString(): string }; durationMonths: number; activeFlag: boolean };

type ChildTimeRule = {
  eventCodeId: string; activeFlag: boolean; capacity: number | null;
  unitAmount: { toString(): string } | null; durationMonths: number | null;
};

export function selectTimeBasedClassificationRule(
  event: { id: string; eventType: string; timeRule: TimeRule | null } | null,
  child: ChildTimeRule | null
) {
  if (event?.eventType !== "TIME_BASED" || !child) return event?.timeRule ?? null;
  if (child.eventCodeId !== event.id || !child.activeFlag || !child.capacity ||
    !child.unitAmount || !child.durationMonths || String(child.unitAmount).startsWith("-") || cents(child.unitAmount) === 0n) {
    throw new HttpError(400, "The selected TIME_BASED Child must belong to the event, be active, and have valid capacity, amount, and duration.");
  }
  return { unitAmount: child.unitAmount, durationMonths: child.durationMonths, activeFlag: true };
}

function cents(value: { toString(): string } | null | undefined) {
  const raw = value?.toString() ?? "0";
  const [whole = "0", fraction = ""] = raw.replace(/^-/, "").split(".");
  return BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function timeBasedPrincipalAmount(transaction: { baseAmount: { toString(): string } | null; originalAmount: { toString(): string } }) {
  // A suffix may assist classification, but it never reduces donor funds or
  // entitlement principal. TIME_BASED rights are based on the bank amount.
  return transaction.originalAmount;
}

export function resolveTimeBasedUnits(input: {
  eventCode: { eventType: string } | null;
  rule: TimeRule | null;
  transaction: { baseAmount: { toString(): string } | null; originalAmount: { toString(): string } };
  requiresClassification: boolean;
}) {
  if (!input.requiresClassification || input.eventCode?.eventType !== "TIME_BASED") return null;
  if (!input.rule || !input.rule.activeFlag) throw new HttpError(400, "An active Time Rule is required for a TIME_BASED Final Event");
  const unit = cents(input.rule.unitAmount);
  const amount = cents(timeBasedPrincipalAmount(input.transaction));
  if (unit <= 0n || input.rule.durationMonths <= 0) throw new HttpError(400, "The Time Rule is invalid");
  if (amount <= 0n) throw new HttpError(400, "TIME_BASED principal amount must be positive.");
  const units = amount / unit;
  if (units > BigInt(2_147_483_647)) throw new HttpError(400, "TIME_BASED amount resolves to an invalid number of units");
  return { grantedUnits: Number(units), unitAmount: input.rule.unitAmount.toString(), durationMonths: input.rule.durationMonths, amountApplied: timeBasedPrincipalAmount(input.transaction).toString() };
}
