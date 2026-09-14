import { HttpError } from "../../lib/http.js";

export type TimeRule = { unitAmount: { toString(): string }; durationMonths: number; activeFlag: boolean };

function cents(value: { toString(): string } | null | undefined) {
  const raw = value?.toString() ?? "0";
  const [whole = "0", fraction = ""] = raw.replace(/^-/, "").split(".");
  return BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function timeBasedPrincipalAmount(transaction: { baseAmount: { toString(): string } | null; originalAmount: { toString(): string } }) {
  // The suffix-classified base amount is the only TIME_BASED entitlement principal.
  if (!transaction.baseAmount) throw new HttpError(400, "TIME_BASED base amount is required.");
  return transaction.baseAmount;
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
