export const EVENT_TYPES = ["STANDARD", "CAMPAIGN", "TIME_BASED"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
