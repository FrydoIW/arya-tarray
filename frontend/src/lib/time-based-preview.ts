function cents(value: string) {
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
}

export type TimeBasedPaymentPreview = { eventCodeId: string | null; historical: boolean; allocated: boolean;
  unitAmount: string; durationMonths: number; grantedUnits: number; grantedMonths: number;
  principalAmount: string; paymentOnlyRemainder: string; paymentCredited: string | null };

export function compatibleHistoricalTimePreview(preview: TimeBasedPaymentPreview | null | undefined, eventCodeId: string | null, principal: string | null) {
  return preview?.historical && preview.eventCodeId === eventCodeId && principal !== null
    && cents(preview.principalAmount) === cents(principal) ? preview : null;
}

export function paymentOnlyTimePreview(amount: string, unitAmount: string, durationMonths: number) {
  const payment = cents(amount);
  const unit = cents(unitAmount);
  if (payment === null || unit === null || payment <= BigInt(0) || unit <= BigInt(0) || !Number.isInteger(durationMonths) || durationMonths <= 0) return null;
  const units = payment / unit;
  const remainder = payment % unit;
  if (units > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / durationMonths))) return null;
  return { months: Number(units) * durationMonths,
    remainder: `${remainder / BigInt(100)}.${String(remainder % BigInt(100)).padStart(2, "0")}` };
}
