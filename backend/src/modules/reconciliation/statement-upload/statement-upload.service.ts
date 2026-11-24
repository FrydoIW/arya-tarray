import { HttpError } from "../../../lib/http.js";
import {
  centsToDecimalString,
  classifyParsedTransaction
} from "./statement-upload.classifier.js";
import {
  directionFromStoredTransactionType,
  storedTransactionRequiresClassification
} from "../reconciliation-classification.js";
import { normalizeAccountNumber, parseBcaStatementWorkbook } from "./statement-upload.parser.js";
import type { UpdateFinalEventInput, WithdrawStatementInput } from "./statement-upload.schema.js";
import { storedChildNeedsAttention, type ChildOption } from "../event-child-classification.js";
import {
  executeStatementAtomic,
  findActiveBankAccount,
  listActiveEventCodesForClassification,
  loadChildrenForParents,
  loadRawStatementsForSummary,
  loadStatementUploadWorkspaceRecords,
  persistParsedStatement,
  resolveStatementDuplicateAtomic,
  updateTransactionFinalEventAtomic,
  withdrawStatementAtomic
} from "./statement-upload.repository.js";

const MAX_FILE_SIZE_MB = 50;
const SUPPORTED_EXTENSION = ".xlsx";
const SUPPORTED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);
const MAX_DECIMAL_20_2_CENTS = 99_999_999_999_999_999_999n;

type WorkspaceRecords = Awaited<ReturnType<typeof loadStatementUploadWorkspaceRecords>>;
type CurrentStatement = NonNullable<WorkspaceRecords["currentStatement"]>;
type CurrentTransaction = CurrentStatement["transactions"][number];
type RawSummaryRecords = WorkspaceRecords["rawStatements"];

function decimalToString(value: { toString(): string } | null) {
  return value === null ? null : value.toString();
}

function inferDirection(transaction: { transactionType: string | null; originalAmount: { toString(): string } }) {
  const byType = directionFromStoredTransactionType(transaction.transactionType);
  if (byType) return byType;
  return transaction.originalAmount.toString().startsWith("-") ? "DB" : "CR";
}

function mapTransaction(transaction: CurrentTransaction) {
  const direction = inferDirection(transaction);
  return {
    id: transaction.id,
    rowNo: transaction.rowNo ?? 0,
    transactionDate: transaction.transactionDate,
    transactionType: transaction.transactionType ?? "",
    direction,
    referenceNo: transaction.referenceNo,
    senderName: transaction.senderName,
    description: transaction.description ?? transaction.transactionType ?? "",
    originalAmount: transaction.originalAmount.toString(),
    suffixCode: transaction.suffixCode,
    suggestedEventCodeId: transaction.suggestedEventCodeId,
    eventCodeId: transaction.eventCodeId,
    eventCodeChildId: transaction.eventCodeChildId,
    eventCampaignId: transaction.eventCampaignId,
    baseAmount: decimalToString(transaction.baseAmount),
    remark: transaction.remark,
    excluded: Boolean(transaction.reconciliationExcludedAt),
    itemSale: transaction.itemSalePurchase ? {
      id: transaction.itemSalePurchase.id,
      quantity: transaction.itemSalePurchase.quantity,
      unitPrice: transaction.itemSalePurchase.unitPriceSnapshot.toString(),
      totalAmount: transaction.itemSalePurchase.totalAmount.toString(),
      paymentAmount: decimalToString(transaction.itemSalePurchase.paymentAmountSnapshot),
      status: transaction.itemSalePurchase.status,
      resolutionReason: transaction.itemSalePurchase.resolutionReason
    } : null,
    requiresClassification: storedTransactionRequiresClassification(transaction)
  };
}

function childrenByParent(children: ChildOption[]) {
  const grouped = new Map<string, ChildOption[]>();
  for (const child of children) {
    const group = grouped.get(child.eventCodeId) ?? [];
    group.push(child);
    grouped.set(child.eventCodeId, group);
  }
  return grouped;
}

function transactionNeedsChildReview(transaction: RawSummaryRecords[number]["transactions"][number], children: Map<string, ChildOption[]>) {
  return storedChildNeedsAttention({
    requiresClassification: storedTransactionRequiresClassification(transaction),
    eventCodeId: transaction.eventCodeId,
    childId: transaction.eventCodeChildId,
    child: transaction.eventCodeChild,
    children: transaction.eventCodeId ? children.get(transaction.eventCodeId) ?? [] : []
  });
}

function mapSummary(rawStatements: RawSummaryRecords, childrenByParentId: Map<string, ChildOption[]>) {
  let totalTransactions = 0;
  let needsReview = 0;
  let readyForSubmission = 0;

  for (const statement of rawStatements) {
    const activeTransactions = statement.transactions.filter(transaction => !transaction.reconciliationExcludedAt);
    totalTransactions += activeTransactions.length;
    let statementNeedsReview = 0;
    for (const transaction of activeTransactions) {
      if (storedTransactionRequiresClassification(transaction) && (!transaction.eventCodeId || (transaction.eventCode?.eventType === "CAMPAIGN" && !transaction.eventCampaignId))) {
        statementNeedsReview += 1;
      } else if (transactionNeedsChildReview(transaction, childrenByParentId)
        || (transaction.eventCode?.eventType === "ITEM_SALE" && (!transaction.itemSalePurchase || transaction.itemSalePurchase.status === "REVIEW_REQUIRED"))) {
        statementNeedsReview += 1;
      }
    }
    needsReview += statementNeedsReview;
    if (activeTransactions.length > 0 && statementNeedsReview === 0) readyForSubmission += 1;
  }

  return {
    draftStatements: rawStatements.length,
    totalTransactions,
    needsReview,
    readyForSubmission
  };
}

function mapWorkspace(records: WorkspaceRecords, childrenByParentId: Map<string, ChildOption[]>) {
  const statement = records.currentStatement;
  const duplicates = records.duplicates.map((row) => {
    const imported = row.importedBankTransaction;
    const matched = row.matchedBankTransaction;
    return {
      id: row.id,
      matchType: row.matchType,
      resolutionStatus: row.resolutionStatus,
      resolutionReason: row.resolutionReason,
      resolvedAt: row.resolvedAt,
      resolvedBy: row.resolvedBy,
      uploadFileName: row.uploadAttempt.fileName,
      source: {
        transactionNo: row.sourceTransactionNo,
        worksheetRow: row.sourceWorksheetRow,
        sheetName: row.sourceSheetName,
        transactionDate: row.transactionDate,
        transactionType: row.transactionType,
        referenceNo: row.referenceNo,
        senderName: row.senderName,
        description: row.sourceDescription,
        originalAmount: row.originalAmount.toString()
      },
      importedTransaction: imported ? {
        id: imported.id,
        rowNo: imported.rowNo,
        transactionDate: imported.transactionDate,
        transactionType: imported.transactionType,
        referenceNo: imported.referenceNo,
        senderName: imported.senderName,
        description: imported.description,
        originalAmount: imported.originalAmount.toString(),
        status: imported.status,
        statementId: imported.statementUploadId,
        fileName: imported.statementUpload.fileName
      } : null,
      matchedTransaction: {
        id: matched.id,
        rowNo: matched.rowNo,
        transactionDate: matched.transactionDate,
        transactionType: matched.transactionType,
        referenceNo: matched.referenceNo,
        senderName: matched.senderName,
        description: matched.description,
        originalAmount: matched.originalAmount.toString(),
        status: matched.status,
        statementId: matched.statementUploadId,
        fileName: matched.statementUpload.fileName
      }
    };
  });
  return {
    summary: mapSummary(records.rawStatements, childrenByParentId),
    drafts: records.rawStatements.map((draft) => {
      const needsReview = draft.transactions.filter((transaction) => {
        if (transaction.reconciliationExcludedAt) return false;
        if (storedTransactionRequiresClassification(transaction) && (!transaction.eventCodeId || (transaction.eventCode?.eventType === "CAMPAIGN" && !transaction.eventCampaignId))) return true;
        return transactionNeedsChildReview(transaction, childrenByParentId)
          || (transaction.eventCode?.eventType === "ITEM_SALE" && (!transaction.itemSalePurchase || transaction.itemSalePurchase.status === "REVIEW_REQUIRED"));
      }).length;
      return {
        id: draft.id,
        bankAccountLabel: `${draft.bankAccount.bankName} - ${draft.bankAccount.accountName}`,
        accountNo: draft.bankAccount.accountNo,
        fileName: draft.fileName,
        periodFrom: draft.periodFrom,
        periodTo: draft.periodTo,
        totalTransaction: draft.totalTransaction,
        needsReview,
        uploadedBy: draft.uploadedBy.fullName,
        uploadedAt: draft.uploadedAt,
        status: draft.status
      };
    }),
    statement: statement
      ? {
          id: statement.id,
          bankAccountId: statement.bankAccountId,
          bankAccountLabel: `${statement.bankAccount.bankName} - ${statement.bankAccount.accountName}`,
          accountNo: statement.bankAccount.accountNo,
          fileName: statement.fileName,
          periodFrom: statement.periodFrom,
          periodTo: statement.periodTo,
          totalTransaction: statement.totalTransaction,
          totalCredit: statement.totalCredit.toString(),
          totalDebit: statement.totalDebit.toString(),
          status: statement.status,
          uploadedAt: statement.uploadedAt,
          uploadedBy: statement.uploadedBy.fullName,
          rejectionRemark: statement.approval?.status === "REJECTED" ? statement.approval.remark : null,
          overlaps: records.overlappingStatements
        }
      : null,
    transactions: statement ? statement.transactions.map(mapTransaction) : [],
    duplicates,
    duplicateSummary: {
      pendingReview: duplicates.filter(row => row.matchType === "POSSIBLE" && row.resolutionStatus === "PENDING_REVIEW").length,
      exactSkipped: duplicates.filter(row => row.matchType === "EXACT").length,
      resolvedDistinct: duplicates.filter(row => row.resolutionStatus === "DISTINCT").length,
      resolvedDuplicate: duplicates.filter(row => row.resolutionStatus === "DUPLICATE").length
    },
    eventCodes: records.activeEventCodes.map((eventCode) => ({
      id: eventCode.id,
      code: eventCode.code,
      eventName: eventCode.eventName,
      eventType: eventCode.eventType,
      timeRule: eventCode.timeRule ? { unitAmount: eventCode.timeRule.unitAmount.toString(), durationMonths: eventCode.timeRule.durationMonths, activeFlag: eventCode.timeRule.activeFlag } : null
    })),
    eventCodeChildren: records.eventCodeChildren.map((child) => ({
      id: child.id,
      eventCodeId: child.eventCodeId,
      childCode: child.childCode,
      childName: child.childName,
      displayOrder: child.displayOrder,
      activeFlag: child.activeFlag,
      capacity: child.capacity,
      unitAmount: child.unitAmount?.toString() ?? null,
      durationMonths: child.durationMonths,
      itemSaleUnitPrice: child.itemSaleConfig?.unitPrice.toString() ?? null,
      itemSaleStockOnHand: child.itemSaleConfig?.stockOnHand ?? null,
      itemSaleVersion: child.itemSaleConfig?.version ?? null
    })),
    campaigns: records.campaigns.map((campaign) => ({
      id: campaign.id,
      eventCodeId: campaign.eventCodeId,
      campaignName: campaign.campaignName,
      startDate: campaign.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: campaign.endDate?.toISOString().slice(0, 10) ?? null,
      activeFlag: campaign.activeFlag
    })),
    bankAccounts: records.bankAccounts.map((account) => ({
      id: account.id,
      label: `${account.bankName} - ${account.accountName} (${account.accountNo})`,
      accountNo: account.accountNo
    }))
  };
}

export async function getStatementUploadWorkspace(statementId?: string) {
  const records = await loadStatementUploadWorkspaceRecords(statementId);
  if (statementId && !records.currentStatement) {
    throw new HttpError(404, "RAW statement draft not found. Reload the draft list.");
  }
  const parentIds = [...new Set(records.rawStatements.flatMap((statement) =>
    statement.transactions.map((transaction) => transaction.eventCodeId).filter((value): value is string => Boolean(value))
  ))];
  const childRecords = await loadChildrenForParents(parentIds);
  const children = childrenByParent(childRecords);
  return mapWorkspace(records, children);
}

function assertUploadFile(file: Express.Multer.File | undefined) {
  if (!file) throw new HttpError(400, "Statement XLSX file is required.");
  const lowerName = file.originalname.toLowerCase();
  if (!lowerName.endsWith(SUPPORTED_EXTENSION)) {
    throw new HttpError(400, "Unsupported file format. Statement Upload V1 supports .xlsx files only.");
  }
  if (file.mimetype && !SUPPORTED_MIME_TYPES.has(file.mimetype)) {
    throw new HttpError(400, "Unsupported file type. Please upload a valid XLSX workbook.");
  }
  if (file.originalname.length > 255) {
    throw new HttpError(400, "Statement file name is too long. Maximum length is 255 characters.");
  }
  if (file.size <= 0) throw new HttpError(400, "The uploaded statement file is empty.");
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new HttpError(400, `Statement file exceeds the ${MAX_FILE_SIZE_MB}MB limit.`);
  }
}

function assertParserOutput(parsed: Awaited<ReturnType<typeof parseBcaStatementWorkbook>>) {
  for (const transaction of parsed.transactions) {
    if (transaction.transactionType.length > 20) {
      throw new HttpError(400, `Unsupported transaction type at ${transaction.sourceSheetName} row ${transaction.sourceRowNo}: maximum length is 20 characters.`);
    }
    if (transaction.referenceNo && transaction.referenceNo.length > 150) {
      throw new HttpError(400, `Reference number at ${transaction.sourceSheetName} row ${transaction.sourceRowNo} exceeds 150 characters.`);
    }
    if (transaction.senderName && transaction.senderName.length > 255) {
      throw new HttpError(400, `Sender name at ${transaction.sourceSheetName} row ${transaction.sourceRowNo} exceeds 255 characters.`);
    }
    const absoluteCents = transaction.amountCents < 0n ? -transaction.amountCents : transaction.amountCents;
    if (absoluteCents > MAX_DECIMAL_20_2_CENTS) {
      throw new HttpError(400, `Amount at ${transaction.sourceSheetName} row ${transaction.sourceRowNo} exceeds the supported database precision.`);
    }
  }
}

export async function uploadStatement(input: {
  file: Express.Multer.File | undefined;
  bankAccountId: string;
  userId: string;
}) {
  assertUploadFile(input.file);
  const file = input.file!;

  const bankAccount = await findActiveBankAccount(input.bankAccountId);
  if (!bankAccount) throw new HttpError(400, "Selected bank account is inactive or no longer available.");

  let parsed;
  try {
    parsed = await parseBcaStatementWorkbook(file.buffer);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Unable to parse the BCA statement workbook.");
  }

  assertParserOutput(parsed);

  if (normalizeAccountNumber(parsed.accountNo) !== normalizeAccountNumber(bankAccount.accountNo)) {
    throw new HttpError(
      400,
      `Workbook account ${parsed.accountNo} does not match selected bank account ${bankAccount.accountNo}.`
    );
  }

  const activeEventCodes = await listActiveEventCodesForClassification();
  const eventCodeByCode = new Map(activeEventCodes.map((eventCode) => [eventCode.code, eventCode]));

  let totalCreditCents = 0n;
  let totalDebitCents = 0n;
  const transactions = parsed.transactions.map((transaction, index) => {
    if (transaction.amountCents >= 0n) totalCreditCents += transaction.amountCents;
    else totalDebitCents += -transaction.amountCents;

    const classification = classifyParsedTransaction(
      {
        direction: transaction.direction,
        transactionType: transaction.transactionType,
        amountCents: transaction.amountCents
      },
      eventCodeByCode
    );

    return {
      sourceTransactionNo: index + 1,
      sourceWorksheetRow: transaction.sourceRowNo,
      sourceSheetName: transaction.sourceSheetName,
      transactionDate: transaction.transactionDate,
      transactionType: transaction.transactionType,
      referenceNo: transaction.referenceNo,
      senderName: transaction.senderName,
      description: transaction.description,
      originalAmount: centsToDecimalString(transaction.amountCents),
      suffixCode: classification.suffixCode,
      suggestedEventCodeId: classification.suggestedEventCodeId,
      eventCodeId: classification.eventCodeId,
      baseAmount: classification.baseAmount
    };
  });

  if (totalCreditCents > MAX_DECIMAL_20_2_CENTS || totalDebitCents > MAX_DECIMAL_20_2_CENTS) {
    throw new HttpError(400, "Statement totals exceed the supported database precision.");
  }

  const totalCredit = centsToDecimalString(totalCreditCents);
  const totalDebit = centsToDecimalString(totalDebitCents);

  const result = await persistParsedStatement({
    bankAccountId: bankAccount.id,
    fileName: file.originalname,
    periodFrom: parsed.periodFrom,
    periodTo: parsed.periodTo,
    totalTransaction: transactions.length,
    totalCredit,
    totalDebit,
    uploadedById: input.userId,
    transactions
  });

  const workspace = result.statementId
    ? await getStatementUploadWorkspace(result.statementId)
    : await getStatementUploadWorkspace();

  return {
    ...workspace,
    uploadResult: {
      attemptId: result.attemptId,
      sourceTransactions: result.sourceTransactionCount,
      importedTransactions: result.importedTransactionCount,
      duplicateTransactions: result.duplicateTransactionCount,
      possibleDuplicateTransactions: result.possibleDuplicateTransactionCount,
      sourceTotalCredit: result.sourceTotalCredit,
      sourceTotalDebit: result.sourceTotalDebit,
      duplicates: result.duplicates
    }
  };
}

export async function updateFinalEvent(
  statementId: string,
  transactionId: string,
  input: UpdateFinalEventInput,
  userId: string
) {
  const updatedTransaction = await updateTransactionFinalEventAtomic({
    statementId,
    transactionId,
    eventCodeId: input.eventCodeId,
    eventCodeChildId: input.eventCodeChildId,
    eventCampaignId: input.eventCampaignId,
    itemSaleQuantity: input.itemSaleQuantity,
    remark: input.remark,
    userId
  });

  const rawStatements = await loadRawStatementsForSummary();
  const parentIds = [...new Set(rawStatements.flatMap((statement) =>
    statement.transactions.map((transaction) => transaction.eventCodeId).filter((value): value is string => Boolean(value))
  ))];
  const children = childrenByParent(await loadChildrenForParents(parentIds));
  return {
    transaction: mapTransaction(updatedTransaction),
    summary: mapSummary(rawStatements, children)
  };
}

export async function executeStatement(statementId: string, userId: string) {
  await executeStatementAtomic({ statementId, userId });
  return getStatementUploadWorkspace();
}

export async function resolveDuplicate(statementId: string, duplicateId: string, input: { decision: "DISTINCT" | "DUPLICATE"; reason: string }, userId: string) {
  await resolveStatementDuplicateAtomic({ statementId, duplicateId, decision: input.decision, reason: input.reason, userId });
  return getStatementUploadWorkspace(statementId);
}

export async function withdrawStatement(statementId: string, input: WithdrawStatementInput, userId: string) {
  const result = await withdrawStatementAtomic({ statementId, reason: input.reason, userId });
  const workspace = await getStatementUploadWorkspace();
  return {
    ...workspace,
    withdrawal: {
      statementId: result.statementId,
      remainingStatementCount: result.remainingStatementCount,
      openingBalanceUnlocked: result.openingBalanceUnlocked
    }
  };
}
