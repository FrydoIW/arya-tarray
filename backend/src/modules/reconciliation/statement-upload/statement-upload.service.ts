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
import type { UpdateFinalEventInput } from "./statement-upload.schema.js";
import {
  executeStatementAtomic,
  findActiveBankAccount,
  findPotentialDuplicateStatement,
  listActiveEventCodesForClassification,
  loadRawStatementsForSummary,
  loadStatementUploadWorkspaceRecords,
  persistParsedStatement,
  updateTransactionFinalEventAtomic
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
    baseAmount: decimalToString(transaction.baseAmount),
    remark: transaction.remark,
    requiresClassification: storedTransactionRequiresClassification(transaction)
  };
}

function mapSummary(rawStatements: RawSummaryRecords) {
  let totalTransactions = 0;
  let needsReview = 0;
  let readyForSubmission = 0;

  for (const statement of rawStatements) {
    totalTransactions += statement.transactions.length;
    let statementNeedsReview = 0;
    for (const transaction of statement.transactions) {
      if (storedTransactionRequiresClassification(transaction) && !transaction.eventCodeId) {
        statementNeedsReview += 1;
      }
    }
    needsReview += statementNeedsReview;
    if (statement.transactions.length > 0 && statementNeedsReview === 0) readyForSubmission += 1;
  }

  return {
    draftStatements: rawStatements.length,
    totalTransactions,
    needsReview,
    readyForSubmission
  };
}

function mapWorkspace(records: WorkspaceRecords) {
  const statement = records.currentStatement;
  return {
    summary: mapSummary(records.rawStatements),
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
          rejectionRemark: statement.approval?.status === "REJECTED" ? statement.approval.remark : null
        }
      : null,
    transactions: statement ? statement.transactions.map(mapTransaction) : [],
    eventCodes: records.activeEventCodes.map((eventCode) => ({
      id: eventCode.id,
      code: eventCode.code,
      eventName: eventCode.eventName
    })),
    bankAccounts: records.bankAccounts.map((account) => ({
      id: account.id,
      label: `${account.bankName} - ${account.accountName} (${account.accountNo})`,
      accountNo: account.accountNo
    }))
  };
}

export async function getStatementUploadWorkspace(statementId?: string) {
  return mapWorkspace(await loadStatementUploadWorkspaceRecords(statementId));
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
      rowNo: index + 1,
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

  const duplicate = await findPotentialDuplicateStatement({
    bankAccountId: bankAccount.id,
    fileName: file.originalname,
    periodFrom: parsed.periodFrom,
    periodTo: parsed.periodTo,
    totalTransaction: transactions.length,
    totalCredit,
    totalDebit
  });

  if (duplicate) {
    throw new HttpError(
      409,
      `A matching statement batch already exists (${duplicate.id}). Reload the workspace instead of uploading it again.`
    );
  }

  const statement = await persistParsedStatement({
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

  return getStatementUploadWorkspace(statement.id);
}

export async function updateFinalEvent(
  transactionId: string,
  input: UpdateFinalEventInput,
  userId: string
) {
  const updatedTransaction = await updateTransactionFinalEventAtomic({
    transactionId,
    eventCodeId: input.eventCodeId,
    remark: input.remark,
    userId
  });

  const rawStatements = await loadRawStatementsForSummary();
  return {
    transaction: mapTransaction(updatedTransaction),
    summary: mapSummary(rawStatements)
  };
}

export async function executeStatement(statementId: string, userId: string) {
  await executeStatementAtomic({ statementId, userId });
  return getStatementUploadWorkspace(statementId);
}
