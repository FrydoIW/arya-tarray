export const BUSINESS_TIME_ZONE = "Asia/Jakarta";

// Asia/Jakarta is UTC+07:00 year-round (no daylight-saving time).
const BUSINESS_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

export function currentBusinessMonthValue(now = new Date()) {
  const { year, month } = businessDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function currentBusinessDayValue(now = new Date()) {
  const { year, month, day } = businessDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function businessDayUtcRange(now = new Date()) {
  const { year, month, day } = businessDateParts(now);
  const start = new Date(Date.UTC(year, month - 1, day) - BUSINESS_UTC_OFFSET_MS);
  return {
    start,
    end: new Date(start.getTime() + ONE_DAY_MS)
  };
}

export function formatBusinessDateTime(value: Date, locale = "en-GB") {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BUSINESS_TIME_ZONE
  }).format(value);
}
