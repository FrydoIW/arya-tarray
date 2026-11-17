export const EVENT_TYPES = ["STANDARD", "CAMPAIGN", "TIME_BASED", "ITEM_SALE"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
