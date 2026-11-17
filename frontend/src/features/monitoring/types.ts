export type TimeBasedTimelineFilter = "ALL" | "HAS_CARRY" | "EXPIRING" | "NO_COVERAGE" | "EXPIRED";
export type TimeBasedMonitoringChild = {
  eventCodeId: string; eventCodeChildId: string; childCode: string; childName: string;
  activeFlag: boolean; capacity: number | null; occupiedSlots: number; availableSlots: number | null;
  pendingEnrollment: number; activeSubscriptions: number; expiredSubscriptions: number;
  outstandingCarry: string; configurationComplete: boolean; unitAmount: string | null; durationMonths: number | null;
};
export type TimeBasedMonitoringWorkspace = {
  summary: { activePrograms: number; currentlyCovered: number; expiringSoon: number; expiredCoverage: number; programsWithoutCoverage: number; outstandingCarry: string; carrySourceCount: number };
  eventGroups: Array<{ code: string; eventName: string; rule: { unitAmount: string; durationMonths: number } | null; activePrograms: number; currentlyCovered: number; notCurrentlyCovered: number; expiringSoon: number; outstandingCarry: string; children: TimeBasedMonitoringChild[] }>;
  timeline: {
    window: { start: string; end: string; monthCount: number };
    rows: Array<{
      member: { id: string; memberCode: string; memberName: string };
      subscriptionId: string;
      activeFlag: boolean;
      program: { id: string; code: string; eventName: string };
      eventCodeChild: { eventCodeChildId: string; childCode: string; childName: string } | null;
      currentlyCovered: boolean;
      coverageStatus: "COVERED" | "NO_COVERAGE" | "EXPIRED" | "INACTIVE";
      validUntil: string | null;
      carryBalance: string;
      coverageSegments: Array<{ coverageId: string; coverageFrom: string; coverageTo: string; source: string }>;
    }>;
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  };
  today: string;
  generatedAt: string;
};
export type CampaignMonitoringWorkspace = { summary: { activeCampaigns: number; scheduledCampaigns: number; totalTargetApplied: string; totalRemaining: string; outstandingCampaignCarry: string }; campaigns: Array<{ campaignId: string; campaignName: string; eventCode: { code: string; eventName: string }; startDate: string | null; endDate: string | null; targetAmount: string | null; directContribution: string; carryAllocation: string; targetApplied: string; remainingAmount: string | null; campaignCarry: string; progressPercent: number | null; targetReached: boolean; displayStatus: string }>; generatedAt: string };
