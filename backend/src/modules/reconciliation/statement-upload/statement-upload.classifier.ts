import {
  isEligibleIncomingTransaction,
  type ClassificationSource
} from "../reconciliation-classification.js";

export type ActiveEventCode = {
  id: string;
  code: string;
};

export function suffixCodeFromCents(amountCents: bigint) {
  const absoluteRupiah = (amountCents < 0n ? -amountCents : amountCents) / 100n;
  return (absoluteRupiah % 1000n).toString().padStart(3, "0");
}

export function centsToDecimalString(cents: bigint) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

export function classifyParsedTransaction(
  source: ClassificationSource,
  eventCodeByCode: ReadonlyMap<string, ActiveEventCode>
) {
  if (!isEligibleIncomingTransaction(source)) {
    return {
      requiresClassification: false,
      suffixCode: null,
      suggestedEventCodeId: null,
      eventCodeId: null,
      baseAmount: centsToDecimalString(source.amountCents)
    };
  }

  const suffixCode = suffixCodeFromCents(source.amountCents);
  const matched = eventCodeByCode.get(suffixCode) ?? null;

  return {
    requiresClassification: true,
    suffixCode,
    suggestedEventCodeId: matched?.id ?? null,
    eventCodeId: matched?.id ?? null,
    baseAmount: matched
      ? centsToDecimalString(source.amountCents - BigInt(suffixCode) * 100n)
      : centsToDecimalString(source.amountCents)
  };
}
