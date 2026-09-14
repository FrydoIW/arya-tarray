function cents(value: string) {
  const match = /^([0-9]+)(?:\.([0-9]{1,2}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
}

export function paymentOnlyTimePreview(amount: string, unitAmount: string, durationMonths: number) {
  const payment = cents(amount);
  const unit = cents(unitAmount);
  if (payment === null || unit === null || payment <= BigInt(0) || unit <= BigInt(0) || durationMonths <= 0) return null;
  const units = payment / unit;
  const remainder = payment % unit;
  if (units > BigInt(Number.MAX_SAFE_INTEGER / durationMonths)) return null;
  return { months: Number(units) * durationMonths,
    remainder: `${remainder / BigInt(100)}.${String(remainder % BigInt(100)).padStart(2, "0")}` };
}
