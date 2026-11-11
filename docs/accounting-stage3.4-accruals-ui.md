# Accounting Stage 3.4 — Accruals and recognition schedules

## API inventory

Contracts reviewed in schedule.routes.ts, schedule.controller.ts, schedule.schema.ts, accrual.service.ts, schedule.service.ts, schedule.workflow.ts, schedule-approval.service.ts, schedule.repository.ts and the Stage 2.3 integration scenarios. Paths below use the /api/accounting prefix. All require ACCOUNTING_REPORT. Management endpoints use ACCOUNTING_JOURNAL_MANAGE, application uses ACCOUNTING_JOURNAL_POST and independent decisions use ACCOUNTING_JOURNAL_APPROVE.

| Method and path | Payload, query and response |
| --- | --- |
| GET /accruals | page/pageSize. Rows are original accrual drafts with accrualMetadata, revision and postedJournalId. The service does not apply text, kind or status filters. |
| POST /accruals, PATCH /accruals/:id | sourceReference, accountingDate, exact amount, recognitionAccountId, balanceAccountId, nullable counterpartyId and metadata. Metadata contains kind ACCRUED_EXPENSE or ACCRUED_INCOME, serviceStart/serviceEnd, supportingEvidence, policyReference, recognitionBasis and nullable scheduledReversalOn. PATCH adds expectedRevision and requires the owner's DRAFT. Returns the persisted draft. |
| GET /accruals/:id | Header, metadata, balance/recognition lines, originalAmount, recognized, cleared, remaining, controlReconciliation, reconciliation state, posted/reversal journal, clearing documents, adjustments and approval history. Related collections capped at 240. |
| POST /accruals/:id/adjustments | sourceReference, accountingDate, positive amount, INCREASE/DECREASE, reason. Returns a separate adjustment draft. |
| POST /accruals/:id/submit, /post, /cancel | Submit expectedRevision for original or adjustment. Post approvalRequestId for the matching source. Cancel expectedRevision and reason for the owner's unposted original. |
| GET /accruals/scheduled-reversals | asOf, page/pageSize. Returns marked due unreversed IDs and scheduled dates, without a total count. |
| POST /accruals/:id/scheduled-reversal, /reversal-requests | Scheduled sends remark and uses stored date. Manual sends accountingDate and remark. Both return a JOURNAL_REVERSAL approval. |
| POST /schedules/preview | amount, startDate, endDate, allocationMethod, optional customPeriods. Returns same scope plus generated periods and postingAutomatic false. Read-only despite POST. |
| GET /schedules | page/pageSize. Returns schedule headers and total. Kind and status filters are not applied by the service. |
| POST /schedules | Plan input plus scheduleReference, PREPAYMENT/DEFERRED_INCOME, sourceJournalLineId, recognitionAccountId, policyEvidence and recognitionBasis. Returns DRAFT and full persisted plan with actual source journal link. Backend infers any AP/AR document ID. |
| GET /schedules/:id, /schedules/:id/periods | Detail provides raw period rows, original source, termination and reversal journals, backend recognized/terminated/remaining, reconciliation, policy status and up to 500 approvals. Periods endpoint returns the full period array. |
| POST /schedules/:id/requests | expectedRevision and command. SETUP activates after approval. CHANGE provides exact existing unposted periods and reason. CANCEL provides reason. TERMINATE provides accountingDate and reason. Returns approval. |
| POST /schedules/:id/apply | approvalRequestId. SETUP/CHANGE/CANCEL return nonfinancial application evidence. TERMINATE returns journal. |
| GET /schedule-periods/:id | Returns {row, schedule}. |
| POST /schedule-periods/:id/submit, /post | Submit expectedRevision of parent plus recognitionEvidence for deferred income. Post approvalRequestId for the period. |
| GET /approvals/:id and POST /decision, /cancel, /post | Existing approval detail and actions. Accrual source is serialized draft. Schedule command source is schedule. Period source is {row, schedule}. Submitted requestPayload.snapshot preserves material evidence. Generic approval post applies reversals. |
| GET /journals/:id, /coa, /periods/fiscal-years, /counterparties | Existing source journal and line evidence, account picker, fiscal coverage and optional counterparty picker. |
| POST /{ap,ar}/documents, GET /{ap,ar}/documents/:id | Stage 3.4 clearing creates a separate AP/AR draft carrying accrualDraftId and the actual balance account on its line. The existing AP/AR workflow owns approval and settlement. Detail exposes authoritative outstanding and allocation history. |

Amounts are positive decimal strings with up to 18 integer digits and two decimals. Period allocations contain accountingPeriodId, recognitionDate and plannedAmount. The three methods are MONTHLY_EQUAL, ACTUAL_DAYS and CUSTOM. The backend validates configured coverage, unique periods, exact allocation totals, source capacity, chronological activity, owner, OPEN period and current approval digest. Schedule lifecycle is DRAFT, ACTIVE, COMPLETED, CANCELLED or TERMINATED. Recognition/reversal evidence is attached to actual journals.

The service has no direct schedule PATCH. Plan changes use the approved CHANGE command. Reversal requests retain an originalJournalId rather than the accrual's journalDraftId, so accrual detail does not list all pending reversal requests. The posted reversal ID and the returned request link provide separate evidence.

## A. Implementation

| Workspace | Frontend routes |
| --- | --- |
| Accrued expenses and income | /accounting/accruals, /accounting/accruals/new, /accounting/accruals/[id] |
| Scheduled reversals | /accounting/accruals/reversals |
| AP/AR accrual clearing | /accounting/accruals/[id]/clearing |
| Prepayments and deferred income | /accounting/schedules, /accounting/schedules/new, /accounting/schedules/[id] |
| Independent approval and journal evidence | Existing /accounting/approvals and /accounting/journals |

The Overview module links to Accruals. The Accounting navigation includes Accruals and Schedules, both inside the existing AppShell and WorkspaceTabs. Both pages reuse CorePage, Card, shared lookup fields, Modal, Button, and horizontally scrollable tables. Typed writes use apiFetch, while reads use the existing core request cancellation, cache and retry behavior. A posted journal can open the schedule form with its ID selected.

## B. Workflows

- **Accrued expenses and income.** Capture a service window, accounting date, exact amount, classified accounts and supporting evidence. A draft owner can revise with expectedRevision. Accrued income requires evidence of an earned right and exposes no conversion action from campaign targets, TIME_BASED commitments or pledges. Approval is submitted separately. Adjustment creates another draft whose lines and reason are available in its approval snapshot. Posted sources remain immutable.
- **Prepayments and deferred income.** Select an actual unreversed posted source line and recognition account. View the backend plan before saving. MONTHLY_EQUAL and ACTUAL_DAYS use backend allocation and rounding. CUSTOM validates period/date membership, uniqueness and exact cents totals before requesting a preview. Deferred income requires liability and policy evidence, with explicit fulfillment evidence for each period. Donor restrictions remain a separate concept.
- **Schedule management.** SETUP, CHANGE and CANCEL use separate approval and authorized nonfinancial application. CHANGE revises only existing unposted allocations. TERMINATE and recognition periods require independent approval and financial posting. The page shows all returned periods and marks the earliest eligible unposted row for review when its accounting date is OPEN. Backend validations also cover chronology, source capacity and previously posted rows. Amounts, reversal evidence and status are refreshed from source detail.
- **Reversal.** Use the opt-in due list and stored accounting date for scheduled reversals. Manual reversal uses a user-entered date. Both require a reason and confirmation, with a separate authorized posting step in Accounting Approval. The detail shows original and posted reversal journal links. The journal screen can request reversal for a posted accrual adjustment, schedule recognition or termination.
- **AP/AR clearing.** An authorized AP/AR user can start a draft with the original accrual balance account as its only offset line. If the accrual specifies a counterparty, it carries into the draft. Original, recognized, cleared and remaining amounts come from the accrual detail. Each clearing row links its document and recognition journal. Inspect settlement loads that document's authoritative outstanding amount and returned allocations on demand. Schedule sources link an AP/AR document when the backend returns its ID and journal source kind. Stage 3.3 workflows own review, posting and settlement.

## C. Permissions and accounting safety

- ACCOUNTING_REPORT gates the workspace. Journal management gates Stage 2.3 drafts and requests. AP or AR management gates creation of the corresponding clearing draft. Assigned independent approval and authorized posting use separate grants. Requesters cannot approve or reject their own requests.
- Approval detail shows the stored version, digest, source snapshot and retained decisions. The client compares available revisions, and the backend verifies the live digest, current authorization and approval state when deciding and applying.
- Financial posting checks the configured fiscal year and period in the UI before confirmation. The backend repeats financial validation at execution. SETUP, CHANGE and CANCEL use their nonfinancial application contract.
- In-flight mutation locking, explicit confirmations, and returned journal evidence guard repeat submission. API conflicts stay visible, and the client does not automatically retry mutations. The UI never computes a parallel GL or balance.
- PENDING_INDEPENDENT_REVIEW is the schedule backend's setup state. A reviewed schedule and a matched GL balance do not certify accounting policy or official reporting readiness. COA policy, reporting mapping, annual closing and opening evidence still require authorized review.

## D. Validation

The browser fixtures intercept Accounting and authentication requests and return synthetic records. They exercise the production Next.js build, real routing, frontend permissions, payload serialization, and confirmation and error states. They do not prove database posting or reconciliation. Responsive checks use 1440×1000, 820×1180 and 390×844 viewports. The mobile allocation table scrolls inside its region and the workspace fits the viewport. No separate ESLint configuration is present.

| Check | Result |
| --- | --- |
| Frontend TypeScript | PASS, npx tsc --noEmit --incremental false |
| Next.js production build | PASS, npm run build |
| Browser against production build | 87 passed, including 27 Stage 3.4 scenarios and 60 existing regressions |
| Backend unit tests | 500 passed, npm test |
| Responsive schedule detail | PASS, desktop, tablet and mobile screenshots and scroll checks |
| Whitespace check | PASS, git diff --check |

Browser coverage includes the three preview methods, explicit recognition evidence, linked clearing and settlement, independent approval, stale revision, CLOSED period, forbidden responses, duplicate posting/reversal rejection, and failed form submission with inputs retained. Existing Overview, Core, AP/AR, Reports and navigation tests passed.

## E. Backend and database

The backend DEV port 4000 had no listener during validation. Live DEV reads and database end-to-end flows were not verified. Browser tests intercepted API traffic. There were no database connections, financial DEV writes, PROD access, schema changes, migrations or seeds in Stage 3.4. A 692-file hash comparison found edits only to frontend source, browser tests and the new report. Backend source, Prisma schema, environment files, AGENTS.md and .gitignore matched the baseline.

## F. Remaining risks

- **List search.** The Stage 2.3 list endpoints paginate but do not apply search, kind or status filters. The UI labels these as current-page filters.
- **Draft schedule editing.** The backend supports approved changes to existing unposted allocations. It offers no general schedule header or date-range PATCH after creation.
- **Reversal and adjustment history.** Original accrual detail supplies reversal journal evidence and original-draft approval records. It does not expose a comprehensive reversal request lookup by original journal or all adjustment-specific approval IDs. Users can follow the returned approval ID, their Accounting Approval queue or the adjustment journal. The schedule detail caps approval history at 500 and accrual detail caps related records at 240.
- **Related payments.** The schedule source can expose a journal line and an inferred AP/AR document ID. Settlement evidence remains available through the linked Stage 3.3 document, where applicable. The schedule contract does not provide a separate settlement ID.
- **Stage 3.3.** Its verdict remains PARTIAL with the documented limits in [the Stage 3.3 report](accounting-stage3.3-ap-ar-ui.md). Accounting policy and official reporting remain pending authorized review.

## G. Final verdict

**PARTIAL.** The supported Stage 2.3 workflows are integrated with the existing Accounting UI. Server-wide list search, unrestricted draft schedule edits, comprehensive accrual reversal history and live backend validation remain limited as described above.
