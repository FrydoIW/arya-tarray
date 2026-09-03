export type PeriodMode = "MONTH" | "DAY";

export type ResolvedPeriod = {
  mode: PeriodMode;
  month: string;
  date: string;
  start: Date;
  end: Date;
};

function parseMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return { year, month };
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

export function isValidPeriodDate(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return false;
  const { year, month, day } = parseDate(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function resolvePeriod(mode: PeriodMode, month: string, date: string): ResolvedPeriod {
  if (mode === "DAY") {
    const { year, month: dayMonth, day } = parseDate(date);
    const start = new Date(Date.UTC(year, dayMonth - 1, day));
    return { mode, month: date.slice(0, 7), date, start, end: new Date(Date.UTC(year, dayMonth - 1, day + 1)) };
  }

  const { year, month: selectedMonth } = parseMonth(month);
  return {
    mode,
    month,
    date: `${month}-01`,
    start: new Date(Date.UTC(year, selectedMonth - 1, 1)),
    end: new Date(Date.UTC(year, selectedMonth, 1))
  };
}

export function formatPeriodLabel(period: Pick<ResolvedPeriod, "mode" | "month" | "date">) {
  if (period.mode === "DAY") {
    const { year, month, day } = parseDate(period.date);
    return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, month - 1, day)));
  }

  const { year, month } = parseMonth(period.month);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}
