import type { Request, Response } from "express";
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
