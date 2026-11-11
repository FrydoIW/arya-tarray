import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { HttpError } from "../../../lib/http.js";
import { prisma } from "../../../lib/prisma.js";
import { findOverlappingFiscalYear, findOverlappingPeriod, listFiscalYears } from "./period.repository.js";
import type { FiscalYearInput, PeriodInput } from "./period.schema.js";

export { listFiscalYears };
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

export async function createFiscalYearInTransaction(tx: Prisma.TransactionClient, input: FiscalYearInput) {
  const startDate = toDate(input.startDate);
  const endDate = toDate(input.endDate);
  if (await findOverlappingFiscalYear(tx, startDate, endDate)) {
    throw new HttpError(409, "Fiscal year dates overlap an existing fiscal year.");
  }
  return tx.accountingFiscalYear.create({ data: { id: randomUUID(), yearCode: input.yearCode,
    startDate, endDate, status: "OPEN" } });
}

export function createFiscalYear(input: FiscalYearInput) {
  return prisma.$transaction(tx => createFiscalYearInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function createPeriodInTransaction(tx: Prisma.TransactionClient, input: PeriodInput) {
  const startDate = toDate(input.startDate);
  const endDate = toDate(input.endDate);
  const year = await tx.accountingFiscalYear.findUnique({ where: { id: input.fiscalYearId } });
  if (!year) throw new HttpError(404, "Fiscal year was not found.");
  if (year.status !== "OPEN") throw new HttpError(409, "Fiscal year is not open.");
  if (startDate < year.startDate || endDate > year.endDate) {
    throw new HttpError(400, "Accounting period must fall within its fiscal year.");
  }
  if (await findOverlappingPeriod(tx, startDate, endDate)) {
    throw new HttpError(409, "Accounting period dates overlap an existing period.");
  }
  return tx.accountingPeriod.create({ data: { id: randomUUID(), fiscalYearId: year.id,
    periodNo: input.periodNo, periodCode: input.periodCode, startDate, endDate, status: "OPEN" } });
}

export function createPeriod(input: PeriodInput) {
  return prisma.$transaction(tx => createPeriodInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
