# Travel Receipt Automation

Scans Gmail for Amtrak, Marriott, and Uber receipts and saves them as PDFs into monthly folders in Google Drive.

## How to run

1. Go to [script.google.com](https://script.google.com)
2. Open your **StoreReceipts** project
3. Copy the code from `google-apps-script/TravelReceipts.gs`
4. Edit the 3 config lines at the top (dates + folder ID)
5. Select function `saveReceipts` → click **Run**
6. Approve Gmail + Drive permissions on first run
7. Check **View → Logs** for results

## What it does

- Searches Gmail for emails from `amtrak.com`, `marriott.com`, `uber.com`
- Organizes receipts into monthly subfolders (e.g. `2026-01`, `2026-02`)
- Saves each receipt as a PDF in Google Drive
- Logs every saved and skipped file
