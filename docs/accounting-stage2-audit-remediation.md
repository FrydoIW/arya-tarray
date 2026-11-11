# Stage 2 Independent Audit Remediation

Review date: **2026-11-08, Asia/Jakarta**. Scope: AT-AUD-01, AT-AUD-02 and AT-AUD-03 only, with a related asset-capacity fail-closed correction found during the requested limit review. Backend only. No physical schema/environment/policy change, PROD access, UI, new ZIP, commit or push.

## A. Fix results

| Finding | Result | Root cause and correction |
| --- | --- | --- |
| AT-AUD-01 — Closing approval scope | FIXED | The checklist counted the global PENDING/APPROVED queue. It now resolves accounting dates from typed existing source FKs and explicit command payload dates, scans requests in batches, and includes only unresolved work through the closing cut-off plus unknown-date exceptions. |
| AT-AUD-02 — CSV formula injection | FIXED | Formula protection previously applied only to column zero and missed whitespace/control prefixes. All text cells now use one quoting/sanitization utility; explicitly typed Decimal cells preserve their exact signed numeric strings. |
| AT-AUD-03 — Journal seal capacity | FIXED | The first 5,000 journals were audited and larger scopes failed closed. Verification now scans every journal with deterministic keyset batches in the caller's consistent transaction, verifies coverage/counts, and bounds retained failure evidence. It never substitutes partial coverage for PASS. |

The old Stage 2.6 document describes the pre-remediation global queue rule and 5,000-journal seal cap. This document supersedes those two implementation details; the original policy/official-reporting **PARTIAL** verdict is unchanged.

### AT-AUD-01: Cut-off and date resolution

`closing-approval.repository.ts` selects source evidence in batches of 200 requests, using Prisma's batched FK relation loading, not a query per request. It does not select/use `requestedAt`. All date choices mirror the existing approval adapters:

| Source kinds | Accounting date |
| --- | --- |
| MANUAL_JOURNAL, ADJUSTING_JOURNAL, ACCRUAL_DOCUMENT/ADJUSTMENT, ASSET_CHANGE/JOURNAL, FUND_COMMAND/JOURNAL, REPORTING_POLICY/SNAPSHOT | Matching typed journal draft's accountingDate; draft kind/source ID must match |
| AP_INVOICE, AR_DOCUMENT | Matching payable/receivable document accountingDate |
| AR_ADJUSTMENT | Explicit validated requestPayload.accountingDate, with matching receivable document; never original document date as fallback |
| SETTLEMENT | Matching settlementDate |
| JOURNAL_REVERSAL | Explicit validated reversal accountingDate, with matching original-journal link; never original journal date as fallback |
| PERIOD_CLOSE/REOPEN | Matching period endDate |
| YEAR_CLOSE/REOPEN | Matching fiscal-year endDate |
| SCHEDULE_SETUP/CHANGE/CANCEL | Matching schedule startDate and command action |
| SCHEDULE_TERMINATE | Explicit validated termination command accountingDate and matching schedule |
| SCHEDULE_PERIOD | Matching recognitionDate, validated within its actual linked period |
| ASSET_ACTIVATE | Acquisition source journal accountingDate |
| DEPRECIATION_RUN | runDate validated within its actual linked period |
| FUND_SETUP | Matching fund effectiveOn |
| FUND_RESTRICTION | Restriction effectiveOn or its explicit actual source journal date, as the existing adapter specifies |
| FUND_RELEASE | Explicit validated release accountingDate, with matching restriction |
| FUND_DESIGNATION | Matching designation effectiveOn |
| BANK_RECONCILIATION | reconciliationDate validated within its actual linked period |

PENDING and APPROVED-but-not-APPLIED requests both count. Source dates in the current period block with `UNRESOLVED_IN_PERIOD_APPROVAL`. Every unresolved earlier date, including prior fiscal years, blocks with `UNRESOLVED_PRIOR_PERIOD_APPROVAL`: an old obligation is not silently dropped at a fiscal boundary. Dates strictly after the cut-off are excluded. Unknown kind, missing/mismatched source, invalid/missing explicit date and inconsistent period linkage block with `UNKNOWN_SOURCE_ACCOUNTING_DATE`, retaining request/source IDs for investigation. There is no requestedAt inference or automatic unknown-date waiver.

Only the exact currently evaluated PERIOD_CLOSE or YEAR_CLOSE request for that root is excluded to prevent the command blocking itself. Other source kinds, including REPORT_SNAPSHOT, are evaluated. Operators must resolve/reject/cancel stale or unknown work through existing authorized workflows; this change does not rewrite decisions or digests.

The checklist now exposes relevant count, in-period/prior/unknown counts, rule text and up to 100 exception references with an explicit truncated-evidence flag. All requests are still evaluated when more than 100 exceptions exist. Irrelevant future requests and their diagnostic counts do not enter the close snapshot/digest. Creating/deciding such future requests therefore does not invalidate an already-reviewed earlier close merely by changing global queue size.

Existing Serializable closing/posting transactions, freeze state, source digest/version, independent approval, period locks and audit trail remain in place. Reopening still requires independent approval. Concurrent future submission/October close and unchanged-digest application are integration-tested.

### AT-AUD-02: CSV output security and precision

`backend/src/lib/csv.ts` defines explicitly typed text/Decimal cells and one serializer. Every cell is quoted; quotes are doubled and embedded commas/CR/LF remain inside its original field. Text starting with `=`, `+`, `-`, or `@`, including preceding whitespace or Unicode control/format characters, receives an apostrophe before the entire original value. Leading tab/CR/LF are also protected. No source value is changed in the database.

Only explicitly designated numeric columns bypass text formula protection, after strict signed-decimal-string validation. There is no number coercion, floating-point arithmetic, rounding or inference that arbitrary text is safe merely because it resembles a number. Negative amounts, plus-signed numbers, leading zeros and long precision are preserved in CSV bytes. Formula expressions in numeric cells are rejected. Spreadsheet software may still auto-convert large numeric strings according to its import settings; this fix preserves exact export text and does not promise spreadsheet precision beyond that application's numeric limits.

The financial export controller labels policy/status/exception/account labels as text, and actual financial values as Decimal. The same values remain strings in existing XLSX output. All relevant columns, not just the first, pass through the serializer. No other CSV implementation was found in backend source, so unrelated export refactoring was unnecessary.

### AT-AUD-03: Full coverage, bounded memory and consistent reads

`verifyPostedLedgerAudits` still receives the caller's existing Prisma transaction. Current report/closing callers use Serializable; RepeatableRead is also supported for a consistent read-only snapshot. The batching reader is not permission to invoke independent reads across transactions or under ReadCommitted. No new posting/approval engine, schema or audit backfill was introduced.

The verifier counts all journals through the date, reads `id > lastId ORDER BY id ASC LIMIT 200`, loads each batch's immutable header/lines and corresponding seals, and hashes every journal. It validates strict keyset progression, detects missing/duplicate seals and rejects coverage/count mismatch. Final valid=true requires zero errors and checked=total within the same snapshot. Empty scope is explicitly checked. Duplicate/missing boundaries cannot quietly skip work. Physical PK/uniqueness and additional reader checks both apply.

Memory retains at most one batch's journal evidence and corresponding seals, plus 100 diagnostic exceptions. Error count and checked count continue through every batch even after the diagnostic list is full. Existing posting line limits bound ordinary per-journal payload size. Seals are never fabricated for missing historical evidence and content hashes are unchanged. Missing/changed/duplicate seals produce failure rather than a balancing entry or bypass.

Snapshot tests show that a concurrent insert/tamper is excluded consistently from an already-established RepeatableRead snapshot; a new transaction sees both rows and detects the tamper. Closing continues to use Serializable locking, with existing posting/closing race tests retained. Snapshot verification is not a claim to have inspected changes committed after that snapshot.

### Other requested capacity checks

- **Cash-flow drilldown:** unchanged 5,000 in-scope journals; query requests 5,001 and throws 413 before returning a supposedly complete report if exceeded. It can still block a large reporting/closing scope; no limit increase or partial-PASS bypass was added.
- **Close asset evaluation:** unchanged 200 active assets; query requests 201 and checklist sets bounded=false/FAIL above capacity. No partial PASS.
- **Asset-category reconciliation:** requested review found an unflagged `take:1001` limit. It now reports `ASSET_CATEGORY_EVIDENCE_TRUNCATED`, severity ERROR, truncated=true and UNVERIFIED beyond 1,000 mappings. Actual 1,001-category TEST coverage proves even zero numeric differences cannot disguise partial evidence as BALANCED. This small guard is directly related to AT-AUD-03, not an expansion into asset redesign.
- **Other existing bounds:** COA 1,000; report account/fund groups 20,000; ledger fingerprint 200,000 lines; annual 250 dimension groups/500 journal lines; fund/designation/command caps remain. Larger scopes still require reviewed batching. Existing transaction timeouts can fail a very large full audit; a timeout is an error, never a partial PASS.

## B. Complete file list for this remediation

Modified existing files:

1. `backend/src/modules/accounting/finalization/closing.service.ts`
2. `backend/src/modules/accounting/finalization/finalization.controller.ts`
3. `backend/src/modules/accounting/finalization/reconciliation.service.ts`
4. `backend/src/modules/accounting/ledger/ledger-audit.ts`
5. `backend/tests/run-tests.ts`
6. `backend/tests/integration/run-tests.ts`

New files:

7. `backend/src/modules/accounting/finalization/closing-approval.repository.ts`
8. `backend/src/lib/csv.ts`
9. `backend/tests/accounting-audit-remediation.test.ts`
10. `backend/tests/helpers/audit-journal.ts`
11. `backend/tests/helpers/read-csv.ts`
12. `backend/tests/integration/audit-remediation-flow.test.ts`
13. `docs/accounting-stage2-audit-remediation.md`

The larger existing Git diff contains prior uncommitted Stage 1–2.6 work. It is not all attributable to this remediation. In particular Prisma schema, `.env`, `.gitignore`, AGENTS.md, frontend and previous changes were preserved. `finalization.schema.ts` and existing approval adapters were reviewed and required no edit.

## C. Test results

Final results are recorded with the execution evidence outside the repository; all writing tests use exact isolated `arya_tarray_test` preflight before application import.

| Check | Result |
| --- | --- |
| Unit/regression suite | **500/500 PASS**, zero skipped (baseline432 +68 new) |
| Full Stage2.1–2.6 integration plus remediation | **174/174 PASS**, zero skipped (baseline165 +9 new) |
| Focused remediation integration | **9/9 PASS** |
| Closing/date unit coverage | 31 existing kinds plus malformed/missing/unknown/link/cut-off cases; 5 physical workflow tests |
| CSV security unit coverage | 27 tests, including first/second/last columns, Unicode hidden prefixes, tab/CR/LF, quoting, commas, normal text, signed and long-precision decimals |
| CSV endpoint integration | Actual HTTP download with9 formula/normal policy variants, first-column account label, last-column negative amount, wire quoting and unchanged source metadata |
| Audit capacity unit coverage | 0/1/5,000/5,001, first/last tamper, missing/duplicate seals/boundaries, coverage changes, idempotency, bounded errors |
| Audit capacity physical TEST | Exact0/1/5,000/5,001 verified, first/last tamper, missing last seal, repeated verification and concurrent snapshot changes |
| Other capacity TEST | 1,001 asset categories remain UNVERIFIED, never false BALANCED |
| TypeScript | Backend, integration, frontend and newly added unit tests PASS |
| Prisma validate | PASS; no generate needed because schema is unchanged |
| Physical contract/fixture cleanup | DEV/TEST61 tables, schema metadata unchanged, all baseline table row counts preserved |

No browser UI tests, application build, production-server/MySQL8.4 test, migration, seed or official policy validation was run. This is backend remediation without frontend change; frontend TypeScript was checked. Direct DEV checks are read-only. No tests were skipped inside the executed suites.

## D. Database and safety

No DDL, Prisma schema edit, migration, reset, seed or DEV data write. DEV and TEST remain **61 tables /29 Accounting models /800 scalar fields /396 physical indexes /132 enforced CHECKs**. The recorded physical metadata fingerprint remains unchanged. All temporary capacity journals/categories/actors/2027 fiscal configuration were synthetic TEST fixtures and were cleaned; all baseline row counts and fiscal configuration were restored.

No PROD connection. `.env`, credentials, `.gitignore`, AGENTS.md, frontend and cutover `2026-10-01` were unchanged. No new startup guard, COA/policy decision, role grant, UI, Stage3, ZIP, git add/commit/push. No operational DDL record was required because this remediation performs no structural change. Execution logs/hashes are outside the source repository and contain no reported credentials.

## E. Remaining risks and readiness

AT-AUD-01/02/03 are fixed within the documented transaction/capacity contracts. Unknown/prior approvals intentionally require operator resolution and can still block closing; there is no automatic waiver. Remaining cash-flow/asset/report bounds fail closed as described. MySQL8.0.42 was the verified server; deployment target8.4 remains unverified. Database-held hashes remain diagnostics, not external WORM evidence against a privileged administrator changing both journal and seal.

Actual Accounting policy readiness and official reporting remain **PARTIAL / PENDING_POLICY**: complete COA, statement/functional/restriction/cash mappings, actual opening evidence, annual transfer accounts, framework adoption, substantive recognition/depreciation/donor policy and operational evidence require authorized decisions. Nothing was changed to force VERIFIED or official readiness.

## F. Final verdict

**Remediation COMPLETE:** both required P2 fixes and the optional audit-capacity fix are implemented and regression-tested. **Stage2.6 policy readiness/official financial reporting remain PARTIAL**. This code result does not certify operational Accounting readiness or official financial statements.
