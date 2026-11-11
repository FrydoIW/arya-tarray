# Accounting Stage 2.4 — Fixed Assets

**Verdict: COMPLETE for the implemented Fixed Asset backend, with the explicit policy/workflow limits below.** No frontend, cron, second GL/approval engine, Fund Accounting or Financial Reports module was added.

## Modules and lifecycle

`backend/src/modules/accounting/assets/` supplies input schemas, pure depreciation/disposal calculations, asset/source repositories, register/category/run services, adjustment/approval/reversal adapters, reconciliation aggregation, workflow services and thin controllers/routes. Existing authentication, active-user checks, REPORT/MANAGE/APPROVE/POST permissions, independent Accounting Approval, common ledger persistence and fiscal period control are reused.

The register uses existing AssetCategory/FixedAsset models. It records unique asset code, name/description, location, active custodian reference, vendor, source AP document, actual acquisition GL line, acquired/available/start dates, source-backed historical cost, residual, life, method, campaign/fund source dimensions, policy/evidence snapshot, revision and created/updated user/time metadata. AP payments and bank/account evidence are traced through the actual source journal and existing settlement allocations. No BankTransaction is fabricated.

Physical lifecycle: DRAFT → ACTIVE → DISPOSED/WRITTEN_OFF, with unactivated cancellation. REVIEW/APPROVED states live in the existing independent approval request rather than duplicate asset status fields. Only approved activation makes an asset ACTIVE. FULLY_DEPRECIATED is a derived financial state; cost/accumulated balances remain until disposal. Disposed and unactivated assets explicitly report stopped/unauthorized depreciation states.

Categories validate asset ASSET/DEBIT, accumulated ASSET/CREDIT/contra, expense EXPENSE/DEBIT, gain REVENUE/CREDIT, loss EXPENSE/DEBIT, optional impairment expense/contra and disposal clearing LIABILITY/CREDIT mappings. All accounts must be active posting accounts. A used or historically reviewed category cannot have its mapping overwritten; create a new category and use reviewed reclassification. No production COA/category/policy or role grants were seeded.

## Capitalization and source claims

An acquisition must reference an actual unreversed approved AP_DOCUMENT or MANUAL_JOURNAL asset debit. The original full source line belongs to one asset. Cost comes from that evidence, not an editable amount in the registration request. Activation is a nonfinancial approved register action: it never debits the asset or pays the bank again. Repeating an applied activation returns its prior application without duplicate financial posting.

AP purchases retain Stage 2.2 invoice/payment lifecycle; partial/full payments do not change acquisition cost. Approved manual acquisition/cash evidence uses existing Stage 2.1 journal workflows and actual configured bank accounts. An imported bank row alone is not an unreviewed capitalization shortcut.

An ADDITIONAL change claims a distinct actual AP/manual asset debit. It adds no second journal and updates source-backed historical cost only after independent approval. Original source, additional/disposal source and recognition-schedule claims are cross-checked under row locks. Reclassification/reversal/depreciation entries cannot masquerade as a fresh purchase. Cancelled unposted claims release only their live reservation; historical source IDs remain in approval snapshots/metadata.

Capitalization threshold and partial-month convention have **no inferred default**. A category may have no policy; registration remains DRAFT/PENDING_POLICY and activation fails. A supplied policy requires an adopted reference, explicit threshold, FULL_MONTH/NEXT_MONTH/ACTUAL_DAYS convention and impairment policy flags/reference. Asset activation independently reviews the source and that snapshot. Software does not invent or authenticate an organization-wide capitalization policy.

## Straight-line depreciation and runs

Only STRAIGHT_LINE is exposed. FULL_MONTH starts at the available-for-use month; NEXT_MONTH starts the following month; ACTUAL_DAYS starts on the actual available date and uses covered UTC date-only days through the calendar-month useful-life anniversary, exclusive of that ending anniversary. Policies are explicit and checked against the requested depreciation start.

Money uses integer cents/Decimal throughout. Allocations are differences between exact cumulative integer targets, so rounding is deterministic and terminal allocation reaches exactly cost less residual and impairment. No floating-point money, unexplained remainder, depreciation beyond basis/residual, or depreciation after disposal is allowed.

Runs select an existing complete calendar-month OPEN period/year and up to 200 explicit asset IDs. Preview is read-only. Run creation snapshots exact asset/version/policy/account evidence and reserves each asset/period. Each run needs independent approval and POST permission. Physical uniqueness of asset/active-period protects against duplicate runs, including concurrent selections. One journal posts all run expense/contra lines; actual journal-line IDs are mapped back to each asset/run row in one batch.

Only due positive amounts become run rows. Earlier due periods must be resolved before a later run or prospective change; no silent catch-up/backdating or future fiscal-period creation. Asset changes invalidate the live snapshot; refresh the DRAFT run, obtain approval of its incremented version, then post. CLOSED periods, stale/self/unauthorized requests and failed writes leave run, journal, line mapping and approval/application history unchanged.

POSTED runs have no edit path. Cancellation applies only to an owned DRAFT run and releases its live reservations with audit history. Approved reversal appends a compensating journal, marks the original run VOID and releases active slots while retaining original period/line evidence. Later asset activity must first be resolved. A replacement run is possible only when its explicit accounting date and current evidence remain valid; reversal never silently backdates it.

## Adjustments, impairment and disposal

Changes reuse typed AccountingJournalDraft metadata and existing approval history, with material source/current-asset/target-category snapshots. Informational CORRECTION is distinct from ESTIMATE, ADDITIONAL, RECLASSIFY, IMPAIRMENT and disposal. Posted depreciation is never rewritten.

- ESTIMATE changes remaining useful life/residual prospectively from an explicitly approved first-of-month date after earlier due depreciation is resolved.
- ADDITIONAL uses actual capitalized expenditure and recalculates future depreciation prospectively.
- CORRECTION audits name, acquisition-date information, description, location or custodian. It cannot silently rewrite historical cost, available-for-use policy or posted journals.
- RECLASSIFY moves actual cost, accumulated depreciation and impairment control amounts to the new reviewed mappings without changing carrying value. Source/target category evidence is digest-checked.
- IMPAIRMENT requires an adopted enabled policy, explicit recoverable amount, assessment evidence and independent approval. It debits mapped impairment expense, credits mapped contra allowance and resets future depreciation from the supported carrying amount. No recoverable-value estimate is generated.
- Valuation-based IMPAIRMENT_REVERSAL remains **PENDING_POLICY / unsupported** until an adopted framework and tested recovery ceiling are supplied. No recovery amount is posted. Ordinary approved reversal can correct an erroneous impairment journal before dependent activity and restores the previous depreciation plan; this is distinct from a valuation recovery.

Sale consideration must already be recorded once: an actual AR document credited to disposal clearing for unpaid proceeds, or an approved manual bank/cash debit credited to clearing. The disposal journal debits that actual clearing evidence, removes gross cost/accumulated/impairment and recognizes net gain/loss. It creates neither another receivable nor another bank payment/receipt.

Optional disposal costs must be evidenced by an actual approved AP/manual expense debit in the mapped loss account. Their existing expense is reclassified into the net gain/loss calculation so costs are not charged twice. Example verified: cost 12m, depreciation 8m, proceeds 5m, recorded costs 0.2m → net gain 0.8m. The loss case and zero-proceeds WRITE_OFF are also tested. Disposal/write-off atomically records its original journal/date and prevents depreciation. Independent reversal restores register/category/plan fields where applicable while retaining immutable journals and approval evidence.

## GL reconciliation

Read-only reconciliation aggregates actual source/run/change evidence on the server and compares it with **all GL lines in the mapped cost, accumulated, impairment and depreciation-expense accounts**, including compensating journals. Register cost/contra balances are zero after disposal; historical depreciation expense remains. Reclassification uses current register mappings and preserved historical account definitions.

Unregistered/pending acquisition debits and unrelated/manual GL activity remain visible as variance. Totals never come from paginated register rows. The result gives register amount, GL amount, variance and reconciliation status by role/account; no editable NBV or second GL balance is stored. Current acquisition-cost measurement can change only from approved actual capital-source evidence; displayed carrying value is derived from source cost, real posted depreciation, impairment and disposal.

## API

All paths are below `/api/accounting` and existing authentication/active-user/ACCOUNTING_REPORT checks. Writes/submission use ACCOUNTING_JOURNAL_MANAGE; application uses ACCOUNTING_JOURNAL_POST; independent decisions retain ACCOUNTING_JOURNAL_APPROVE and assigned approver checks. No permissions were granted automatically.

| Method/path | Purpose |
| --- | --- |
| GET/POST `/asset-categories` | Paginated category list/create |
| GET/PATCH `/asset-categories/:id` | Detail / expected-revision update of unused category |
| GET/POST `/assets` | Paginated/filterable register / source-backed DRAFT registration |
| GET/PATCH `/assets/:id` | Evidence/value/detail / own unactivated revision |
| GET `/assets/:id/journals` | Bounded actual journal and reversal history |
| POST `/assets/:id/submit` | Request independent activation approval |
| POST `/assets/:id/activate` | Apply matching approved activation |
| POST `/assets/:id/cancel` | Audited owned unactivated withdrawal |
| POST `/assets/:id/changes` | Create distinct typed change/impairment/disposal/write-off proposal |
| GET `/asset-changes/:id` | Proposal/source detail |
| POST `/asset-changes/:id/refresh` | Revalidate and increment owned DRAFT version |
| POST `/asset-changes/:id/submit` | Request change approval |
| POST `/asset-changes/:id/post` | Apply approved financial/nonfinancial change |
| POST `/asset-changes/:id/cancel` | Audited unposted cancellation |
| POST `/depreciation-runs/preview` | Explicit asset/period calculation without persistence |
| GET/POST `/depreciation-runs` | Paginated run list / snapshot and reserve DRAFT run |
| GET `/depreciation-runs/:id` | Period, assets, snapshot and posted-line mapping |
| POST `/depreciation-runs/:id/refresh` | Recalculate a DRAFT, superseding old approval |
| POST `/depreciation-runs/:id/submit` | Request independent run approval |
| POST `/depreciation-runs/:id/post` | Atomic approved depreciation |
| POST `/depreciation-runs/:id/cancel` | Cancel DRAFT and release active reservations |
| GET `/assets/reconciliation` | Full-scope register versus GL control results |

Existing `/approvals/:id/decision`, `/cancel`, `/post` and history/detail routes support all four new source types: ASSET_ACTIVATE, ASSET_CHANGE, ASSET_JOURNAL and DEPRECIATION_RUN. Existing JOURNAL_REVERSAL requests authorize financial reversals. Inputs are strict, UUID-based, date-only and decimal-string amounts. Lists accept page/pageSize (maximum 100), search and applicable category/status filters. Source history is bounded and labeled; runs are bounded at 200 assets and 400 financial lines. Complete validated request shapes are in `asset.schema.ts`.

## Database, approval and backup

The authorized owner explicitly approved `AT-ST24-20261106-01` v1: “Saya menyetujui patch DEV+TEST; catat dan eksekusi sekarang.” The approval-ready/approved/completed records and execution logs are access controlled outside Git at `D:\arya-tarray-change-records`.

Artifact: `database/accounting-stage2.4-assets.mysql.sql`.
SHA-256: `F4FD666A72463B5453453713C1E439DF39901220904535F2DE83808919BD78BD`.

Six ALTERs per exact DEV/TEST target added 27 fields and 17 FK relations with supporting indexes/CHECKs on the existing four asset tables plus journal draft and approval request. Affected tables were empty before DDL. **No table/model was added or removed: both databases remain 61 tables / 29 Accounting models.** All original DEV row counts are unchanged; no category, policy, financial fixture or role grants were seeded in DEV.

Prisma was manually synchronized after approved DDL, generated and validated. Read-only verification matched all 744 scalar mappings/nullability/native sizes/precision, 246 declared relations/actions, PK/unique/index contracts, 365 physical indexes and 111 enforced CHECKs. DEV and TEST metadata SHA-256 matches: `36f19a1a06d4416bd479262361f5fa7b137c1724d42bf3f33d7f31422f4b1729`. No prior patch replay, migrate/db push/db pull/reset or startup provisioning occurred.

Fresh verified pre-DDL full DEV backup in automatically detected Downloads:

`C:\Users\Frydo\Downloads\arya_tarray_dev_pre_stage24_2026-11-05T17-42-25-861Z_5ba84f2e.sql.gz`

17,783 bytes; SHA-256 `50d85d5c21fc91a0c45f819d23799fdd4583da91baf4aa53a816c97d208ee6d8`. Gzip integrity, SQL completion and all 61 table definitions passed. Consistent InnoDB snapshot, quick streaming, no table locks, routines/events/triggers requested; no restore or external upload. Temporary administrator option credentials were removed.

## Verification and scope limits

- Unit/regression: **429/429 passed**, none skipped.
- Isolated MySQL TEST integration: **100/100 passed**, none skipped: all 78 Stage 2.1–2.3 regressions plus 22 asset scenarios.
- Backend/integration/frontend TypeScript and Prisma generate/validate: passed.
- Physical contract/equality, original DEV preservation, TEST cleanup and Git whitespace: passed.

Integration covers registration/activation and actual AP/manual cash sources, no duplicate capitalization/payment, policy/threshold/mapping validation, straight-line/partial-month/rounding/residual/multi-asset mapping, duplicate/concurrent posting, CLOSED/stale/self/unauthorized rejection, refresh, prospective estimates, additional costs, reclassification/history protection, impairment and policy hold, net disposal gain/loss/costs, cash/unpaid consideration, write-off, post-disposal rejection, compensating reversals, source/schedule protection, atomic rollback, HTTP contracts and GL reconciliation. All TEST fixtures are removed.

No technical blocker remains for these workflows. Explicit limits:

- Adopted policy, real COA mappings and named operator/reviewer permissions must be configured by authorized people. No organizational policy/threshold is inferred or seeded.
- Valuation-based impairment recovery is PENDING_POLICY as described above. Historical opening accumulated depreciation, partial-asset/pooled-line splits, multi-currency conversion, sale invoice generation, cash refund automation and complex historical acquisition corrections are separate reviewed workflows. Existing source/accounting evidence must be supplied; it is never fabricated.
- Each original/additional/disposal source claim uses its complete real GL line. Depreciation supports existing calendar-month fiscal periods, straight-line and up to 600 useful-life months; history/run sizes are bounded. Current approved DEV fiscal horizon still ends December 2026. Future periods require separate authorized setup, not a startup action.
- Financial source/journal correction cannot silently detach an active asset or rewrite history. Dependent entries must be reversed/reviewed in order. More complex correction chains require an explicitly designed approved workflow rather than freely editing cost/NBV.

`.env` bytes, ARYA_ENV=DEV, cutover 2026-10-01, FY2026 and October–December OPEN periods are unchanged. No PROD access, AGENTS/.gitignore edit, frontend source change, new startup guard, DEV transaction seed, Git add/commit/push or external backup transfer occurred. Prior uncommitted work remains intact.
