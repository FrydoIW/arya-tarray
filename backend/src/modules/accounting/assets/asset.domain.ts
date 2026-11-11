import { HttpError } from "../../../lib/http.js";
import { centsToDecimal } from "../../../lib/money.js";
import { accountingCents } from "../accounting.domain.js";
import { day, dateText } from "../schedules/schedule.domain.js";
import type { AssetPolicy } from "./asset.schema.js";
export function monthStart(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)); }
export function addMonths(date: Date, count: number) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + count;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), last)));
}
export function depreciationStart(inServiceOn: Date, policy: AssetPolicy["partialMonthPolicy"]) {
  return policy === "ACTUAL_DAYS" ? inServiceOn : addMonths(monthStart(inServiceOn), policy === "NEXT_MONTH" ? 1 : 0);
}
export function straightLinePortion(basis: bigint, start: Date, months: number, policy: AssetPolicy["partialMonthPolicy"], from: Date, to: Date) {
  if (basis < 0n || months < 1 || months > 600 || from > to) throw new HttpError(400, "Invalid depreciation basis/life/period.");
  const end = addMonths(start, months), clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  let denominator: bigint, before: bigint, through: bigint;
  if (policy === "ACTUAL_DAYS") {
    const days = (end.getTime() - start.getTime()) / 86400000;
    denominator = BigInt(days); before = BigInt(clamp((from.getTime() - start.getTime()) / 86400000, days));
    through = BigInt(clamp((to.getTime() + 86400000 - start.getTime()) / 86400000, days));
  } else {
    if (dateText(from).slice(8) !== "01" || dateText(new Date(to.getTime() + 86400000)).slice(8) !== "01" || from.getUTCMonth() !== to.getUTCMonth() || from.getUTCFullYear() !== to.getUTCFullYear()) throw new HttpError(409, "Monthly depreciation requires complete configured calendar-month periods.");
    const distance = (d: Date) => (d.getUTCFullYear() - start.getUTCFullYear()) * 12 + d.getUTCMonth() - start.getUTCMonth();
    denominator = BigInt(months); before = BigInt(clamp(distance(from), months)); through = BigInt(clamp(distance(addMonths(from, 1)), months));
  }
  const expectedBefore = basis * before / denominator, expectedThrough = basis * through / denominator;
  return { expectedBefore, amount: expectedThrough - expectedBefore, fullyDepreciated: through === denominator };
}
export function disposalAmounts(cost: string, accumulated: string, impairment: string, proceeds: string, disposalCosts: string) {
  const carrying = accountingCents(cost) - accountingCents(accumulated) - accountingCents(impairment);
  const gain = accountingCents(proceeds) - accountingCents(disposalCosts) - carrying;
  if (carrying < 0n) throw new HttpError(409, "Asset carrying amount is invalid.");
  return { carrying: centsToDecimal(carrying), gain: centsToDecimal(gain > 0n ? gain : 0n), loss: centsToDecimal(gain < 0n ? -gain : 0n) };
}
export { day, dateText };
