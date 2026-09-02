import { currentBusinessMonthValue } from "@/lib/business-time";
import { formatMoney } from "@/lib/format";

export const currentMonthValue = currentBusinessMonthValue;

export function changeDetail(changePercent: number | null | undefined) {
  if (changePercent === undefined) return "loading comparison…";
  if (changePercent === null) return "new vs last month";
  if (changePercent === 0) return "no change vs last month";
  const direction = changePercent > 0 ? "↑" : "↓";
  return `${direction} ${Math.abs(changePercent).toLocaleString("en-US", { maximumFractionDigits: 1 })}% vs last month`;
}

export function compactMoney(value: string | number) {
  const amount = Math.abs(Number(value || 0));
  if (amount >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}B`;
  if (amount >= 1_000_000) return `Rp ${(amount / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (amount >= 1_000) return `Rp ${(amount / 1_000).toLocaleString("en-US", { maximumFractionDigits: 0 })}K`;
  return formatMoney(amount);
}
