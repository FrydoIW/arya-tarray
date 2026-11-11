# Accounting Stage 3.3 — Accounts Payable and Receivable

Verified on 9 November 2026, Asia/Jakarta.

## API contract inventory

Reviewed against AP/AR routes, controllers, schemas, repository, service, source digest and posting logic. The approval service, bank inquiry and bank reconciliation sources, Stage 2.2 integration scenarios and Stage 2.6 audit records define the downstream boundaries.

Paths are relative to /api/accounting unless stated. Accounting routes require ACCOUNTING_REPORT. AP and AR management use ACCOUNTING_AP_MANAGE and ACCOUNTING_AR_MANAGE respectively.

| Method and path | Request and response | Additional requirements |
| --- | --- | --- |
| GET /counterparties | search, page, pageSize. Returns rows, total and pagination. | Code/name search in fixed code order. |
| POST /counterparties | counterpartyCode, displayName, counterpartyType VENDOR/DEBTOR/BOTH, nullable memberId, activeFlag. Returns record. | Either management grant. Existing optional Member UUID only. |
| GET /counterparties/:id | Returns record including Member reference. | Existing UUID. |
| PATCH /counterparties/:id | displayName and/or activeFlag. Returns record. | Either management grant. Code, classification and Member link remain read-only during edits. |
| GET /{ap,ar}/documents | search by document number, counterpartyId, status, page, pageSize. Returns paginated records, counterparty label and originalAmount. | Fixed descending accounting date. Balances and approval history are detail/report fields. |
| GET /{ap,ar}/documents/:id | Returns header, control account, counterparty, lines, originalAmount, outstanding, financialState, allocations, adjustments, approvals, relatedRecordsLimit. | Related evidence capped at 500 per collection. |
| POST /{ap,ar}/documents and PATCH /{ap,ar}/documents/:id | counterpartyId, controlAccountId, documentNumber, sourceReference, recognitionBasis, documentDate, accountingDate, dueDate, optional accrualDraftId, lines of accountingAccountId, description, amount, nullable accountingFundId/eventCampaignId. PATCH adds expectedRevision. Returns serialized draft. | Side management. Edit by owner of current DRAFT. 1–200 positive exact lines, compatible active party and accounts, evidence 10–1000 chars, due date on/after document date. |
| GET /{ap,ar}/settlements | search by settlement reference, counterpartyId, status, page, pageSize. Returns paginated rows and reconciliationState. | Fixed descending settlement date. |
| GET /{ap,ar}/settlements/:id | Returns settlement, bank and GL account, counterparty, linked bank/statement, allocations and reconciliationState. | Approval history is available through the separate approvals API by request ID. |
| POST /{ap,ar}/settlements and PATCH /{ap,ar}/settlements/:id | counterpartyId, bankAccountId, bankGlAccountId, settlementReference, sourceReference, settlementDate, amount, nullable bankTransactionId, allocations of accountingDocumentId and allocatedAmount. PATCH adds expectedRevision. Returns serialized draft. | Side management and owner/current DRAFT on edit. Active IDR bank and asset/debit GL account. 1–100 unique recognized same-party documents. Amount equals allocated total. Backend rechecks live outstanding, chronology and bank reservation. |
| POST /{ap,ar}/{documents,settlements}/:id/submit | expectedRevision. Returns approval request. | Side management, owner, current draft, independent reviewers and valid accounting period. |
| POST /{ap,ar}/{documents,settlements}/:id/post | approvalRequestId. Returns posted journal. | ACCOUNTING_JOURNAL_POST, matching independently approved request, valid current digest/period and live financial checks. |
| POST /{ap,ar}/{documents,settlements}/:id/cancel | expectedRevision and reason. Returns VOID and no financial journal. | Side management and owner/current DRAFT. Retains audit. |
| POST /{ap,ar}/{documents,settlements}/:id/reversal-requests | accountingDate and remark. Returns JOURNAL_REVERSAL approval. | Side management, recognized/posted source, chronological/date/dependency checks. |
| POST /ar/documents/:id/adjustments | adjustmentReference, accountingDate, adjustmentKind INCREASE/DECREASE, amount, offsetAccountId, reason. Returns approval request. | AR management, recognized source, exact amount and reason 10–500 chars. |
| POST /{ap,ar}/settlements/:id/match | bankTransactionId and remark 1–500 chars. Returns updated detail. | ACCOUNTING_SETTLEMENT_MATCH, posted unreversed source, real imported mutation of same bank/currency/exact signed amount. A repeated same link is idempotent. A replacement or duplicate active recognition is rejected. |
| GET /{ap,ar}/{outstanding,aging} | required asOf, optional counterpartyId, page/pageSize. Returns nonzero rows, aggregate outstanding, negativeBalanceCount and aging buckets. | Both endpoints use the same historical posted evidence. Backend totals cover all matching rows, even when paginated. |
| GET /approvals and /approvals/:id | status/page/pageSize for actor-scoped queue. Detail returns decision metadata, assigned approvers, source and history. | Source manager/assigned reviewer/authorized poster as defined by the approval service. Document/adjustment source is {document, adjustment}. Settlement source is {settlement}. Reversals expose original and payload. |
| POST /approvals/:id/decision or /cancel | decision and nullable remark, or required cancellation remark. | Existing independent assigned reviewer or authorized cancellation rules. |
| POST /approvals/:id/post | No body. Returns applied result. Used for approved adjustment/reversal. | Existing POST grant and digest/version checks. |
| GET /coa, /periods/fiscal-years, /options, /funds | Existing account search/page, periods, bank/campaign choices and paged fund catalog. | Report access. No COA, period or fund mutations are needed here. |
| GET /api/reconciliation/transaction-inquiry/workspace | DAY date or MONTH month, bankAccountId, status, search, page/pageSize. Returns transactions and pagination. | RECON_TRANSACTION_INQUIRY. Only actual imported candidates are shown. Backend match endpoint performs final eligibility checks. |
| GET /api/reconciliation/transaction-inquiry/:transactionId | Returns transaction, statement and history. | RECON_TRANSACTION_INQUIRY. Settlement detail shows matching events for its own ID from accounting_settlement_active history. |
| GET /journals/:id | Existing immutable journal detail. | Report access. |

Amounts on writes are decimal strings with up to 18 integer digits and two decimal places. Date inputs use calendar dates, IDs use UUIDs and list pages have a maximum size of 100. Invalid payloads, forbidden actions, absent records and financial conflicts follow existing HTTP 400/403/404/409 responses. Transaction locks and uniqueness constraints remain the authority for replay, concurrency, bank reuse and stale approvals. The client does not automatically retry a mutation.

No document list sorting or date/due-date filtering contract, global approval queue, unapplied settlements, post-matching unlink, independent allocation rewrite, AP/AR export or standalone settlement audit endpoint exists. The implementation uses explicit scope notes and the existing approval and bank lifecycle instead.

## A. Implementation

- Payables and receivables each have a list, new draft, UUID detail and edit view. Settlement list, new settlement, settlement detail, Outstanding and Aging are subviews under the same two workspace tabs.
- Counterparties has a shared list, create/edit modal and UUID detail. Related AP/AR links apply the backend counterparty filter.
- The Accounting Overview links to AP/AR. The existing sidebar entry, AppShell and WorkspaceTabs manage permissions, navigation and active state. Browser history uses the actual subview URL.
- The workspace uses the shared PageHeader, Card, DataTable, Modal, Button, fields, status badges and Accounting feedback. Existing Accounting CSS tokens and scroll containers style its pages.
- Typed writes and response contracts live in the AP/AR feature. Reads reuse the Accounting cache, cancellation and retry hooks. Source action confirmation and the existing mutation lock prevent a second concurrent submission.

## B. Accounts Payable

Users can save an invoice draft with its vendor, dates, liability control account, expense or asset offsets and supporting evidence. The owner can revise it using the current revision. The source opens its approval records and ledger evidence. Posting uses the AP source endpoint and the approved request ID.

Payments allocate the exact amount across recognized invoices for one vendor. The allocation table displays the backend as-of outstanding beside each selected document. Integer-cent input checks detect an allocation above the displayed outstanding, a mismatch against the payment total and invalid amount precision. The backend performs the final live-balance and chronology checks. An existing draft retains its previous allocations for revision, with the authoritative save/post checks covering documents outside the loaded outstanding page.

Invoice details show original and backend posted outstanding, approval records, related payment allocations and the journal link. Outstanding and Aging show backend totals and bucket definitions. The allocation history cap does not affect those totals.

## C. Accounts Receivable

The AR workflow requires explicit recognition evidence and a valid asset control account with revenue or liability offsets. An approval reviewer sees the source evidence, line amounts and version before deciding. The existing posting service owns financial recognition.

Receipts share the settlement allocation workflow with the AR endpoint and debtor scope. Partial receipt and further receipts use separate source references and independent approvals. The AR document includes adjustment history, and the authorized adjustment action sends the backend adjustment contract. Adjustment application and reversal use Accounting Approval and the linked journal.

Both subledgers show financial state and approval state separately. Posted documents and settlements use reversal requests. Unposted draft withdrawal retains the backend audit reason and VOID state.

## D. Bank integration

- Settlement posting can omit a bank link. The returned AWAITING_STATEMENT status remains visible until the existing match workflow links imported evidence.
- The matching form accepts an existing transaction UUID. With Transaction Inquiry access it offers actual day/account-scoped candidates of the exact signed amount, with pagination. The server checks eligibility, exclusions, bank reservations and duplicate recognition.
- Linking preserves the bank lifecycle and displays MATCHED_PENDING_FINALIZATION while the transaction or statement awaits finalization. Linked evidence includes bank reference, date, amount and statement status. Matching history is permission-gated through Transaction Inquiry.
- Source revision, separate approval/post requests, exact input and the one-request mutation lock complement the backend transaction, digest and replay checks.

## E. Permissions

| Operation | Existing permission and scope |
| --- | --- |
| View AP/AR and counterparties | ACCOUNTING_REPORT |
| Create/edit counterparty | ACCOUNTING_AP_MANAGE or ACCOUNTING_AR_MANAGE |
| Create, revise, submit or withdraw AP/AR draft | Matching AP/AR management grant and source owner/current draft where required |
| Approve or reject | ACCOUNTING_JOURNAL_APPROVE, assigned independent reviewer |
| Post or apply an approved request | ACCOUNTING_JOURNAL_POST |
| Request AP/AR reversal or AR adjustment | Matching AP/AR management grant and eligible source |
| Link imported bank transaction | ACCOUNTING_SETTLEMENT_MATCH |
| Browse bank candidates and matching history | RECON_TRANSACTION_INQUIRY |

The server remains authoritative for 403 responses and current grants. The approval page can open a known request ID for authorized posters whose actor-scoped queue omits it. Grant assignment and independent approver setup remain operational prerequisites.

## F. Validation

| Check | Result |
| --- | --- |
| Frontend TypeScript | PASS |
| Next.js production build | PASS |
| Full browser suite against production build | 60/60 PASS, including 13 AP/AR scenarios and 47 existing regressions |
| Backend unit and regression suite | 500/500 PASS |
| Existing Accounting contract source parity | PASS |
| Git diff check | PASS |
| ESLint | Unconfigured |
| Live authenticated DEV API | Pending. The configured local backend port 4000 had zero listeners. |

Browser scenarios cover counterparty create/edit and related document filters, AP/AR document create/revise, exact-decimal validation, separate approval and posting, requester independence, rejection, withdrawal, source version and digest conflicts, closed periods, settlement draft revision, partial and full payment/receipt, multi-document allocation, over-allocation, as-of balances, imported-bank matching/history, adjustment/reversal application, forbidden responses and retry. Screenshot and scroll checks ran on desktop, tablet and mobile. Browser back/forward, workspace tabs, journal links, existing Overview, Core and Reports also ran in the suite.

Browser responses are synthetic, including mutation acknowledgements. This suite verifies frontend behavior, request shapes and response handling. Database transaction and concurrency evidence remains the earlier Stage 2.2 integration coverage. No database session was opened during this stage.

Initial browser failures came from interacting with similarly named controls before navigation finished and from a COA status locator matching both loading and success messages. The final suite waits for the correct form and locates the intended success message.

Logs, screenshots and preservation evidence are in D:/arya-tarray-change-records/AT-ST33-20261109-01-execution.

## G. Database and backend

The 673-file snapshot comparison found zero protected changes and zero missing files. The changes comprise 10 existing frontend files and 19 additions, including this document. Backend source, Prisma schema and protected environment/configuration files matched their baseline hashes. DEV/PROD database sessions, migrations, seeds, staging, commits and pushes recorded for this stage total zero.

## H. Remaining contract limits

- Document lists expose source headers and original amounts. Detail and report endpoints supply balance and approval evidence. The lists use the fixed server order and supported reference, party and status filters. Date/due-date filters and sort options need a backend contract.
- Counterparty classification and active state are visible. Directory search and pagination follow the existing API. Code, classification and Member link are create-time fields, while edits can update the name and active state.
- Settlements allocate the entire amount. Unapplied cash, standalone allocation rewrites and replacing an already linked bank transaction require a separate backend workflow.
- Document detail includes bounded related requests. Settlement approval detail can be reached through the returned request link or Accounting Approval. The backend has no source-scoped settlement approval listing or consolidated AP/AR audit timeline.
- The as-of report provides counterparty IDs, which link to directory detail. Journal links expose related reversal evidence. Bank options provide IDs and labels, and active IDR eligibility is checked on the server.
- Accounting policy and official reporting remain PENDING_POLICY. The UI surfaces the existing evidence requirements and backend lifecycle values.

## I. Verdict

**PARTIAL.** The frontend implements the existing AP/AR contracts for counterparties, drafts, approval, posting, partial/full settlements, multi-document allocation, bank evidence, reversal, adjustments and aging. The backend contract gaps in section H limit the requested workflow, and live DEV verification remains pending.
