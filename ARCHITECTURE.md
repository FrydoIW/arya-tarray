# Current application architecture

This document describes the current source, not a proposed rewrite or future accounting system. The supported workflows and database policy are summarized in [README.md](README.md) and [DATABASE.md](DATABASE.md).

## Frontend

Next.js App Router pages under `frontend/src/app/` are thin entry points. Feature folders under `frontend/src/features/` own their screens, hooks, API clients, types, utilities, and CSS modules. Shared UI/layout components live under `frontend/src/components/`; API clients use the common transport and token handling in `frontend/src/lib/api.ts`. Navigation is permission-aware but is not the security boundary: the backend independently authorizes requests.

The practical flow is App Router page → feature component/hook → feature API client → shared API transport → backend endpoint. Read-model values from the backend are authoritative for displayed financial totals; frontend previews and formatting do not post financial state.

## Backend

Express registers authentication and protected `/api` routes in `backend/src/app.ts`. Feature routes typically call a controller, which validates/parses the request and delegates to a service; the service owns business rules and calls repositories; repositories use Prisma against MySQL. Shared middleware handles authentication, active-user checks, permission checks, upload bounds, and error responses. Zod schemas sit alongside feature modules.

The primary dependency direction is Route → Controller → Service → Repository → Prisma/MySQL. It is not absolute: some repositories coordinate other domain services while an existing Prisma transaction client is open. See **Known intentional coupling** below.

## Domains and responsibility

| Domain | Current responsibility |
| --- | --- |
| Auth / authorization | Login, JWT verification, active-user validation, role/menu permission enforcement. |
| Configuration | Role/access matrix, users, Event Codes and their type-specific settings, approval configuration, and BCA bank-account master. |
| Statement upload / reconciliation | Parse BCA evidence, classify eligible income, retain Suggested versus actual Final Event, persist RAW statements, Execute to CHECK, and maintain transaction/history evidence. |
| Transaction Inquiry | Read-only search and reporting over reconciliation records. |
| Edit Income / correction | Auditable correction proposals and approver snapshots; approved changes update authoritative values through the approval flow. |
| Sign Approval | ANY-ONE decision from the captured approver snapshot; finalization and dependent program synchronization occur atomically. |
| Member registration / identity | Explicit registration, linking, move, detach, ignore, and identity ownership history; no fuzzy automatic Member linking. |
| Member data / STANDARD | Profile and donation read models; STANDARD is direct finalized contribution history, not a subscription, coverage or carry workflow. |
| TIME_BASED | Subscription metadata, applicable rates, payment/coverage evidence, consumption, carry ledger and correction/rebuild handling. |
| CAMPAIGN | Participation, direct contribution and target-application evidence, carry allocation and donor Campaign wallet. |
| Carry transfer | Validated source/destination, paired financial evidence, idempotency and controlled reversal. |
| Monitoring | Dashboard, Time Based Monitoring and Campaign Monitoring read models; monitoring does not own financial posting. |

## State and evidence flows

Statement and transaction lifecycle: `RAW → CHECK → FINALIZED`. Upload preserves source evidence; Execute establishes CHECK state and pending approval; authorized approval finalizes, while correction decisions retain proposal/history evidence. Suggested Event is advisory and distinct from the actual Final Event. Only finalized, positive, non-excluded transactions with an actual Event Code can be official donations.

Canonical donor ownership: `BankTransaction → MemberIdentity → Member`. A transaction does not directly own a Member. A verified identity currently assigned to a Member determines that Member's official donation view; move/detach changes ownership without rewriting transaction evidence. Identity decisions have history.

Approval instances retain an approver snapshot, so later configuration changes do not silently change who may decide an already-pending request. Conditional status updates prevent a second decision from silently overwriting the first. Correction proposals and histories preserve previous and proposed values and the decision trail.

TIME_BASED subscriptions hold program metadata; payment and coverage records represent historical entitlement. Active ledger deltas derive carry rather than a stored Member donation total. Campaign has explicit participation, allocation and wallet evidence; target application is distinct from direct contribution and carry source. Carry transfers record a header plus corresponding source/destination ledger effects. Idempotency keys and database uniqueness protect replay; linked reversal records and dependency checks protect a transfer that has already funded later use.

## Transaction boundaries and known intentional coupling

Statement Execute, approval/finalization, identity ownership decisions, program synchronization, and carry posting/reversal use database transactions where partial persistence would be unsafe. Identity operations use serializable transactions and bounded whole-transaction retry for recognized serialization/deadlock failures.

Some repositories call TIME_BASED or CAMPAIGN synchronization services while sharing that same transaction client—for example approval finalization and identity reassignment. This couples domain modules intentionally to keep financial and identity evidence consistent at commit. It is a known maintenance boundary, not permission to move side effects outside the transaction during a documentation cleanup.

No General Ledger, Chart of Accounts, journal posting, production notification worker or deployment queue is implemented by this document.
