# Accounting Stage 2.3 — accruals and schedules

**Status: COMPLETE for the requested backend scope.** No frontend, automatic cron, second posting/approval engine, Fixed Assets, Fund Accounting or Financial Reports module was added.

## Implementation and posting rules

`backend/src/modules/accounting/schedules/` contains input validation and exact schedule calculations, repository queries, accrual/schedule/workflow services, approval/posting/reversal adapters, and thin controllers/routes. Existing Route → Controller → Service → Repository → Prisma architecture and centralized journal persistence remain authoritative.

Accrual documents reuse `AccountingJournalDraft` and its two balanced lines. Typed JSON metadata records ACCRUED_EXPENSE/ACCRUED_INCOME, service dates, supporting evidence, adopted policy reference, recognition basis and optional scheduled reversal date. An accrual adjustment is a separate reviewed draft with a physical parent FK. Document revisions supersede unused approval; posted source and journal have no edit/delete API. Approval snapshots preserve material metadata and financial lines for audit after draft revisions.

| Operation | Debit | Credit |
| --- | --- | --- |
| Accrued expense | Selected expense | Selected accrued liability |
| Accrued income | Selected accrued asset | Selected revenue |
| AP clearing an expense accrual | Actual accrued liability | AP control |
| AR clearing an income accrual | AR control | Actual accrued asset |
| Prepayment amortization | Selected expense | Actual prepaid asset |
| Deferred income recognition | Actual deferred liability | Selected revenue |

INCREASE/DECREASE adjustments use the original account pair, with reversed sides for decreases, and their own approved journal. Decreases and adjustment reversals cannot over-clear remaining accruals. Accrual/AP/AR activity is chronological and concurrent clearing claims are revalidated under a parent lock/Serializable transaction.

An AP/AR document can specify `accrualDraftId`. Its lines must clear that actual accrued balance, with compatible kind/counterparty and amount no greater than remaining accrual; its control account must be distinct. This is the supported direct clearing method: expense/revenue is recognized once, then reclassified into AP/AR. Invoice differences can first be handled by a separately approved accrual adjustment. Multiple invoices may partially clear one accrual; a document links one accrual. Invoice lines outside that clearing account belong in separately supported documents/adjustments, not a hidden second recognition.

AP/AR partial/full payments and bank matching retain Stage 2.2 behavior. A separately approved original reversal followed by a normal invoice is also an explicit operator workflow; no automatic combined reversal/invoice operation is inferred. Active clearing documents and adjustments block unsafe original reversal. Accrual details expose recognized, cleared and remaining balances, UNPOSTED/OUTSTANDING/RESOLVED/REVERSED state, related source evidence and GL reconciliation.

## Prepayments, deferred income and schedule methods

Prepayment/deferred documents reuse `AccountingSchedule` and `AccountingSchedulePeriod`. Creation requires an actual unreversed posted GL balance line. That line may come from an existing AP prepaid-asset invoice, AR deferred-liability document, or separately approved existing manual journal. Source AP/AR linkage is inferred from the actual recognition journal. Creating a schedule never creates a payment, receipt or BankTransaction.

The sum of reserved/consumed schedule capacity cannot exceed the source line. Cancellation releases only the unused capacity; prior valid recognitions still consume their share. Dates cannot consume a balance before its original/source activity or a later reversal restoration.

Methods:

- `MONTHLY_EQUAL`: equal allocation across configured accounting periods intersecting the service range. A partial first/last period receives an equal share under this explicitly chosen method.
- `ACTUAL_DAYS`: allocation weighted by inclusive covered days, including partial periods and leap days.
- `CUSTOM`: explicitly supplied period IDs, recognition dates and positive decimal amounts.

All money calculations use integer cents/Decimal. Weighted/equal allocations first take exact floor cents; residual cents go to the earliest periods in stable chronological order. The periods sum exactly to the original amount. Tiny totals that cannot allocate at least one cent per period are rejected. There is one planned recognition per configured accounting period and a maximum of 240 periods.

Generation validates configured period coverage and rejects gaps/overlaps or missing future periods. It never creates fiscal years/periods. Custom dates must lie in both their selected accounting period and the service range. Cutover `2026-10-01` is respected.

## Policy, approval and lifecycle

No pledge, subscription, fundraising target, donor restriction or campaign allocation automatically becomes an accrual/deferred liability. Recognition depends on explicit substantive evidence and policy reference, reviewed by an independently authorized person. The software validates structure/accounting invariants; it does not authenticate evidence or adopt organization-wide accounting policy.

Schedules begin DRAFT / PENDING_INDEPENDENT_REVIEW. Existing Accounting Approval authorizes SETUP before activation. Each financial period needs its own current independent approval and POST permission. **Deferred income additionally requires `recognitionEvidence` proving the underlying period's performance obligation was fulfilled.** Calendar passage alone cannot submit that workflow successfully.

SCHEDULE_SETUP/CHANGE/CANCEL apply an approved nonfinancial command without fabricating a zero journal. They use the same persisted request, assigned approvers, source digest/version, self-approval prevention and APPLY history. Financial recognition/termination and accrual documents/adjustments go through the common GL approval/persistence gate, including internal callers.

Earlier unposted periods must execute first. Duplicate/concurrent execution creates exactly one source journal/application. CLOSED periods reject submission/posting; execution never silently changes dates. When all periods are recognized, the schedule becomes COMPLETED.

CHANGE redistributes the exact remaining amount across the existing unposted periods, preserving posted period evidence and original service range. It increments revision, retains the approved old/new plan snapshot and supersedes pending schedule/period approval in batches. To extend/rebuild the period range, cancel unused coverage and create a new reviewed schedule against available source capacity.

CANCEL stops future recognition and retains the unamortized asset/deferred liability. TERMINATE is a separate approved financial action recognizing the exact remaining amount into the selected expense/revenue account, with explicit reason/evidence. It does not manufacture a cash refund. Refunds, contractual liability releases or other treatments require their appropriate separate approved workflow rather than an inferred termination rule.

Reversal appends exact compensating lines and retains originals. Original source journals cannot be reversed while schedules reserve/consume them. Later schedule recognitions/termination must be resolved before reversing earlier recognition. Recognition reversal cancels future schedule execution; termination reversal restores the balance and cancels future execution. Historical period/source links and approval evidence remain available. A fresh reviewed schedule is required to recognize restored/unallocated capacity; the old period is never posted twice.

Scheduled reversal is opt-in metadata plus an explicit due-list/request workflow. Only marked posted accruals qualify for the scheduled endpoint. The stored date and original journal reference are used, then existing independent approval and OPEN-period posting apply. An unmarked accrual is not automatically reversed. A closed configured date requires explicit accounting review and a new authorized manual reversal date; no background job or silent rescheduling writes to DEV.

## Backend API

Prefix: `/api/accounting`; existing authentication, active-user and `ACCOUNTING_REPORT` checks apply. Management/submission uses `ACCOUNTING_JOURNAL_MANAGE`, decisions use existing assigned `ACCOUNTING_JOURNAL_APPROVE`, application uses `ACCOUNTING_JOURNAL_POST`. No user grants or approver assignments were changed automatically.

| Method/path | Purpose |
| --- | --- |
| GET/POST `/accruals` | Paginated list / create accrual source |
| GET/PATCH `/accruals/:id` | Detail/reconciliation / revise own unposted original |
| POST `/accruals/:id/cancel` | Withdraw current unposted original, audited reason |
| POST `/accruals/:id/adjustments` | Create separate INCREASE/DECREASE draft |
| POST `/accruals/:id/submit` | Submit original or adjustment ID and expected revision |
| POST `/accruals/:id/post` | Apply matching approved source |
| POST `/accruals/:id/reversal-requests` | Explicit dated independent reversal request |
| GET `/accruals/scheduled-reversals?asOf=YYYY-MM-DD` | Paginated due marked originals; no posting |
| POST `/accruals/:id/scheduled-reversal` | Request marked-date reversal with remark |
| POST `/schedules/preview` | Validate/preview exact plan, no persistence |
| GET/POST `/schedules` | Paginated list / create pending-review prepaid/deferred schedule |
| GET `/schedules/:id` | Source, plan, state, audit, remaining and GL reconciliation |
| GET `/schedules/:id/periods` | Bounded complete plan, maximum 240 periods |
| POST `/schedules/:id/requests` | Expected revision and SETUP/CHANGE/CANCEL/TERMINATE command |
| POST `/schedules/:id/apply` | Apply matching approved command |
| GET `/schedule-periods/:id` | Period/source details |
| POST `/schedule-periods/:id/submit` | Expected revision; recognitionEvidence required for deferred income |
| POST `/schedule-periods/:id/post` | Approved period journal/application |

Existing `/approvals/:id/decision`, `/cancel`, `/post` and detail/history routes handle all new sources. AP/AR input gained optional `accrualDraftId`. Strict request shapes are in `schedule.schema.ts` and existing approval/APAR schemas. Dates are date-only request strings, money is exact positive decimal strings and identifiers are UUIDs. Posted adjustments are read through their approval/source detail; adjustments submit/post using their own draft ID. Financial totals are calculated in bounded source queries and compared to actual GL evidence, never summed from paginated frontend rows.

## Database and approved execution

Record: `D:\arya-tarray-change-records\AT-ST23-20261105-01-APPROVAL-READY.md`, approved explicitly by the authorized owner: “Saya menyetujui patch DEV+TEST; catat dan eksekusi sekarang.” Separate APPROVED and COMPLETED receipts and execution evidence remain outside Git with access restricted to the current Windows account, Administrators and SYSTEM.

Executed SQL: `database/accounting-stage2.3-schedules.mysql.sql`.
SHA-256: `F9A8DF309D4942F61BD1E29C3FCFA669C5BC7E24C07219FA3B7D6E6097EB480C`.

Five ALTERs were applied once per exact DEV/TEST target after fresh backup and empty affected-table preconditions. Twelve fields and five FKs were added across existing draft, AP/AR document, schedule, schedule-period and approval-request tables; new/replacement CHECKs support typed approval and nonfinancial commands. **No table/model was added or removed: both targets remain 61 tables / 29 Accounting models.** No old migration replay, Prisma migrate/db push/pull/reset or startup provisioning occurred.

Read-only metadata verification matched all 717 scalar mappings/nullability/native types/lengths/precisions, 229 declared FK relations/actions, primary/unique/index contracts and 103 enforced physical CHECKs. There are 347 physical indexes. Normalized DEV/TEST metadata SHA-256 matches: `b90a2fff1a9bdf3bf36a3cb34aa56558b829ea3a251d80ff311f1d36d1b0de10`. Prisma was manually synchronized after approved DDL, generated and validated.

Verified pre-DDL DEV backup in automatically detected Downloads:

`C:\Users\Frydo\Downloads\arya_tarray_dev_pre_stage23_2026-11-05T16-50-29-954Z_167b67eb.sql.gz`

Size 17,193 bytes; SHA-256 `152cc8a22a5c7e6698ff1ffc3fbb6dded3e05b61ca95e92bfa86bc7aeffc511a`. Gzip/decompression, SQL completion and all 61 table definitions passed. The consistent snapshot requested routines/events/triggers and used quick streaming without table locks. No restore or external upload.

All existing DEV row counts are unchanged, including zero transaction fixtures/journals. TEST cleanup restored its exact original minimal baseline. Cutover remains `2026-10-01`, FY2026 remains OPEN January–December, and October/November/December periods remain OPEN. No extra fiscal periods were created. `.env` bytes are unchanged and ignored/untracked; AGENTS.md, .gitignore and frontend source were untouched by Stage 2.3. No PROD connection, startup guard, Git stage/commit/push or DEV financial seed occurred. Temporary administrator option credentials were removed.

## Verification and limits

- Unit/regression: **425/425 passed**, none skipped.
- Isolated MySQL TEST integration: **78/78 passed**, none skipped: all 58 earlier regression scenarios plus 20 Stage 2.3 scenarios.
- Backend/integration/frontend TypeScript and Prisma generate/validate: passed.
- Physical schema equality, DEV preservation, TEST cleanup and Git whitespace: passed.
- GL evidence: accrued expense/income clearing, partial/full AP/AR settlements, amortization/deferred completion, adjustments/reversals and termination preserve exact control balances without duplicate expense/revenue/cash. Source details expose GL reconciliation.

Tests include deterministic/partial/leap-day/custom rounding, explicit policy and performance evidence, approvals/self/unauthorized/stale/bypass rejection, duplicate/concurrent period posting and AP clearing, closed periods, scheduled opt-in reversal and duplicate reversal, atomic rollback of source/journal/approval/completion state, plan adjustment, cancellation/capacity release, source reversal protection, restoration-date chronology, HTTP contracts and full fixture cleanup.

No technical Stage 2.3 blocker remains. Authorized operators must configure the actual posting COA and named roles/independent approvers through existing mechanisms. Accounting policy/evidence require human review per document; no organization-wide recognition policy was invented. The configured DEV fiscal horizon currently ends December 2026, so a 2027 plan fails until future periods are separately authorized/configured. Direct manual GL changes outside source workflows require accountant review; source reconciliation does not silently reclassify them. Complex multi-accrual invoice/tax allocations, refund automation and later Accounting modules remain separate scope.
