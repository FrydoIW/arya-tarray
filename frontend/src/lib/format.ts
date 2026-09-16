import { BUSINESS_TIME_ZONE } from "./business-time";

export function formatMoney(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(number);
}

export function formatCurrency(value: string | number | null | undefined, currencyCode = "IDR") {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(number);
}

const moneyInputNumber = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

export function formatMoneyInput(value: string) {
  if (!value) return "";
  if (value === "-") return "-";
  const negative = value.startsWith("-");
  const absolute = negative ? value.slice(1) : value;
  const [whole = "", fraction = ""] = absolute.split(".");
  const grouped = moneyInputNumber.format(BigInt(whole || "0"));
  return `${negative ? "-" : ""}${grouped}${absolute.includes(".") ? `,${fraction.slice(0, 2)}` : ""}`;
}

export function parseMoneyInput(display: string) {
  const negative = display.trimStart().startsWith("-");
  const cleaned = display.replace(/\./g, "").replace(/,/g, ".");
  const [wholeRaw = "", ...rest] = cleaned.split(".");
  const whole = wholeRaw.replace(/\D/g, "");
  const hasSeparator = cleaned.includes(".");
  const fraction = rest.join("").replace(/\D/g, "").slice(0, 2);
  if (!whole && !fraction) return negative ? "-" : "";
  return `${negative ? "-" : ""}${whole || "0"}${hasSeparator ? `.${fraction}` : ""}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE
  }).format(new Date(value));
}
