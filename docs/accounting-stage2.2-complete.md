# Accounting Stage 2.2 — AP/AR backend completion

**Verdict: COMPLETE for the scoped AP/AR backend.** No Accounting UI or later-stage modules were added.

## Approval, physical schema and preservation

The authorized project owner explicitly approved `AT-ST22-20261105-01` v1 for DEV and TEST: “Saya menyetujui patch DEV+TEST; catat dan eksekusi sekarang.” The approval-ready manifest, separate approval receipt, execution evidence and completion record are access controlled outside Git at `D:\arya-tarray-change-records`.

Executed artifact: `database/accounting-stage2.2-apar.mysql.sql`, SHA-256 `B621801A2093C01DD53A014F614794EEDD12A813883C1B20A304264EBAFDD71E`. It is a reviewed operational artifact, never a runtime/startup migration. Do not replay it.

Both physical targets remain **61 tables / 29 Accounting Prisma models**. Three ALTER statements added eight required source fields, three foreign keys and three indexes, plus five new CHECKs and one replacement approval-kind CHECK. Documents now record accounting date, selected control account, recognition basis and revision. Settlements record actual bank account, selected GL bank account, supporting reference and revision. Independent `AR_DOCUMENT` approval uses the existing typed document FK.

Before DDL, affected document, settlement, adjustment and approval-request tables were verified empty on both targets. The approved additive migration preserved all existing row counts. Final DEV row counts differ only by three approved permission definitions; no financial documents, settlements, journals or fake operational evidence were seeded. TEST fixtures were cleaned back to its original minimal masters.

Read-only comparison verified every Prisma table, 705 scalar fields with nullability/native type/size/precision, 224 declared relations with FK mappings/actions, primary/unique/index contracts and 97 enforced physical CHECKs. DEV and TEST physical metadata hashes match: `612ce08ded3aadafb79401a2a37b581d77a559db993aad788a0c3bdf8e491dd9`. MySQL RESTRICT and NO ACTION are compared as equivalent. Prisma generate/validate passed.

Verified pre-DDL full DEV backup, stored locally in automatically detected Downloads:

`C:\Users\Frydo\Downloads\arya_tarray_dev_pre_stage22_2026-11-04T18-01-58-186Z_6ddc6c71.sql.gz`

16,861 bytes; SHA-256 `337a8fab2a71947e3a93ae17cb7e98169e8cbe09bed0a7d707f5f47d693dd833`. All 61 table definitions, SQL completion footer and gzip integrity passed. Dump used consistent InnoDB snapshot, quick streaming, no table locks, triggers/routines/events options. No restore or external transfer occurred.

## Implemented AP and AR

- Counterparties: VENDOR, DEBTOR or BOTH, active state, explicit optional Member reference. No canonical donor ownership was changed.
- AP invoices and AR documents: explicit source number/reference/evidence, dates, selected control account and positive exact-decimal lines. Only the creator can revise an unposted draft using its expected revision. An edit supersedes unused approval. Posted sources have no edit/delete path.
- AP recognition: debit expense/asset lines, credit payable control. AR recognition: debit receivable control, credit earned revenue/appropriate liability lines. Active posting account types and normal balances are validated. No subscription, campaign target or pledge automatically creates AR.
- Draft withdrawal and approval rejection/cancellation retain audit reasons. Posted sources require independently approved compensating reversal; originals remain intact.
- Payments/receipts: positive amount allocated exactly across one or more posted unreversed documents of the same kind and counterparty. Each document can receive multiple settlements. Draft allocations have no financial effect. Overpayment, duplicate allocations and mismatched totals fail atomically.
- AP payment: debit payable control, credit bank. AR receipt: debit bank, credit receivable control. No second GL exists; all paths use the Stage 2.1 common ledger/period/approval gate.
- AR adjustments: separately approved INCREASE/DECREASE with evidence, selected offset and unique reference. Credit notes/write-offs cannot reduce outstanding below zero. Adjustment rows and GL are created together.
- Outstanding and aging are computed from posted recognition/valid adjustments/valid allocations and dated reversal evidence. Historical as-of results remain correct after a source becomes VOID. Amounts are decimal strings; financial computation uses integer cents/Decimal, never JavaScript Number.
- Aging buckets: current, 1–30, 31–60, 61–90 and over 90 days. Full-scope totals are independent of paginated detail rows. Control reconciliation compares the subledger against all matching GL control-account lines, including manual variance.
- Financial activity is chronological per affected document: settlement, adjustment and reversal dates cannot precede existing posted document activity. This prevents a later accrual or reversal from funding an invalid earlier balance. Source dependencies are revalidated at posting, inside Serializable transactions with bounded serialization retries.

## Bank lifecycle and boundaries

A settlement can post before statement import and reports `AWAITING_STATEMENT`. It uses a real configured BankAccount and supporting payment/receipt reference; it never fabricates a BankTransaction. Later matching attaches actual imported evidence and BankTransactionHistory without rewriting the immutable journal or creating another bank/expense/revenue journal. Follow the settlement-to-journal reference to trace a late match.

Matching requires exact amount, direction, real bank account and IDR currency, plus non-excluded/non-withdrawn bank evidence. One active posted settlement may match one bank transaction. Multiple invoices can be covered by that settlement; bank splits, grouped bank rows, cross-counterparty payments and unapplied cash are outside this stage. Repeating the same match is idempotent; replacing a posted historical bank link is not allowed.

States exposed by the API: DRAFT, DRAFT_RESERVED, AWAITING_STATEMENT, MATCHED_PENDING_FINALIZATION, RECONCILED, BANK_REVIEW_REQUIRED and VOID. Existing bank `RAW → CHECK → FINALIZED` and Sign Approval ANY-ONE behavior remain intact. A draft reservation blocks ambiguous incoming bank finalization. Once its approved receipt is posted, bank finalization skips duplicate Phase 1 recognition. An already-recognized Phase 1 bank receipt must first have an independently approved reversal before AP/AR matching. Approved settlement reversal releases the active match with history while retaining its original source link.

## Approval and permissions

AP_INVOICE, AR_DOCUMENT, SETTLEMENT and AR_ADJUSTMENT reuse Stage 2.1 requests, assigned approver snapshots, digest verification and append-only decision/application history. Requesters cannot approve themselves. A current authorized independent reviewer and current authorized poster are required. The shared journal persistence gate also checks the source approval and exact proposed lines, so internal callers cannot bypass it. Period closure, cutover, stale/tampered sources, duplicate source keys and invalid dependencies abort the whole transaction.

All HTTP routes retain existing authentication, active-user checks and `ACCOUNTING_REPORT`. New permission definitions exist in DEV, with **no automatic user/role grants or approver assignment**:

- `ACCOUNTING_AP_MANAGE`: AP sources; also counterparty management.
- `ACCOUNTING_AR_MANAGE`: AR sources/adjustments; also counterparty management.
- `ACCOUNTING_SETTLEMENT_MATCH`: actual bank matching.

Use existing `ACCOUNTING_JOURNAL_APPROVE`, `ACCOUNTING_JOURNAL_POST` and approval-settings configuration for review/posting. Administrators must assign intended roles and independent approvers before operator use. This is an operational access configuration step, not an unfinished backend feature.

## API contract

Prefix: `/api/accounting`. `{side}` is `ap` or `ar`. Responses use the existing JSON/HttpError conventions. Dates are ISO date-only strings, amounts are positive exact decimal strings, IDs are UUIDs. Write bodies reject unknown fields.

| Method/path | Purpose |
| --- | --- |
| GET/POST `/counterparties` | Paginated list / create vendor, debtor or both |
| GET/PATCH `/counterparties/:id` | Detail / name or active state |
| GET/POST `/{side}/documents` | List / create invoice or receivable |
| GET/PATCH `/{side}/documents/:id` | Details, balances, bounded related evidence / revise own draft |
| POST `/{side}/documents/:id/submit` | Request independent approval, `expectedRevision` |
| POST `/{side}/documents/:id/post` | Post using `approvalRequestId` and POST permission |
| POST `/{side}/documents/:id/cancel` | Withdraw own unposted draft, `expectedRevision` and `reason` |
| POST `/{side}/documents/:id/reversal-requests` | Request reversal, `accountingDate` and `remark` |
| POST `/ar/documents/:id/adjustments` | Request separately reviewed AR adjustment |
| GET/POST `/{side}/settlements` | List / create payment or receipt with allocations |
| GET/PATCH `/{side}/settlements/:id` | Detail including bank lifecycle / revise own unposted settlement |
| POST `/{side}/settlements/:id/submit` | Request approval, `expectedRevision` |
| POST `/{side}/settlements/:id/post` | Apply approved allocation and GL together |
| POST `/{side}/settlements/:id/cancel` | Withdraw own unposted settlement with audit reason |
| POST `/{side}/settlements/:id/reversal-requests` | Request settlement reversal |
| POST `/{side}/settlements/:id/match` | Attach actual `bankTransactionId` with `remark`, MATCH permission |
| GET `/{side}/outstanding` | Posted as-of balances, global totals and paginated details |
| GET `/{side}/aging` | Same consistent balance basis and full aging totals |
| GET `/{side}/control-reconciliation` | Subledger versus GL, explicit variance |

Reports require `asOf`; optional `counterpartyId`, `page` and `pageSize` (maximum 100). Related document evidence is capped at 500 records and is not the financial-total source. Use existing `/approvals/:id/decision`, `/cancel`, `/post` and detail/history endpoints for independent decisions and reversal/adjustment application. A rejected/cancelled document request requires draft revision before resubmitting a new document version.

Document input requires counterparty/control account, document number, supporting reference, recognition basis, document/accounting/due dates and 1–200 lines. Settlement input requires counterparty, real bank account, GL bank account, unique settlement reference, supporting reference, date, amount, optional imported bank transaction and 1–100 unique document allocations. AR adjustment input requires reference, date, INCREASE/DECREASE, amount, offset account and reason. Full validated shapes are in `backend/src/modules/accounting/apar/apar.schema.ts`.

## Verification and remaining work

- Backend and integration TypeScript checks: passed.
- Prisma generate/validate and physical schema checks: passed.
- Unit/regression tests: **421/421 passed**, no skipped tests.
- MySQL TEST integration: **58/58 passed**, including all 37 Stage 2.1 regression tests and 21 AP/AR scenarios; none skipped.
- AP/AR tests cover recognition, partial/full/multiple allocations, overpayment, concurrent payments, duplicate posting, permissions/self-approval, stale and tampered digests, closed periods, atomic rollback, reversal/historical balances, AR adjustments, actual bank matching, draft reservation/finalization rollback, duplicate recognition prevention, precision beyond Number, control variance and HTTP contracts.
- TEST cleanup restored original row counts. DEV has no fixture/source/journal data. `.env` bytes are unchanged from the Stage 2.2 baseline and remain ignored/untracked. No PROD connection, new startup guard, authentication redesign, old migration replay, Git staging/commit/push, AGENTS or .gitignore edit occurred.

No technical Stage 2.2 blocker remains. Remaining later stages include operational access assignment, unapplied/complex bank reconciliation, accrual/prepayment schedules, Fixed Assets, closing/reporting and Accounting UI as separately requested/approved work. Prior uncommitted changes were retained; frontend files already modified by earlier work were not edited for Stage 2.2.
