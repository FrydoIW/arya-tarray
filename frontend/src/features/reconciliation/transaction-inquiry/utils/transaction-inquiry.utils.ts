import { BUSINESS_TIME_ZONE, currentBusinessDayValue, currentBusinessMonthValue } from "@/lib/business-time";
import type { TransactionInquiryPeriodMode } from "../types";

export const getCurrentMonthValue = currentBusinessMonthValue;
export const getCurrentDayValue = currentBusinessDayValue;

export function formatMonthLabel(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

export function formatDayLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: BUSINESS_TIME_ZONE })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

export function formatPeriodLabel(mode: TransactionInquiryPeriodMode, month: string, date: string) {
  return mode === "DAY" ? formatDayLabel(date) : formatMonthLabel(month);
}

export function periodContext(mode: TransactionInquiryPeriodMode, month: string, date: string) {
  return `${mode === "DAY" ? "on" : "in"} ${formatPeriodLabel(mode, month, date)}`;
}

export function getLifecycleLabel(status: string) {
  if (status === "RAW") return "Draft";
  if (status === "CHECK") return "Pending Approval";
  if (status === "FINALIZED") return "Complete";
  return status;
}

export function eventLabel(event: { code: string; eventName: string } | null) {
  return event ? `${event.code} - ${event.eventName}` : "Not Applicable";
}
