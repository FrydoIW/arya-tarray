import type { Request, Response } from "express";
import { adjustItemSaleStockSchema, configureItemSaleSchema, itemSaleChildParamsSchema, itemSaleTransactionParamsSchema, updateItemSalePriceSchema } from "./item-sale.schema.js";
import { adjustItemSaleStock, configureItemSale, getItemSaleConfig, retryItemSalePurchase, updateItemSalePrice } from "./item-sale.service.js";

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
