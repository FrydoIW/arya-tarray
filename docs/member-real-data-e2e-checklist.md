# Member real-data E2E checklist

Use a real BCA statement and authorized operational user. Do not seed synthetic Member, identity, or transaction history.

1. Upload the real statement in **Reconciliation → Statement Upload**. Expected: one upload and its transaction rows are `RAW`.
2. Review every eligible incoming transaction and set its actual **Final Event**. Suggested Event remains advisory only.
3. Execute the statement. Expected: statement and transactions move `RAW → CHECK`; approval becomes pending; eligible usable sender identities are created/reused and transactions receive `member_identity_id` in the same transaction.
4. Open **Donatur → Registrasi Donatur**. Expected: new sender evidence appears as `UNVERIFIED`; blank/unusable names and non-incoming transactions do not appear.
5. Use **Register New** or **Link Existing**. Expected: identity moves `UNVERIFIED → VERIFIED`, receives `member_id`, `verified_at`, and `verified_by`; Register New creates the canonical Member, while Link Existing requires an active Member.
6. Complete approval/finalization. Expected: statement and transactions move `CHECK → FINALIZED` under the existing ANY ONE approval rule.
7. Open **Donatur → Data Donatur** and the Member detail. Expected: only finalized positive transactions with actual Final Event and a linked VERIFIED identity contribute to derived analytics.
8. Select a **MONTH**. Confirm period totals/history use `transaction_date` within that calendar month; lifetime totals stay all-time.
9. Select a **DAY**. Confirm only that business date contributes to period totals/history.
10. Select an actual **Final Event**. Confirm period totals, rows, Event Breakdown, and Category Breakdown use that event; lifetime totals remain unchanged.
11. Confirm Event Breakdown uses actual Final Event code/name and is ordered by amount descending.
12. Confirm Category Breakdown uses `EventCode.category`; null/blank appears as `Uncategorized` without a database write.
13. Optional: move a VERIFIED identity to another active Member. Confirm transactions are not rewritten and derived ownership moves with `MemberIdentity.member_id`.
14. Optional: detach a VERIFIED identity. Expected: identity moves `VERIFIED → UNVERIFIED`, verification fields clear, transactions keep their identity link, and Member analytics no longer include those transactions.

Record the statement ID, identity ID, Member code, selected period, expected transaction count, and expected decimal amount in the UAT evidence. Do not record credentials.
