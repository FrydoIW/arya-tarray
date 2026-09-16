import type { Request, Response } from "express";
import { campaignExecuteSchema } from "./event-campaign.schema.js";
import { executeCampaignChanges, getCampaignSummaries } from "./event-campaign.service.js";
import { timeRuleBulkExecuteSchema } from "./event-time-rule.schema.js";
import { executeTimeRules, getTimeRuleSummaries } from "./event-time-rule.service.js";
import {
  eventCodeBulkPreviewBodySchema,
  eventCodeExecuteSchema,
  eventCodeListSchema
} from "./event-code.schema.js";
import {
  downloadEventCodeTemplate,
  executeEventCodeChanges,
  listEventCodes,
  previewEventCodeBulkUpload
} from "./event-code.service.js";

export async function listEventCodesController(req: Request, res: Response) {
  const query = eventCodeListSchema.parse(req.query);
  res.json(await listEventCodes(query.search));
}

export async function listCampaignsController(_req: Request, res: Response) {
  res.json(await getCampaignSummaries());
}

export async function executeCampaignsController(req: Request, res: Response) {
  const input = campaignExecuteSchema.parse(req.body);
  res.json(await executeCampaignChanges(input, req.auth!.userId));
}

export async function listTimeRulesController(_req: Request, res: Response) { res.json(await getTimeRuleSummaries()); }
export async function executeTimeRuleController(req: Request, res: Response) {
  res.json(await executeTimeRules(timeRuleBulkExecuteSchema.parse(req.body), req.auth!.userId));
}

export async function executeEventCodeChangesController(req: Request, res: Response) {
  const input = eventCodeExecuteSchema.parse(req.body);
  res.json(await executeEventCodeChanges(input, req.auth!.userId));
}

export async function downloadEventCodeTemplateController(_req: Request, res: Response) {
  const buffer = await downloadEventCodeTemplate();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="arya-tarray-event-code-template.xlsx"');
  res.send(buffer);
}

export async function previewEventCodeBulkUploadController(req: Request, res: Response) {
  const { stagedCodes } = eventCodeBulkPreviewBodySchema.parse(req.body ?? {});
  res.json(await previewEventCodeBulkUpload({ file: req.file, stagedCodes }));
}
