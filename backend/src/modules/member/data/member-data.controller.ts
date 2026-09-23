import type { Request, Response } from "express";
import * as schema from "./member-data.schema.js";
import * as service from "./member-data.service.js";
import { createCampaignWalletTransfer as executeCampaignWalletTransfer, createCarryTransfer as executeCarryTransfer, getCarryTransfers as loadCarryTransfers, reverseCarryTransfer as executeCarryTransferReversal } from "../time-based/member-carry-transfer.service.js";

export async function workspace(req: Request, res: Response) { res.json(await service.getWorkspace(schema.memberDataWorkspaceQuerySchema.parse(req.query))); }
export async function detail(req: Request, res: Response) { res.json(await service.getDetail(schema.memberDataParamsSchema.parse(req.params).memberId)); }
export async function identityHistory(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params);
  res.json(await service.getIdentityHistory(memberId, schema.identityHistoryQuerySchema.parse(req.query)));
}
export async function options(req: Request, res: Response) { res.json(await service.getIdentityOptions(schema.identityOptionQuerySchema.parse(req.query).search)); }
export async function memberOptions(req: Request, res: Response) {
  const query = schema.memberOptionQuerySchema.parse(req.query);
  res.json(await service.getMemberOptions(query.search, query.excludeMemberId));
}
export async function update(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params);
  res.json(await service.updateProfile(memberId, schema.memberProfileSchema.parse(req.body), req.auth!.userId));
}
export async function lifecycle(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params);
  res.json(await service.updateLifecycle(memberId, schema.memberLifecycleSchema.parse(req.body).activeFlag, req.auth!.userId));
}
export async function attach(req: Request, res: Response) {
  const { memberId, identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.attach(memberId, identityId, req.auth!.userId));
}
export async function move(req: Request, res: Response) {
  const { memberId, identityId } = schema.identityParamsSchema.parse(req.params);
  const input = schema.moveIdentitySchema.parse(req.body);
  res.json(await service.move(memberId, identityId, input.destinationMemberId, input.reason, req.auth!.userId));
}
export async function detach(req: Request, res: Response) {
  const { memberId, identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.detach(memberId, identityId, schema.detachIdentitySchema.parse(req.body).reason, req.auth!.userId));
}
export async function identityMetadata(req: Request, res: Response) {
  const { memberId, identityId } = schema.identityParamsSchema.parse(req.params);
  res.json(await service.updateIdentity(memberId, identityId, schema.identityMetadataSchema.parse(req.body), req.auth!.userId));
}
export async function donations(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params);
  res.json(await service.getDonations(memberId, schema.memberDonationQuerySchema.parse(req.query)));
}
export async function sponsorship(req: Request, res: Response) { res.json(await service.getSponsorship(schema.memberDataParamsSchema.parse(req.params).memberId)); }
export async function createSubscription(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params); res.json(await service.createSubscription(memberId, schema.subscriptionCreateSchema.parse(req.body), req.auth!.userId));
}
export async function createCampaignParticipation(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params);
  res.json(await service.createCampaignParticipation(memberId, schema.campaignParticipationCreateSchema.parse(req.body), req.auth!.userId));
}
export async function updateSubscription(req: Request, res: Response) {
  const { memberId, subscriptionId } = schema.subscriptionParamsSchema.parse(req.params); res.json(await service.updateSubscription(memberId, subscriptionId, schema.subscriptionUpdateSchema.parse(req.body), req.auth!.userId));
}
export async function allocateSubscription(req: Request, res: Response) {
  const { memberId, subscriptionId } = schema.subscriptionParamsSchema.parse(req.params); res.json(await service.allocateSubscription(memberId, subscriptionId, schema.allocationSchema.parse(req.body).transactionId, req.auth!.userId));
}
export async function openingCoverage(req: Request, res: Response) {
  const { memberId, subscriptionId } = schema.subscriptionParamsSchema.parse(req.params); res.json(await service.addOpeningCoverage(memberId, subscriptionId, schema.openingCoverageSchema.parse(req.body), req.auth!.userId));
}
export async function voidOpeningCoverage(req: Request, res: Response) {
  const { memberId, subscriptionId, coverageId } = schema.openingCoverageParamsSchema.parse(req.params);
  res.json(await service.voidOpeningCoverage(memberId, subscriptionId, coverageId, schema.voidOpeningCoverageSchema.parse(req.body).reason, req.auth!.userId));
}
export async function retryAllocation(req: Request, res: Response) {
  const { memberId, subscriptionId } = schema.subscriptionParamsSchema.parse(req.params);
  res.json(await service.retryAllocation(memberId, subscriptionId, schema.allocationSchema.parse(req.body).transactionId, req.auth!.userId));
}
export async function carryTransfers(req: Request, res: Response) {
  const { memberId } = schema.memberDataParamsSchema.parse(req.params);
  res.json(await loadCarryTransfers(memberId, schema.carryTransferHistoryQuerySchema.parse(req.query)));
}
export async function createCarryTransfer(req: Request, res: Response) {
  const { memberId, sourceSubscriptionId } = schema.carryTransferParamsSchema.parse(req.params);
  res.json(await executeCarryTransfer(memberId, sourceSubscriptionId, schema.carryTransferCreateSchema.parse(req.body), req.auth!.userId));
}
export async function createCampaignWalletTransfer(req: Request, res: Response) {
  const { memberId, sourceCampaignId } = schema.campaignWalletTransferParamsSchema.parse(req.params);
  res.json(await executeCampaignWalletTransfer(memberId, sourceCampaignId, schema.carryTransferCreateSchema.parse(req.body), req.auth!.userId));
}
export async function reverseCarryTransfer(req: Request, res: Response) {
  const { memberId, transferId } = schema.carryTransferReverseParamsSchema.parse(req.params);
  res.json(await executeCarryTransferReversal(memberId, transferId, schema.carryTransferReverseSchema.parse(req.body), req.auth!.userId));
}
