export type BankDirection = "CR" | "DB";

export type ClassificationSource = {
  direction: BankDirection | null;
  transactionType: string | null;
  amountCents: bigint;
};

const NON_CLASSIFICATION_CREDIT_TYPES = new Set([
  "BUNGA",
  "CR KOREKSI BUNGA"
]);

function normalizeType(value: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function isEligibleIncomingTransaction(source: ClassificationSource) {
  if (source.direction !== "CR" || source.amountCents <= 0n) return false;
  if (source.amountCents % 100n !== 0n) return false;
  return !NON_CLASSIFICATION_CREDIT_TYPES.has(normalizeType(source.transactionType));
}

export function directionFromStoredTransactionType(transactionType: string | null): BankDirection | null {
  const normalized = normalizeType(transactionType);
  if (/\bCR$/.test(normalized) || normalized === "KR OTOMATIS" || normalized === "SETORAN TUNAI" || normalized === "BUNGA" || normalized === "CR KOREKSI BUNGA") {
    return "CR";
  }
  if (/\bDB$/.test(normalized) || normalized === "BIAYA ADM" || normalized === "PAJAK BUNGA" || normalized === "TARIKAN TUNAI" || normalized === "BYR VIA E-BANKING" || normalized === "BA JASA E-BANKING") {
    return "DB";
  }
  return null;
}

export function decimalStringToCents(value: string) {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const normalized = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = normalized.split(".");
  const cents = BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

export function storedTransactionRequiresClassification(input: {
  transactionType: string | null;
  originalAmount: { toString(): string };
}) {
  const amountCents = decimalStringToCents(input.originalAmount.toString());
  const direction = directionFromStoredTransactionType(input.transactionType)
    ?? (amountCents < 0n ? "DB" : "CR");
  return isEligibleIncomingTransaction({
    direction,
    transactionType: input.transactionType,
    amountCents
  });
}
