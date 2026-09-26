export type TimelineFilter = "ALL" | "HAS_CARRY" | "EXPIRING" | "NO_COVERAGE" | "EXPIRED";

export type TimelineCoverageEvidence = {
  coverageFrom: Date;
  coverageTo: Date;
  coverageStatus: string;
};

export function dateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function addUtcMonths(value: Date, months: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

export function timelineWindow(today: Date, requestedStart?: string) {
  const start = requestedStart
    ? new Date(`${requestedStart}T00:00:00.000Z`)
    : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const nextWindowStart = addUtcMonths(start, 6);
  const end = new Date(nextWindowStart.getTime() - 86_400_000);
  return { start, end, monthCount: 6 };
}

export function extendTimelineWindow(base: { start: Date; end: Date; monthCount: number }, furthestCoverageTo: Date | null) {
  if (!furthestCoverageTo) return base;
  const trailingMonthStart = addUtcMonths(furthestCoverageTo, 1);
  const end = new Date(addUtcMonths(trailingMonthStart, 1).getTime() - 86_400_000);
  if (end <= base.end) return base;
  const monthCount = (end.getUTCFullYear() - base.start.getUTCFullYear()) * 12 + end.getUTCMonth() - base.start.getUTCMonth() + 1;
  return { start: base.start, end, monthCount };
}

export function coverageState(coverages: TimelineCoverageEvidence[], today: Date, expiringUntil: Date) {
  const active = coverages.filter(coverage => coverage.coverageStatus === "ACTIVE");
  const currentlyCovered = active.some(coverage => coverage.coverageFrom <= today && coverage.coverageTo >= today);
  const hasFutureCoverage = active.some(coverage => coverage.coverageFrom > today);
  const hasHistoricalCoverage = active.some(coverage => coverage.coverageTo < today);
  const expired = hasHistoricalCoverage && !currentlyCovered && !hasFutureCoverage;
  return {
    currentlyCovered,
    expiring: active.some(coverage => coverage.coverageFrom <= today && coverage.coverageTo >= today && coverage.coverageTo <= expiringUntil),
    expired,
    noCoverage: active.length === 0
  };
}

export function isTimelineSegmentVisible(coverage: Pick<TimelineCoverageEvidence, "coverageFrom" | "coverageTo">, window: { start: Date; end: Date }) {
  return coverage.coverageFrom <= window.end && coverage.coverageTo >= window.start;
}
