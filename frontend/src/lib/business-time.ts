export const BUSINESS_TIME_ZONE = "Asia/Jakarta";

function businessDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);

  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(valueByType.get("year")),
    month: Number(valueByType.get("month")),
    day: Number(valueByType.get("day"))
  };
}

export function businessMonthValue(value: Date) {
  const { year, month } = businessDateParts(value);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function currentBusinessMonthValue(now = new Date()) {
  return businessMonthValue(now);
}
