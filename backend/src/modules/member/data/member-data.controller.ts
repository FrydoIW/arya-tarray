import type { Request, Response } from "express";
import * as schema from "./member-data.schema.js";
import * as service from "./member-data.service.js";

export async function workspace(req: Request, res: Response) { res.json(await service.getWorkspace(schema.memberDataWorkspaceQuerySchema.parse(req.query))); }
export async function detail(req: Request, res: Response) { res.json(await service.getDetail(schema.memberDataParamsSchema.parse(req.params).memberId)); }
export async function options(req: Request, res: Response) { res.json(await service.getIdentityOptions(schema.identityOptionQuerySchema.parse(req.query).search)); }
export async function memberOptions(req: Request, res: Response) {
  const query = schema.memberOptionQuerySchema.parse(req.query);
  res.json(await service.getMemberOptions(query.search, query.excludeMemberId));
}
export async function update(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params);
  res.json(await service.updateProfile(memberId, schema.memberProfileSchema.parse(req.body), req.auth!.userId));
}
export async function attach(req: Request, res: Response) {
  const { memberId, identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.attach(memberId, identityId, req.auth!.userId));
}
export async function move(req: Request, res: Response) {
  const { memberId, identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.move(memberId, identityId, schema.moveIdentitySchema.parse(req.body).destinationMemberId, req.auth!.userId));
}
export async function detach(req: Request, res: Response) {
  const { memberId, identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.detach(memberId, identityId, req.auth!.userId));
}
export async function identityMetadata(req: Request, res: Response) {
  const { memberId, identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.updateIdentity(memberId, identityId, schema.identityMetadataSchema.parse(req.body), req.auth!.userId));
}
export async function donations(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params);
  res.json(await service.getDonations(memberId, schema.memberDonationQuerySchema.parse(req.query)));
}
