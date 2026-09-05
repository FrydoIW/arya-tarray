import type { Request, Response } from "express";
import * as schema from "./member-registration.schema.js";
import * as service from "./member-registration.service.js";
export async function workspace(req: Request, res: Response) { res.json(await service.getWorkspace(schema.workspaceQuerySchema.parse(req.query))); }
export async function options(req: Request, res: Response) { res.json(await service.getMemberOptions(schema.optionsQuerySchema.parse(req.query).search)); }
export async function manual(req: Request, res: Response) { res.status(201).json(await service.register(schema.memberInputSchema.parse(req.body), req.auth!.userId)); }
export async function register(req: Request, res: Response) {
  const { identityId } = schema.identityParamsSchema.parse(req.params);
  res.status(201).json(await service.register(schema.memberInputSchema.parse(req.body), req.auth!.userId, identityId));
}
export async function link(req: Request, res: Response) {
  const { identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.link(identityId, schema.linkSchema.parse(req.body).memberId, req.auth!.userId));
}
export async function ignore(req: Request, res: Response) {
  const { identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.ignore(identityId, schema.ignoreSchema.parse(req.body ?? {}).remark, req.auth!.userId));
}
