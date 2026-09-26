export type TimelineWindow = { start: string; end: string; monthCount: number };

function utcDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }

export function monthLabels(window: TimelineWindow) {
  const start = utcDate(window.start);
  return Array.from({ length: window.monthCount }, (_, index) => new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1))));
}

export function timelineDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(utcDate(value));
}

export function shiftWindowStart(start: string, months: number) {
  const date = utcDate(start);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)).toISOString().slice(0, 10);
}

export function timelineSegmentGeometry(segment: { coverageFrom: string; coverageTo: string }, window: TimelineWindow) {
  const windowStart = utcDate(window.start).getTime();
  const windowEnd = utcDate(window.end).getTime();
  const from = Math.max(utcDate(segment.coverageFrom).getTime(), windowStart);
  const to = Math.min(utcDate(segment.coverageTo).getTime(), windowEnd);
  if (from > to) return null;
  const days = Math.max(1, Math.round((windowEnd - windowStart) / 86_400_000) + 1);
  return { left: ((from - windowStart) / 86_400_000) / days * 100, width: Math.max(0.7, ((to - from) / 86_400_000 + 1) / days * 100) };
}

export function todayMarkerPosition(today: string, window: TimelineWindow) {
  const marker = utcDate(today).getTime(); const start = utcDate(window.start).getTime(); const end = utcDate(window.end).getTime();
  if (marker < start || marker > end) return null;
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  return (marker - start) / 86_400_000 / days * 100;
}
