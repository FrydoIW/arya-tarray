export type LedgerEntryType = "PAYMENT" | "COVERAGE_USE" | "TRANSFER_IN" | "TRANSFER_OUT";

const LEDGER_LABELS: Record<string, string> = {
  PAYMENT: "Payment",
  COVERAGE_USE: "Coverage Use",
  TRANSFER_IN: "Transfer In",
  TRANSFER_OUT: "Transfer Out"
};

/** Unknown future entry types must never be rendered as Coverage Use. */
export function ledgerEntryLabel(type: string) {
  const known = LEDGER_LABELS[type];
  if (known) return known;
  return type ? `Other · ${type}` : "Other ledger entry";
}

export function ledgerEntryKind(type: string): "CREDIT" | "DEBIT" | "OTHER" {
  if (type === "PAYMENT" || type === "TRANSFER_IN") return "CREDIT";
  if (type === "COVERAGE_USE" || type === "TRANSFER_OUT") return "DEBIT";
  return "OTHER";
}

const MONEY_PATTERN = /^(-?)(\d{1,18})(?:\.(\d{1,2}))?$/;

export function moneyToCents(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const match = MONEY_PATTERN.exec(value.trim());
  if (!match) return null;
  const cents = BigInt(match[2]) * BigInt(100) + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
}

export function centsToMoney(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}

export type TransferEstimate = { units: number; months: number; amountApplied: string; remainingCarry: string };

/** Frontend estimate only. The backend response is authoritative. */
export function transferEstimate(input: { amount: string; destinationCarry: string; unitAmount: string; durationMonths: number }): TransferEstimate | null {
  const amount = moneyToCents(input.amount);
  const carry = moneyToCents(input.destinationCarry);
  const unit = moneyToCents(input.unitAmount);
  if (amount === null || carry === null || unit === null) return null;
  if (amount <= BigInt(0) || carry < BigInt(0) || unit <= BigInt(0)) return null;
  if (!Number.isInteger(input.durationMonths) || input.durationMonths <= 0) return null;
  const available = carry + amount;
  const units = available / unit;
  if (units > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / input.durationMonths))) return null;
  const applied = units * unit;
  return { units: Number(units), months: Number(units) * input.durationMonths,
    amountApplied: centsToMoney(applied), remainingCarry: centsToMoney(available - applied) };
}

export function validateTransferAmount(amount: string, carry: string): string | null {
  const cents = moneyToCents(amount);
  if (cents === null || cents <= BigInt(0)) return "Masukkan nominal transfer yang valid.";
  const available = moneyToCents(carry);
  if (available === null) return "Carry sumber tidak dapat dibaca.";
  if (cents > available) return "Nominal transfer melebihi carry yang tersedia.";
  return null;
}

type DestinationCandidate = {
  subscriptionId: string; activeFlag: boolean;
  timeRule: { unitAmount: string; durationMonths: number } | null;
  event?: { eventType?: string } | null;
  eventActiveFlag?: boolean;
};

/** Same-Member data only. Source, non-TIME_BASED, inactive programs, inactive Events, and missing rules are excluded. */
export function transferDestinationCandidates<T extends DestinationCandidate>(subscriptions: T[], sourceSubscriptionId: string) {
  return subscriptions.filter(subscription => subscription.subscriptionId !== sourceSubscriptionId
    && subscription.activeFlag
    && subscription.eventActiveFlag !== false
    && subscription.event?.eventType === "TIME_BASED"
    && Boolean(subscription.timeRule));
}

/**
 * Voluntary wallet transfers into TIME BASED must form at least one unit at the
 * destination. Returns the remaining top-up needed, or null when satisfied.
 */
export function destinationUnitRequirement(amount: string, destinationCarry: string, unitAmount: string): string | null {
  const transfer = moneyToCents(amount);
  const carry = moneyToCents(destinationCarry);
  const unit = moneyToCents(unitAmount);
  if (transfer === null || carry === null || unit === null || unit <= BigInt(0)) return null;
  const available = carry + transfer;
  return available >= unit ? null : centsToMoney(unit - available);
}

export function canOfferTransfer(input: { canMutate: boolean; memberActive: boolean; activeFlag: boolean; carry: string; destinationCount: number }) {
  if (!input.canMutate || !input.memberActive || !input.activeFlag) return false;
  if (input.destinationCount < 1) return false;
  const carry = moneyToCents(input.carry);
  return carry !== null && carry > BigInt(0);
}

/** Campaign wallet sources have no lifecycle flag of their own; the donor must be mutable and the wallet positive. */
export function canOfferCampaignTransfer(input: { canMutate: boolean; memberActive: boolean; carry: string; destinationCount: number }) {
  return canOfferTransfer({ ...input, activeFlag: true });
}

/** Domain hint for unwind-first conflicts. Backend message stays the primary signal. */
export function dependencyConflictHint(message: string) {
  return /depend|unwind|active Carry Transfer/i.test(message)
    ? "Transfer ini belum dapat dibalik karena saldo sudah digunakan atau dialihkan ke program berikutnya. Balikkan alokasi/transfer lanjutan terlebih dahulu."
    : null;
}

export function coverageSourceLabel(source: string) {
  if (source === "OPENING") return "Opening coverage";
  if (source === "TRANSFER") return "Carry transfer allocation";
  return "Payment coverage";
}

export function subscriptionLabel(item: { referenceNo: string | null; displayName: string | null; subscriptionId: string }) {
  return item.referenceNo || item.displayName || item.subscriptionId;
}

/** One key per user command; callers must generate a new key when the payload changes. */
export function createIdempotencyKey() {
  const cryptoApi = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
