function saveReceiptsJuneJuly2025WithAllRules() {
  const query = '(after:2025/05/31 before:2025/08/01) (from:uber.com OR from:amtrak.com OR from:marriott.com)';
  const threads = GmailApp.search(query, 0, 100);
  const parentFolderId = '1HjZxebwmw1XjWlZT9eWgx7Igrxa1pM3M';
  const parentFolder = DriveApp.getFolderById(parentFolderId);

  let savedCount = 0;
  let foldersProcessed = {};

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const message of messages) {
      const from = message.getFrom().toLowerCase();
      const msgDate = message.getDate();
      const timestamp = Utilities.formatDate(msgDate, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
      const datePart = Utilities.formatDate(msgDate, Session.getScriptTimeZone(), 'yyyyMMdd');
      const monthFolderName = Utilities.formatDate(msgDate, Session.getScriptTimeZone(), 'yyyy-MM');
      const subject = message.getSubject();
      const plainText = message.getPlainBody();
      const cleanHtml = message.getBody();

      let monthFolder = foldersProcessed[monthFolderName];
      if (!monthFolder) {
        monthFolder = getOrCreateSubfolder(parentFolder, monthFolderName);
        clearFolderContents(monthFolder);
        foldersProcessed[monthFolderName] = monthFolder;
      }

      // --- Amtrak ---
      if (from.includes('amtrak.com') && /sales receipt/i.test(plainText + subject)) {
        const amount = extractAmount(plainText);
        const departDate = extractAmtrakDepartureDate(plainText) || datePart;
        const pdf = HtmlService.createHtmlOutput(cleanHtml).getAs('application/pdf');
        const fileName = `${departDate}_${amount}_amtrak_sales_receipt.pdf`;
        pdf.setName(fileName);
        monthFolder.createFile(pdf);
        savedCount++;
        Logger.log(`✅ Amtrak receipt saved: ${fileName}`);
      }

      // --- Marriott ---
      else if (from.includes('marriott.com')) {
        const attachments = message.getAttachments();
        const amount = extractAmount(plainText);
        if (attachments.length > 0) {
          for (const attachment of attachments) {
            const ext = attachment.getName().split('.').pop();
            const newFileName = `${timestamp}_${amount}_marriott.${ext}`;
            monthFolder.createFile(attachment.copyBlob()).setName(newFileName);
            savedCount++;
            Logger.log(`✅ Marriott attachment saved: ${newFileName}`);
          }
        } else {
          Logger.log(`⚠️ Marriott fallback skipped: ${subject}`);
        }
      }

      // --- Uber ---
      else if (from.includes('noreply@uber.com')) {
        const amount = extractAmount(plainText);
        const hasAmount = !!amount;
        const hasPayment = /(Visa|Mastercard|Apple Pay|Amex)/i.test(plainText);
        const hasReceiptSubject = /receipt|trip/i.test(subject);

        if ((hasAmount && hasPayment) || hasReceiptSubject) {
          const htmlOutput = HtmlService.createHtmlOutput(cleanHtml).setWidth(800).setHeight(1200);
          const pdfBlob = htmlOutput.getAs('application/pdf');
          const fileName = `${datePart}_${amount}_Uber.pdf`;
          pdfBlob.setName(fileName);
          monthFolder.createFile(pdfBlob);
          savedCount++;
          Logger.log(`✅ Uber receipt saved: ${fileName}`);
        } else {
          Logger.log(`❌ Skipped Uber email: No receipt pattern matched | Subject: ${subject}`);
        }
      } else {
        Logger.log(`❌ Skipped unknown sender: ${from}`);
      }
    }
  }

  Logger.log(`✅ Total saved receipts: ${savedCount}`);
}

function getOrCreateSubfolder(parentFolder, subfolderName) {
  const folders = parentFolder.getFoldersByName(subfolderName);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(subfolderName);
}

function clearFolderContents(folder) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    file.setTrashed(true);
  }
}

function extractAmount(text) {
  const match = text.match(/Total\s*\$?(\d+(\.\d{2})?)/);
  return match ? match[1] : '00.00';
}

function extractAmtrakDepartureDate(text) {
  const dateRegex = /Depart\s+\d{1,2}:\d{2}\s+[AP]M,\s+(\w+\s+\d{1,2},\s+2025)/i;
  const match = text.match(dateRegex);
  if (match && match[1]) {
    const parsedDate = new Date(match[1]);
    return Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), 'yyyyMMdd');
  }
  return null;
}
