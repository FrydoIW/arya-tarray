import { HttpError } from "../../../lib/http.js";
import { accountingTotalCents } from "../accounting.domain.js";
import { centsToDecimal } from "../../../lib/money.js";
export const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
export const dateText = (v: Date) => v.toISOString().slice(0, 10);
export const money = (v: bigint) => centsToDecimal(v);
export const cents = (v: { toString(): string }) => accountingTotalCents(v.toString());
/** A source nominal may be split; combined terms never multiply its amount. */
export function assertCapacity(original: bigint, used: bigint, proposed: bigint) {
  if (original < 0n || used < 0n || proposed <= 0n || used + proposed > original) throw new HttpError(409, "Amount exceeds the remaining source/restriction/evidence capacity.");
}
export function restrictionAmounts(original: bigint, released: bigint) {
  if (released < 0n || released > original) throw new HttpError(409, "Restriction is over-released; reconciliation required.");
  return { original: money(original), released: money(released), remaining: money(original - released) };
}
export function eligibilityDates(input: { kind: string; effectiveOn: Date | null; releaseOn: Date | null; satisfactionDate: Date; accountingDate: Date; criterion: string }) {
  if (!input.effectiveOn || input.satisfactionDate < input.effectiveOn || input.satisfactionDate > input.accountingDate) throw new HttpError(409, "Release satisfaction date is invalid.");
  if (["TIME", "BOTH"].includes(input.kind) && (!input.releaseOn || input.satisfactionDate < input.releaseOn)) throw new HttpError(409, "Time restriction has not been satisfied.");
  if (input.kind === "TIME" ? input.criterion !== "TIME_ONLY" : input.criterion === "TIME_ONLY") throw new HttpError(409, "Purpose/time evidence does not match donor terms.");
}
