# Arya Tarray Development Rules

## Product purpose
Arya Tarray is an internal operational dashboard for Yayasan Arya Tarray Nusantara. Keep the UI calm, respectful, compact, and operationally useful. Do not turn it into a noisy generic SaaS dashboard.

## Navigation
1. Overview
2. Rupang
   - Rupang Entry
   - Inquiry
3. Reconciliation
   - Statement Upload
   - Code Management
   - Transaction Inquiry

## Rupang workflow
- Excel upload creates one upload batch and detail rows.
- New rows start as `PENDING`.
- Workflow: `PENDING -> VASE_REVIEW -> COMPLETE`.
- `COMPLETE` rows appear in Rupang Inquiry.
- Complete rows may still be edited from Inquiry.
- Every edit/status transition must write history.
- Preserve source row number and source upload for traceability.

## Rupang source mapping
The current donor spreadsheet columns are:
- Nomor Rupang
- Kode
- Jenis Rupang
- Size/Bahan
- PIC
- Nama di Rupang
- Nama Contact Person
- No Telp Contact Person
- Pemasangan dari
- Periode (Bln)
- Ket.
- Dana Rupang
- Dana Monkcare
- month-marker columns beginning at column N

Do not invent a Monkcare amount from the current sheet. `Dana Monkcare` is currently treated as a yes/no marker.

## Bank reconciliation
- Upload BCA statement Excel files.
- Parse each transaction group beginning with a dated row.
- Only incoming (`CR`) transactions participate in suffix-code reconciliation by default.
- Take the final three digits of the integer rupiah amount as a candidate code when the suffix is not `000`.
- Keep codes as `CHAR(3)`/strings so leading zeroes are preserved (`017`, `058`, `075`).
- Active code exists -> UI status `CHECK`.
- No matching code or no suffix -> UI status `ERROR`.
- Store internal code status separately (`MATCHED`, `NOT_FOUND`, `NO_CODE`).
- Manual correction must be auditable.
- Do not automatically link a bank transaction to a specific Rupang entry until a deterministic matching rule is defined.

## Known starter payment codes
- 017 — Rupang
- 058 — Sangha Dana
- 075 — Proyek Bhutan
These are seed data and remain editable through Code Management.

## Database
- MySQL 8.4 / utf8mb4.
- Production database name: `arya_tarray`.
- Never commit credentials.
- Use migrations; do not modify production tables manually from application code.

## Backend
- TypeScript + Express + Prisma.
- Validate request input.
- Keep parsing/business logic in services, not route handlers.
- Use transactions for upload batch + detail persistence and history-changing operations.
- Uploaded files are parsed in memory in this first version; persistence of original files can be added later.

## Frontend
- Next.js + TypeScript.
- Arya Tarray visual identity: warm ivory canvas, deep maroon, restrained gold, subtle Tibetan/lotus geometry.
- Guru portrait may be used as a contextual visual, not as decorative clutter.
- Use high information hierarchy, generous whitespace, compact cards, and restrained animation.
- Status colors: pending amber, review blue, complete/check green, error red.
- Avoid excessive charts. Overview should expose only metrics that change user decisions.

## Implementation preference
Develop feature slices end-to-end: database/backend/frontend for one workflow, then UAT with real source files. Keep intermediate testing lightweight but do not skip parser and status-transition tests.
