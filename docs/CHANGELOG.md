\# Changelog



Newest first. Reference requirement IDs from `SPEC.md`.



\## 2026-10-18

\- Replaced four separate scripts (Code.gs, ExtractReceiptsGPT,

&#x20; Gemini\_ExtractReceipts, Claude\_ExtractReceipt) with a single `TravelReceipts.gs`.

\- Saves are now incremental: month folders are no longer wiped on each run (R7, R8).

\- Uber: one file per trip; tipping receipt > riding receipt > charge summary (R4).

\- Amtrak: sales, refunds, and exchanges saved as separate files, named by

&#x20; transaction date; identical repeat emails ignored (R3).

\- Marriott: folio attachment preferred, email PDF as fallback (R5).

\- Added weekly trigger installer (R9).

\- Linked repo to Apps Script with clasp; GitHub is the master copy.

\- Added SPEC.md, DEVELOPMENT.md, CHANGELOG.md.

