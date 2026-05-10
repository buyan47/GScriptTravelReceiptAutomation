// ============================================================
//  Travel Receipt Automation — Google Apps Script
//  Last updated: 2026-05-10
//
//  WHAT IT DOES:
//  Scans Gmail for Amtrak, Marriott, and Uber receipt emails,
//  converts them to PDF, and saves into monthly subfolders
//  inside your Google Drive folder.
//
//  HOW TO RUN:
//  1. Open https://script.google.com
//  2. Paste this code into your project
//  3. Edit START_DATE and END_DATE below
//  4. Select function: saveReceipts
//  5. Click Run
//  6. First run: approve Gmail + Drive permissions when prompted
//  7. Check View → Logs for results
// ============================================================

// ── CONFIGURATION — edit these before running ─────────────────────────────────
const START_DATE      = '2026/01/01';                   // start of scan range (YYYY/MM/DD)
const END_DATE        = '2026/05/01';                   // end of scan range   (YYYY/MM/DD)
const DRIVE_FOLDER_ID = '1HjZxebwmw1XjWlZT9eWgx7Igrxa1pM3M';  // Google Drive parent folder ID
// ─────────────────────────────────────────────────────────────────────────────


function saveReceipts() {
  const query = `(after:${START_DATE} before:${END_DATE}) (from:uber.com OR from:amtrak.com OR from:marriott.com)`;
  const threads = GmailApp.search(query, 0, 200);
  const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

  Logger.log('================================================');
  Logger.log('Travel Receipt Automation');
  Logger.log('Date range: ' + START_DATE + ' → ' + END_DATE);
  Logger.log('Threads found: ' + threads.length);
  Logger.log('================================================');

  let savedCount = 0;
  let foldersProcessed = {};

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const message of messages) {
      const from            = message.getFrom().toLowerCase();
      const msgDate         = message.getDate();
      const timestamp       = Utilities.formatDate(msgDate, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
      const datePart        = Utilities.formatDate(msgDate, Session.getScriptTimeZone(), 'yyyyMMdd');
      const monthFolderName = Utilities.formatDate(msgDate, Session.getScriptTimeZone(), 'yyyy-MM');
      const subject         = message.getSubject();
      const plainText       = message.getPlainBody();
      const cleanHtml       = message.getBody();

      // Get or create the month subfolder (e.g. "2026-01")
      if (!foldersProcessed[monthFolderName]) {
        const folder = getOrCreateSubfolder(parentFolder, monthFolderName);
        clearFolderContents(folder);
        foldersProcessed[monthFolderName] = folder;
      }
      const monthFolder = foldersProcessed[monthFolderName];

      // ── Amtrak ────────────────────────────────────────────────────────────
      if (from.includes('amtrak.com') && /sales receipt/i.test(plainText + subject)) {
        const amount     = extractAmount(plainText);
        const departDate = extractAmtrakDepartureDate(plainText) || datePart;
        const pdf        = HtmlService.createHtmlOutput(cleanHtml).getAs('application/pdf');
        const fileName   = `${departDate}_${amount}_amtrak_sales_receipt.pdf`;
        pdf.setName(fileName);
        monthFolder.createFile(pdf);
        savedCount++;
        Logger.log(`✅ Amtrak saved: ${fileName}`);
      }

      // ── Marriott ──────────────────────────────────────────────────────────
      else if (from.includes('marriott.com')) {
        const attachments = message.getAttachments();
        const amount      = extractAmount(plainText);
        if (attachments.length > 0) {
          for (const attachment of attachments) {
            const ext      = attachment.getName().split('.').pop();
            const fileName = `${timestamp}_${amount}_marriott.${ext}`;
            monthFolder.createFile(attachment.copyBlob()).setName(fileName);
            savedCount++;
            Logger.log(`✅ Marriott saved: ${fileName}`);
          }
        } else {
          Logger.log(`⚠️  Marriott skipped (no attachment): ${subject}`);
        }
      }

      // ── Uber ──────────────────────────────────────────────────────────────
      else if (from.includes('noreply@uber.com')) {
        const amount         = extractAmount(plainText);
        const hasAmount      = !!amount && amount !== '00.00';
        const hasPayment     = /(Visa|Mastercard|Apple Pay|Amex)/i.test(plainText);
        const hasReceiptSubj = /receipt|trip/i.test(subject);

        if ((hasAmount && hasPayment) || hasReceiptSubj) {
          const pdf      = HtmlService.createHtmlOutput(cleanHtml).getAs('application/pdf');
          const fileName = `${datePart}_${amount}_uber_receipt.pdf`;
          pdf.setName(fileName);
          monthFolder.createFile(pdf);
          savedCount++;
          Logger.log(`✅ Uber saved: ${fileName}`);
        } else {
          Logger.log(`⚠️  Uber skipped (no receipt pattern): ${subject}`);
        }
      }

      else {
        Logger.log(`⏭️  Skipped: ${from} — ${subject}`);
      }
    }
  }

  Logger.log('================================================');
  Logger.log(`✅ Done! Total receipts saved: ${savedCount}`);
  Logger.log('================================================');
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function getOrCreateSubfolder(parentFolder, subfolderName) {
  const folders = parentFolder.getFoldersByName(subfolderName);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(subfolderName);
}

function clearFolderContents(folder) {
  const files = folder.getFiles();
  while (files.hasNext()) files.next().setTrashed(true);
}

function extractAmount(text) {
  const match = text.match(/Total\s*\$?\s*(\d+(\.\d{2})?)/i);
  return match ? match[1] : '00.00';
}

function extractAmtrakDepartureDate(text) {
  // Matches "Depart 10:30 AM, January 15, 2026"
  const m = text.match(/Depart\s+\d{1,2}:\d{2}\s+[AP]M,\s+(\w+\s+\d{1,2},\s+\d{4})/i);
  if (!m) return null;
  const parsed = new Date(m[1]);
  return isNaN(parsed) ? null : Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyyMMdd');
}
