import { z } from "zod";

const money = z.string().regex(/^\d{1,18}(?:\.\d{1,2})?$/, "Invalid amount").refine(value => Number(value) > 0, "Amount must be greater than zero");
const reason = z.string().trim().min(3, "Reason is required").max(1000);

export const itemSaleChildParamsSchema = z.object({ childId: z.string().uuid() });
export const itemSaleTransactionParamsSchema = z.object({ transactionId: z.string().uuid() });
export const itemSaleFundParamsSchema = z.object({ fundId: z.string().uuid() });
export const itemSaleAllocationParamsSchema = z.object({ allocationId: z.string().uuid() });
export const allocateItemSaleWalletSchema = z.object({
  sourceFundId: z.string().uuid(),
  purchaseId: z.string().uuid(),
  amount: money,
  reason,
  idempotencyKey: z.string().trim().min(8).max(191)
}).strict();
export const reverseItemSaleWalletAllocationSchema = z.object({ reason }).strict();
export const configureItemSaleSchema = z.object({
  unitPrice: money,
  openingStock: z.number().int().min(0).max(1_000_000_000),
  reason,
  idempotencyKey: z.string().trim().min(8).max(191)
}).strict();
export const updateItemSalePriceSchema = z.object({
  unitPrice: money,
  expectedVersion: z.number().int().positive(),
  reason
}).strict();
export const adjustItemSaleStockSchema = z.object({
  movementType: z.enum(["STOCK_IN", "MANUAL_ADJUSTMENT"]),
  quantityDelta: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine(value => value !== 0, "Quantity delta cannot be zero"),
  expectedVersion: z.number().int().positive(),
  reason,
  idempotencyKey: z.string().trim().min(8).max(191)
}).strict().superRefine((value, context) => {
  if (value.movementType === "STOCK_IN" && value.quantityDelta <= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["quantityDelta"], message: "STOCK_IN quantity must be positive" });
  }
});

export type ConfigureItemSaleInput = z.infer<typeof configureItemSaleSchema>;
export type UpdateItemSalePriceInput = z.infer<typeof updateItemSalePriceSchema>;
export type AdjustItemSaleStockInput = z.infer<typeof adjustItemSaleStockSchema>;
