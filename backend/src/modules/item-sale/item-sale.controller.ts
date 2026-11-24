import type { Request, Response } from "express";
import { adjustItemSaleStockSchema, allocateItemSaleWalletSchema, configureItemSaleSchema, itemSaleAllocationParamsSchema, itemSaleChildParamsSchema, itemSaleFundParamsSchema, itemSaleTransactionParamsSchema, reverseItemSaleWalletAllocationSchema, updateItemSalePriceSchema } from "./item-sale.schema.js";
import { adjustItemSaleStock, allocateItemSaleWallet, configureItemSale, getItemSaleConfig, getItemSaleWalletFund, getItemSaleWalletSummary, retryItemSalePurchase, reverseItemSaleWalletAllocation, updateItemSalePrice } from "./item-sale.service.js";

export async function detail(req: Request, res: Response) {
  const { childId } = itemSaleChildParamsSchema.parse(req.params);
  res.json(await getItemSaleConfig(childId));
}
export async function configure(req: Request, res: Response) {
  const { childId } = itemSaleChildParamsSchema.parse(req.params);
  res.status(201).json(await configureItemSale(childId, configureItemSaleSchema.parse(req.body), req.auth!.userId));
}
export async function price(req: Request, res: Response) {
  const { childId } = itemSaleChildParamsSchema.parse(req.params);
  res.json(await updateItemSalePrice(childId, updateItemSalePriceSchema.parse(req.body), req.auth!.userId));
}
export async function stock(req: Request, res: Response) {
  const { childId } = itemSaleChildParamsSchema.parse(req.params);
  res.json(await adjustItemSaleStock(childId, adjustItemSaleStockSchema.parse(req.body), req.auth!.userId));
}
export async function retry(req: Request, res: Response) {
  const { transactionId } = itemSaleTransactionParamsSchema.parse(req.params);
  res.json(await retryItemSalePurchase(transactionId, req.auth!.userId));
}
export async function wallet(req: Request, res: Response) {
  res.json(await getItemSaleWalletSummary());
}
export async function walletFund(req: Request, res: Response) {
  const { fundId } = itemSaleFundParamsSchema.parse(req.params);
  res.json(await getItemSaleWalletFund(fundId));
}
export async function allocateWallet(req: Request, res: Response) {
  const input = allocateItemSaleWalletSchema.parse(req.body);
  res.status(201).json(await allocateItemSaleWallet({ ...input, userId: req.auth!.userId }));
}
export async function reverseWalletAllocation(req: Request, res: Response) {
  const { allocationId } = itemSaleAllocationParamsSchema.parse(req.params);
  const input = reverseItemSaleWalletAllocationSchema.parse(req.body);
  res.json(await reverseItemSaleWalletAllocation({ allocationId, reason: input.reason, userId: req.auth!.userId }));
}
