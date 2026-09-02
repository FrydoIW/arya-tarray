import { z } from "zod";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

export const dashboardWorkspaceQuerySchema = z.object({
  month: z.string().regex(monthPattern, "Month must use YYYY-MM format").optional()
});

export type DashboardWorkspaceQuery = z.infer<typeof dashboardWorkspaceQuerySchema>;
