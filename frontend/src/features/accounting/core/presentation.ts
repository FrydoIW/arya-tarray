// Exact integer cents are used only for input validation/presentation, never for GL balances.
export function decimalCents(value: string): bigint | null {
  if (!/^-?\d{1,24}(\.\d{1,2})?$/.test(value)) return null;
  const negative = value.startsWith('-'), [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  return negative ? -result : result;
}
export function centsDecimal(value: bigint) {
  const negative = value < BigInt(0), absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, '0')}`;
}
export function accountingMoney(value: string | null | undefined) {
  if (value === null || value === undefined) return 'Not supplied';
  const cents = decimalCents(value);
  if (cents === null) return value;
  const absolute = cents < BigInt(0) ? -cents : cents;
  return `${cents < BigInt(0) ? '-' : ''}Rp ${new Intl.NumberFormat('id-ID').format(absolute / BigInt(100))},${String(absolute % BigInt(100)).padStart(2, '0')}`;
}
export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function text(value: unknown) { return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Not supplied'; }
export const coreApprovalKind = (kind: string) => ['MANUAL_JOURNAL', 'ADJUSTING_JOURNAL', 'JOURNAL_REVERSAL'].includes(kind);
