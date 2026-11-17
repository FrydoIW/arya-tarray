# Arya Tarray — Manual Regression Checklist

This checklist is for the owner/operator manual regression workflow. It describes
scenarios against the existing non-accounting application; it does not state that
any scenario has passed. Fill in Actual Result, PASS/FAIL, and Notes during the run.

Automated unit, integration, and browser test suites were removed from this branch
by decision. TypeScript checks, Prisma generate/validate, and production builds are
the source-validation gates; business behavior is verified manually here.

## Prerequisites

- Verified regression database with a fresh data reset (performed in Step 2), one
  Super Admin, and minimum required metadata.
- Backend running with a `JWT_SECRET` and a `DATABASE_URL` pointing at the verified
  regression database — never at DB PROD or DB DEV.
- Frontend running against the same backend (`NEXT_PUBLIC_API_URL`).
- A BCA statement file for upload scenarios.

## How to record

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|

Fill one row per scenario. Never record credentials or database URLs in this file.

## 1. Super Admin login

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 1.1 | Admin login success | Open login, enter valid Super Admin email and password, submit | Session starts, dashboard opens, admin menus visible | | | |
| 1.2 | Wrong password | Enter valid email with wrong password | Login rejected with a non-specific error, no session | | | |
| 1.3 | Inactive user | Attempt login with a deactivated user | Login rejected, no session | | | |
| 1.4 | Logout | Click logout | Session cleared, redirected to login | | | |
| 1.5 | Protected routes | Open an internal route without a session | Redirected to login | | | |

## 2. Role and permission configuration

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 2.1 | Create role | Create a new role with a code and name | Role saved and visible in role list | | | |
| 2.2 | Assign menu access | Edit role, grant selected menus, save | Access matrix persists | | | |
| 2.3 | Duplicate role code | Create role with an existing code | Rejected with validation error | | | |
| 2.4 | Deactivate role | Deactivate an assigned role | Users of that role lose its menu access after re-login | | | |
| 2.5 | Read-only enforcement | Login as a viewer-role user | Menu items outside granted access are hidden and API access is denied | | | |

## 3. User management

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 3.1 | Create user | Add a new user with name/email and a role | User saved; can log in | | | |
| 3.2 | Duplicate email | Create a user with an existing email | Rejected with validation error | | | |
| 3.3 | Reset password | Reset a user's password as admin | User can log in with the new password only | | | |
| 3.4 | Deactivate user | Deactivate a user | User cannot log in; existing data untouched | | | |
| 3.5 | Edit user role | Change a user's role | New menus apply after re-login | | | |

## 4. Event Code configuration

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 4.1 | Create event code | Create a 3-character event code with name/type | Saved and visible in the table | | | |
| 4.2 | Duplicate code | Create an event code with an existing code | Rejected with validation error | | | |
| 4.3 | Bulk upload | Upload the event-code workbook | Codes imported; invalid rows reported | | | |
| 4.4 | TIME_BASED rule | Set unit amount/duration for a TIME_BASED code | Rule saved; preview reflects it | | | |
| 4.5 | CAMPAIGN creation | Create a campaign under an event code with period/target | Campaign saved and visible | | | |

## 4b. Event Code Child configuration

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 4b.1 | Create child | Open Event Code Children, add a child (code + name) for a parent | Child saved; listed with parent and ACTIVE status | | | |
| 4b.2 | Duplicate child code | Add a second child with the same child code under the same parent | Rejected with validation error (unique per parent) | | | |
| 4b.3 | Same code, different parent | Use the same child code under a different parent | Allowed (uniqueness is per parent) | | | |
| 4b.4 | Edit child | Rename child / change display order / description | Saved; updated fields shown | | | |
| 4b.5 | Deactivate child | Set an unused child to Inactive | Saved; child listed as INACTIVE, historical display preserved | | | |
| 4b.6 | Delete unreferenced child | Delete a child with 0 transactions and 0 corrections | Deleted | | | |
| 4b.7 | Delete referenced child | Try to delete a child used by transactions/corrections | Rejected; guided to deactivate instead | | | |
| 4b.8 | Move child to another parent | Try to change a child's parent Event Code | Rejected (child cannot move parent) | | | |
| 4b.9 | Create under inactive parent | Try to create a child for an inactive Event Code | Rejected with clear message | | | |
| 4b.10 | RBAC | Open Children as a viewer-role user | Hidden or access denied (CONFIG_EVENT_CODE) | | | |

## 5. Approval configuration

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 5.1 | Configure approvers | Add one or more approvers to a menu's approval config | Config saved | | | |
| 5.2 | ANY-ONE decision | Submit an approval item; decide as any one configured approver | Item decided; other approvers' pending view clears | | | |
| 5.3 | Non-approver decision | Attempt to decide as a user not in the approver list | Rejected | | | |

## 6. Bank account configuration

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 6.1 | Create bank account | Add bank code/name/account no/name | Saved; visible in account list | | | |
| 6.2 | Duplicate bank+account no | Create the same bank code and account number again | Rejected with validation error | | | |
| 6.3 | Opening balance | Set opening balance and date, lock it | Balance locked; cannot be edited afterwards | | | |

## 7. Statement upload BCA

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 7.1 | Upload valid statement | Upload a BCA xlsx for a configured account | Upload attempt recorded; statement created as RAW with transactions | | | |
| 7.2 | Duplicate rows | Upload a file whose rows match an existing upload | Duplicates flagged/rejected; counts reported | | | |
| 7.3 | Invalid file | Upload a non-BCA or corrupt file | Rejected with a clear error, nothing stored | | | |
| 7.4 | Overlapping period | Upload a statement overlapping a FINALIZED period | Rejected or flagged per overlap rules | | | |

## 8. RAW / CHECK / FINALIZED lifecycle

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 8.1 | Execute | Execute a RAW statement | Statement and transactions move RAW → CHECK | | | |
| 8.2 | Finalize | Finalize a CHECK statement after approval | Statement and transactions move CHECK → FINALIZED | | | |
| 8.3 | Withdraw | Withdraw a RAW/CHECK statement | Statement marked withdrawn; no FINALIZED data created | | | |
| 8.4 | Prevent FINALIZED edit | Try to edit a FINALIZED statement | Changes rejected without approval flow | | | |

## 8b. Child classification on Statement Upload

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 8b.1 | Parent without children | Classify a transaction whose Final Event has no children | Legacy parent-only behavior; Child column shows "—"; row READY | | | |
| 8b.2 | Single active child | Classify with a parent that has exactly one active child | Child auto-selected on save/upload; row READY | | | |
| 8b.3 | Multiple active children | Parent has 2+ active children and no child chosen | Row shows NEEDS_REVIEW; Execute blocked with actionable message | | | |
| 8b.4 | Manual child selection | Pick a child from the eligible dropdown | Saved; preview shows parent + child | | | |
| 8b.5 | All children inactive | Parent has children but all are inactive and none selected | Row NEEDS_REVIEW; Execute blocked ("no active Child") | | | |
| 8b.6 | Stale child at Execute | Select a child, then deactivate it in Configuration, then Execute | Execute blocked with clear conflict message; no silent re-selection | | | |
| 8b.7 | Cross-parent child | Attempt to save a child that belongs to a different parent | Rejected backend (Child does not belong) | | | |
| 8b.8 | Parent change resets child | Change Final Event to another parent | Child resets; re-resolved (auto when single active child) | | | |
| 8b.9 | Historical inactive child | View an old transaction that keeps an inactive child | Still readable; child shown as historical | | | |
| 8b.10 | Bulk execute | Execute a statement where only some rows are unresolved children | Execute rejected atomically; nothing moves to CHECK | | | |

## 9. Approval workflow

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 9.1 | Submit approval | Execute a statement; open Sign Approval | Pending item appears for approvers only | | | |
| 9.2 | Approve | Approve the pending item | Status updates; statement can be finalized | | | |
| 9.3 | Reject | Reject the pending item | Status updates; statement cannot be finalized while rejected | | | |
| 9.4 | History | Open approval history | Actions, actors, and remarks recorded | | | |

## 10. Edit Income

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 10.1 | Propose correction | Change final event/amount/remark of a FINALIZED transaction | Correction proposal created with before/after diff | | | |
| 10.2 | Approve correction | Approve the correction proposal | Transaction updated; history records the change | | | |
| 10.3 | Reject correction | Reject the correction proposal | Transaction unchanged | | | |
| 10.4 | Child-only correction | Change only the Child (same parent), e.g. Amitabha → Kwan Im | Recognized as a meaningful MODIFIED correction; proposal shows before/proposed Child | | | |
| 10.5 | Approve child-only correction | Approve the child-only proposal | Transaction child updated; history records `event_code_child_id`; no duplicate coverage/allocation/ledger entries | | | |
| 10.6 | Child correction with parent change | Change parent and child together | Proposal stores both; approval re-validates both | | | |
| 10.7 | Manual adjustment with child | Add an incoming manual adjustment under a parent with multiple children | Child select required; proposal stores proposed child | | | |
| 10.8 | Stale child proposal | Propose a child, deactivate that child, then approve | Approval aborted with stale-configuration message; no partial writes | | | |

## 11. Transaction Inquiry

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 11.1 | Query | Filter by account/period/status | Correct transactions returned | | | |
| 11.2 | Detail | Open a transaction detail | Full field history and status shown | | | |
| 11.3 | PDF report | Generate the inquiry PDF | Downloadable PDF with matching rows | | | |
| 11.4 | Child column and filter | Open inquiry; filter by a child | Child column shown; filter narrows rows to that child | | | |
| 11.5 | Child audit history | Open a transaction whose child was corrected | History shows the `Child` change with before/after labels | | | |

## 12. Member registration and identity

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 12.1 | Candidate evidence | Open registration after statement execute | Sender evidence appears as UNVERIFIED | | | |
| 12.2 | Register new member | Register a new member from identity evidence | Member created; identity VERIFIED and linked | | | |
| 12.3 | Link existing | Link identity to an existing active member | Identity VERIFIED and linked; no duplicate member | | | |
| 12.4 | Ignore identity | Mark unusable identity as ignored | Identity excluded from candidates | | | |
| 12.5 | Identity history | Move/detach a VERIFIED identity | History rows created; ownership updates without rewriting transactions | | | |

## 13. Member donation

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 13.1 | Donation history | Open a member with FINALIZED positive transactions | Donations listed with correct periods/amounts | | | |
| 13.2 | Period filter | Switch MONTH/DAY filter | Totals/history match the selected period; lifetime totals unchanged | | | |
| 13.3 | Event breakdown | Filter by a final event | Breakdown uses the event and orders amounts descending | | | |
| 13.4 | Child column and filter | Open donation history with child-tagged transactions | Child column shown; child filter narrows rows | | | |
| 13.5 | Child breakdown | Open donation history | Child Breakdown panel lists children with counts/amounts; event totals unchanged | | | |

## 14. TIME_BASED and carry transfer

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 14.1 | Subscription creation | Donation links to a TIME_BASED event code | Subscription/coverage created from the amount/unit rule | | | |
| 14.2 | Coverage preview | Preview coverage dates for an amount | Correct coverage range and granted units | | | |
| 14.3 | Carry transfer | Transfer balance between two subscriptions of a member | Ledger entries created on both sides; balances consistent | | | |
| 14.4 | Reversal | Reverse a transfer | Reversal entry created; original entry voided; idempotency holds | | | |
| 14.5 | Duplicate transfer | Repeat the same transfer request | Second request does not double-apply (idempotency key) | | | |

## 14b. TIME_BASED Child Subscription & Stock

### Configuration

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 14b.1 | Complete child config | For a TIME_BASED child set capacity, unit amount, duration | Saved; child shows occupied 0 / available = capacity; configurationComplete | | | |
| 14b.2 | Incomplete config | Set capacity only (no rate/duration) | Rejected: configuration must be complete | | | |
| 14b.3 | Config on non-TIME_BASED child | Try capacity/rate on a STANDARD/CAMPAIGN child | Rejected (capacity only for TIME_BASED children) | | | |
| 14b.4 | Capacity decrease | Reduce capacity with fewer occupied slots than the new value | Allowed; capacity change audited (capacity-change table) | | | |
| 14b.5 | Capacity below occupied | Reduce capacity under the occupied slot count | Rejected with actionable error | | | |
| 14b.6 | Rate change with unresolved payments | Change unit amount while a pending official payment exists for that child | Rejected (resolve payments first) | | | |
| 14b.7 | Rate change with outstanding carry | Change unit amount while subscriptions of that child have positive carry | Rejected (resolve carry first) | | | |
| 14b.8 | Deactivate referenced child | Deactivate a child with historical coverage | Allowed; historical records remain readable; no new enrollment accepted | | | |
| 14b.9 | Legacy child migration | Open a TIME_BASED child created before Enhancement 2 | Kept as-is; marked "Belum dikonfigurasi"; enrollment blocked until configured | | | |

### Enrollment & stock (no overbooking)

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 14b.10 | Enroll to child | Member subscribes to a configured TIME_BASED child | Subscription created with child association; occupied +1 | | | |
| 14b.11 | Capacity = 1, concurrent enrollments | Two operators enroll two different members nearly simultaneously to the same child with capacity 1 | Exactly one succeeds; the other gets a clear capacity conflict | | | |
| 14b.12 | Duplicate enrollment | Same member enrolls twice on the same child | Rejected (one enrollment per member+child) | | | |
| 14b.13 | Multi-child same parent | One member subscribes to Amitabha and Kwan Im (same parent) | Both subscriptions exist independently | | | |
| 14b.14 | Pending reservation | Member enrolls without any payment yet | Slot occupied; no coverage fabricated; shows pending state | | | |
| 14b.15 | Full child blocks payment allocation | Payment targets a child whose capacity is full and member has no slot | Payment stays FINALIZED but unresolved (no coverage/ledger); no silent subscription creation | | | |
| 14b.16 | Unconfigured child blocks payment | Payment targets a child without complete config | Payment stays unresolved; statement approval is not blocked by allocation | | | |
| 14b.17 | Slot release on expiry | Subscription coverage ends | Occupancy calculation no longer counts it (availability computed at request time); records preserved | | | |
| 14b.18 | Expired with carry | Expired subscription keeps positive carry | Carry remains recorded and transferable; no automatic new slot | | | |
| 14b.19 | Re-enroll expired when full | Expired member re-enrolls while child is full | Rejected with capacity conflict | | | |
| 14b.20 | Renewal same slot | Payment renews a subscription that still occupies its slot | Same subscription extended; occupied count unchanged | | | |

### Payment matching & corrections

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 14b.21 | Payment → correct child | Payment parent 017 + child Amitabha | Allocates to Amitabha subscription only, never Kwan Im | | | |
| 14b.22 | Legacy payment → legacy program | Historical payment without child | Matches parent-only subscription (legacy compatibility) | | | |
| 14b.23 | Retry allocation | Retry an unresolved payment with exactly one compatible subscription | Allocates; repeated retry is a no-op | | | |
| 14b.24 | Manual allocation | Allocate a payment to a chosen subscription | Child-aware matching; wrong child rejected | | | |
| 14b.25 | Child-only correction | Correct Amitabha → Kwan Im after allocation | Proposal stores before/proposed child; approval re-syncs financial records; no double posting | | | |
| 14b.26 | Correction to full child | Correct a payment to a child whose capacity is full | Approval aborted with actionable conflict; no partial write | | | |
| 14b.27 | Stale child correction | Propose child, deactivate it, then approve | Approval aborted (stale configuration) | | | |

### Transfer & reversal

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 14b.28 | Child-aware transfer | Transfer Amitabha carry → Kwan Im subscription | Source/destination validated by subscription id; ledgers posted; snapshots kept | | | |
| 14b.29 | Transfer reactivates expired child | Transfer into an expired child subscription | Slot checked atomically; rejected when full | | | |
| 14b.30 | Reverse child transfer | Reverse a child-to-child transfer | Restores carry only; no duplicate ledger; no negative carry; no new slot creation | | | |
| 14b.31 | TIME_BASED → CAMPAIGN / CAMPAIGN → TIME_BASED | Run existing transfer paths with child subscriptions present | All four transfer routes still work | | | |

### Monitoring & member data

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 14b.32 | Monitoring child stock | Open TIME_BASED monitoring | Each child row shows capacity, occupied, available, pending, active, expired, carry | | | |
| 14b.33 | Member sponsorship UI | Open Member Data sponsorship for a member with child subscriptions | Child shown on cards; child select in "Tambah Program" shows price/duration/availability; incomplete/full children disabled | | | |
| 14b.34 | Identity reassignment | Reassign verified identity between members | Child-aware re-synchronization; no double allocation | | | |
| 14b.35 | RBAC | Attempt child config / subscription ops as viewer role | Denied by existing menu permissions | | | |

## 15. CAMPAIGN and wallet transfer

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 15.1 | Campaign allocation | Donation links to a CAMPAIGN | Allocation created toward the campaign | | | |
| 15.2 | Wallet evidence | Excess above target cap remains as wallet evidence | Wallet ledger entry reflects unallocated remainder | | | |
| 15.3 | Wallet transfer | Transfer wallet balance to another campaign/subscription | Entries created; balances consistent | | | |
| 15.4 | Target monitoring | Open campaign monitoring | Target vs achieved amount shown correctly | | | |

## 16. Dashboard and monitoring

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 16.1 | Dashboard metrics | Open dashboard after prepared transactions | Metrics match prepared data | | | |
| 16.2 | Statement status | View statement status cards | Counts match RAW/CHECK/FINALIZED data | | | |
| 16.3 | Top events | View top final events | Ranking matches finalized amounts | | | |
| 16.4 | Trend chart | View transaction trend | Trend matches per-period finalized data | | | |
| 16.5 | TIME_BASED monitoring | Open time-based monitoring | Coverage timeline matches subscriptions | | | |
| 16.6 | CAMPAIGN monitoring | Open campaign monitoring | Target progress matches allocations | | | |
| 16.7 | Child breakdown on dashboard | Open dashboard with finalized child-tagged donations | Parent totals correct; child sub-rows shown and summed ≤ parent total (no double counting) | | | |

## 17. Export and reporting

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 17.1 | Excel export | Run an export from a list/detail view | Downloadable workbook with matching data | | | |
| 17.2 | Report PDF | Generate an inquiry/transaction report | PDF content matches the filtered data | | | |

## 18. Negative cases, invalid input, and RBAC

| # | Scenario | Steps | Expected Result | Actual Result | PASS/FAIL | Notes |
|---|---|---|---|---|---|---|
| 18.1 | Invalid amounts | Enter negative/zero/oversized amounts | Rejected with validation messages | | | |
| 18.2 | Required fields | Submit forms with required fields empty | Blocked with field-level errors | | | |
| 18.3 | Unauthorized API | Call a restricted API as a viewer | 401/403 response; no data changed | | | |
| 18.4 | Cross-role UI | Open restricted pages as a viewer | Page hidden or access-denied screen shown | | | |
| 18.5 | Stale session | Wait for JWT expiry, then act | Forced re-login, no partial writes | | | |

## Completion record

- Operator name / initials:
- Environment target (regression DB identifier):
- Start time / end time:
- Statement files used:
- Total scenarios run: ___ / Total passed: ___ / Total failed: ___
- Failed scenario numbers and follow-up actions:
