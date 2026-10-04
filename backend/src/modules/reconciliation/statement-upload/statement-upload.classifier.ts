import { centsToDecimal as centsToDecimalString } from "../../../lib/money.js";
import {
  isEligibleIncomingTransaction,
  type ClassificationSource
} from "../reconciliation-classification.js";

export { centsToDecimalString };

export type ActiveEventCode = {
  id: string;
  code: string;
};

export function suffixCodeFromCents(amountCents: bigint) {
  const absoluteRupiah = (amountCents < 0n ? -amountCents : amountCents) / 100n;
  return (absoluteRupiah % 1000n).toString().padStart(3, "0");
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
