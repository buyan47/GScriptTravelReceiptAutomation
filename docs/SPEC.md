\# Travel Receipt Automation — Specification



Last updated: 2026-10-18

Code: `google-apps-script/TravelReceipts.gs` · Apps Script project: StoreReceipts



\## 1. Purpose

Collect business-travel receipts from Gmail into Google Drive, one file per

transaction, named so they can be matched to card statements and expense reports.



\## 2. Scope

In scope:

\- \*\*Amtrak\*\*: emails from `etickets@amtrak.com`

\- \*\*Uber rides\*\*: emails from `noreply@uber.com` whose subject contains "trip with Uber"

\- \*\*Marriott\*\*: emails from any `marriott.com` sender



Out of scope: Uber Eats, other vendors, building the expense report itself,

Gmail accounts other than buyan47@gmail.com.



\## 3. Functional requirements



\*\*R1 Search window.\*\* `saveReceipts()` processes the previous and current calendar

month. `backfillReceipts()` processes `CONFIG.BACKFILL\_START` (inclusive) to

`CONFIG.BACKFILL\_END` (exclusive). Messages dated outside the window are ignored,

even when their thread matches the search.



\*\*R2 Storage.\*\* Files are saved under My Drive › EigenX › Receipts

(`CONFIG.DRIVE\_FOLDER\_ID`) in a `yyyy-MM` subfolder, created if missing. The month

is the transaction date (Amtrak), trip date (Uber), or email date (Marriott).



\*\*R3 Amtrak.\*\* Only SALES, REFUND, or EXCHANGE receipts are saved, as a PDF of the

email. Each distinct transaction (reservation + type + purchased/modified time) is

saved once; identical repeat emails are ignored. Each change or refund is its own

file.

Name: `yyyyMMdd\_amtrak\_<sale|refund|exchange>\_<reservation>\_<amount>.pdf`, where the

date is the Modified date if present, otherwise the Purchased date, and the amount

is "Total" (sales) or "Total Refunded" (refunds).



\*\*R4 Uber.\*\* One file per trip, identified by trip date and time. Uber sends up to

three emails per trip; the highest-ranked version is kept:

tipping receipt (3) > riding receipt (2) > charge summary (1).

A higher-ranked version replaces a lower one, and the replaced file is moved to Trash.

Name: `yyyyMMdd\_HHmm\_uber\_<amount>.pdf`; charge summaries add `\_charge-summary`.



\*\*R5 Marriott.\*\* Promotional subjects are skipped. If the email has a PDF/PNG/JPG

attachment over 5 KB whose name suggests a folio, the attachment is saved as

`yyyyMMdd\_marriott\_folio.<ext>`. Otherwise, if the subject mentions folio, receipt,

invoice, bill, or checkout, the email is saved as `yyyyMMdd\_marriott\_email.pdf`.



\*\*R6 Missing amount.\*\* If no amount can be read, the name uses `unknown`.



\*\*R7 Safe to re-run.\*\* Every saved file carries a description tag

`travel-receipts|msg=<gmail id>|key=<receipt key>|rank=<n>`. Re-running never

creates a second file for a message already saved, or for a receipt key already

saved at equal or higher rank.



\*\*R8 Hand-added files.\*\* Files without the tag are never modified or deleted. The

only deletion the script performs is the R4 replacement (to Trash).



\*\*R9 Schedule.\*\* `installWeeklyTrigger()` creates a single weekly trigger for

`saveReceipts`, Mondays around 6 AM. Running it again replaces the trigger rather

than adding a second one.



\*\*R10 Logging.\*\* Each run logs the date window, threads found per vendor, every

saved or replaced file, and a summary line (saved / replaced / already had /

errors). An error on one email is logged and does not stop the run.



\## 4. Constraints

\- Apps Script stops any run after 6 minutes. Backfill one or two months at a time;

&#x20; re-running resumes where it stopped (R7).

\- At most `CONFIG.MAX\_THREADS\_PER\_VENDOR` (300) threads per vendor per run.

\- Time zone: America/New\_York (`appsscript.json`).

\- Needs Gmail, Drive, and trigger permissions, granted on the first run.

\- Parsing relies on vendor email wording as of October 2026. If a vendor changes its

&#x20; format, amounts may show `unknown` or emails may be skipped. Check the log.



\## 5. Acceptance criteria (check after every change)

\- \*\*AC1\*\* `backfillReceipts` over a recent month finishes with `errors 0`.

\- \*\*AC2\*\* Running it again immediately reports `saved 0, replaced 0`.

\- \*\*AC3\*\* Each Uber trip appears once; tipped trips show the tipped total.

\- \*\*AC4\*\* An Amtrak refund appears as its own file; repeated identical emails

&#x20; produce one file.

\- \*\*AC5\*\* Files added to the month folders by hand are untouched.

\- \*\*AC6\*\* Spot-check three files: the amount in the name matches the email total.



\## 6. Open questions

\- \*\*Q1\*\* On Amtrak "UPDATED" receipts, is Total the change amount or the whole

&#x20; reservation? Example: 299A41 shows $400.00 (10/02) and $92.00 (10/07). Compare

&#x20; with the card statement.

\- \*\*Q2\*\* Marriott: the same folio emailed more than once produces duplicate files

&#x20; (three `20261009\_marriott\_folio.pdf`), and `20261014\_marriott\_folio.png` may

&#x20; not be a folio. Review the filter against real Marriott emails.

