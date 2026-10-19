function saveReceiptsCurrentAndPreviousMonthOptimized() {
  const startTime = new Date().getTime();
  
  // Calculate current and previous month date ranges
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  
  // Format dates for Gmail search (YYYY/MM/DD)
  const startDate = Utilities.formatDate(previousMonth, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const endDate = Utilities.formatDate(nextMonth, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  
  Logger.log(`📅 Processing emails from ${startDate} to ${endDate}`);
  
  // More specific queries to reduce email volume
  const queries = [
    `(after:${startDate} before:${endDate}) from:uber.com`,
    `(after:${startDate} before:${endDate}) from:noreply@uber.com`,
    `(after:${startDate} before:${endDate}) from:receipts@uber.com`,
    `(after:${startDate} before:${endDate}) from:amtrak.com`,
    `(after:${startDate} before:${endDate}) from:marriott.com`
  ];
  
  const parentFolderId = '1HjZxebwmw1XjWlZT9eWgx7Igrxa1pM3M';
  const parentFolder = DriveApp.getFolderById(parentFolderId);
  
  let savedCount = 0;
  let processedEmails = new Set(); // Prevent duplicate processing
  let monthlyFolders = {}; // Cache folders
  
  // Pre-create monthly folders and clear them once
  const currentMonthName = Utilities.formatDate(currentMonth, Session.getScriptTimeZone(), 'yyyy-MM');
  const previousMonthName = Utilities.formatDate(previousMonth, Session.getScriptTimeZone(), 'yyyy-MM');
  const months = [previousMonthName, currentMonthName];
  
  Logger.log(`📁 Target months: ${months.join(', ')}`);
  
  for (const monthName of months) {
    monthlyFolders[monthName] = getOrCreateSubfolder(parentFolder, monthName);
    clearFolderContents(monthlyFolders[monthName]);
  }
  
  // Process each query
  for (const query of queries) {
    Logger.log(`🔍 Processing query: ${query}`);
    const threads = GmailApp.search(query, 0, 50); // Reduced batch size
    Logger.log(`📧 Found ${threads.length} email threads for this query`);
    
    if (threads.length === 0) {
      Logger.log(`⚠️ No emails found for query: ${query}`);
      continue;
    }
    
    for (const thread of threads) {
      const messages = thread.getMessages();
      Logger.log(`📨 Processing thread with ${messages.length} messages`);
      
      for (const message of messages) {
        const messageId = message.getId();
        const from = message.getFrom().toLowerCase();
        const subject = message.getSubject();
        const msgDate = message.getDate();
        const monthFolderName = Utilities.formatDate(msgDate, Session.getScriptTimeZone(), 'yyyy-MM');
        
        Logger.log(`📮 Email: From=${from}, Subject="${subject.substring(0, 50)}...", Date=${monthFolderName}`);
        
        // Skip if already processed
        if (processedEmails.has(messageId)) {
          Logger.log(`⏭️ Already processed: ${messageId}`);
          continue;
        }
        processedEmails.add(messageId);
        
        // Skip if not in our target months (current and previous only)
        if (!monthlyFolders[monthFolderName]) {
          Logger.log(`⏭️ Skipping email from ${monthFolderName} - outside target range (valid: ${Object.keys(monthlyFolders).join(', ')})`);
          continue;
        }
        
        const timestamp = Utilities.formatDate(msgDate, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
        const monthFolder = monthlyFolders[monthFolderName];
        
        Logger.log(`🎯 Processing email in ${monthFolderName} folder`);
        
        // Route to appropriate processor
        let processed = false;
        try {
          if (from.includes('amtrak.com')) {
            Logger.log(`🚂 Routing to Amtrak processor (from: ${from})`);
            processed = processAmtrakReceiptOptimized(message, monthFolder, timestamp);
          } else if (from.includes('marriott.com')) {
            Logger.log(`🏨 Routing to Marriott processor (from: ${from})`);
            processed = processMarriottReceiptOptimized(message, monthFolder, timestamp);
          } else if (isUberEmail(from)) {
            Logger.log(`🚗 Routing to Uber processor (from: ${from})`);
            processed = processUberReceiptOptimized(message, monthFolder, timestamp);
          } else {
            Logger.log(`❓ Unknown sender, skipping: ${from}`);
          }
          
          if (processed) {
            savedCount++;
            Logger.log(`✅ Successfully processed email #${savedCount}`);
          } else {
            Logger.log(`❌ Email was not processed (failed filters or processing)`);
          }
        } catch (error) {
          Logger.log(`❌ Error processing message ${messageId}: ${error.toString()}`);
        }
        
        // Add small delay every 10 emails to prevent timeout
        if (savedCount % 10 === 0) {
          Utilities.sleep(100);
        }
      }
    }
  }
  
  const endTime = new Date().getTime();
  const duration = (endTime - startTime) / 1000;
  Logger.log(`✅ Total saved receipts: ${savedCount} in ${duration} seconds`);
}

// === OPTIMIZED AMTRAK PROCESSING ===
function processAmtrakReceiptOptimized(message, monthFolder, timestamp) {
  const subject = message.getSubject();
  const plainText = message.getPlainBody();
  
  Logger.log(`🚂 Amtrak - Subject: "${subject}"`);
  
  // Quick filter first
  if (!isAmtrakReceiptFast(subject)) {
    Logger.log(`❌ Amtrak failed fast filter`);
    return false;
  }
  
  // Only get HTML if needed
  if (!isAmtrakReceipt(subject, plainText)) {
    Logger.log(`❌ Amtrak failed detailed filter`);
    return false;
  }

  try {
    Logger.log(`🚂 Creating Amtrak PDF with complete email content`);
    
    // Get the raw HTML email body without any modifications
    const rawHtml = message.getBody();
    
    // Create enhanced HTML specifically for Amtrak receipts
    const amtrakHtml = createAmtrakReceiptHtml(rawHtml);
    
    const pdf = HtmlService.createHtmlOutput(amtrakHtml)
      .setWidth(850)   // Wider to accommodate full tables
      .setHeight(1400) // Taller for complete content
      .getAs('application/pdf');
    pdf.setName(`${timestamp}_amtrak_receipt.pdf`);
    monthFolder.createFile(pdf);
    Logger.log(`✅ Amtrak PDF saved with complete content: ${timestamp}_amtrak_receipt.pdf`);
    return true;
  } catch (error) {
    Logger.log(`❌ Amtrak PDF creation error: ${error.toString()}`);
    
    // Fallback: try creating a text file if PDF fails
    try {
      Logger.log(`🚂 Amtrak PDF failed, trying text fallback`);
      const textBlob = Utilities.newBlob(plainText, 'text/plain', `${timestamp}_amtrak_receipt_fallback.txt`);
      monthFolder.createFile(textBlob);
      Logger.log(`⚠️ Amtrak text fallback saved: ${timestamp}_amtrak_receipt_fallback.txt`);
      return true;
    } catch (fallbackError) {
      Logger.log(`❌ Amtrak fallback also failed: ${fallbackError.toString()}`);
      return false;
    }
  }
}

function createAmtrakReceiptHtml(originalHtml) {
  // Minimal processing to preserve all content, especially tables and dollar amounts
  let processedHtml = originalHtml
    // Remove only dangerous scripts but keep everything else
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
    // Remove potentially problematic event handlers
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    // Ensure tables are properly formatted
    .replace(/<table(?![^>]*border)/gi, '<table border="1" cellpadding="6" cellspacing="0"')
    // Ensure proper width for content
    .replace(/width\s*:\s*\d+px/gi, 'width: 100%')
    .replace(/max-width\s*:\s*\d+px/gi, 'max-width: 100%');

  // Comprehensive CSS specifically for Amtrak receipts
  const amtrakStyles = `
    <style>
      * {
        box-sizing: border-box;
      }
      body { 
        font-family: Arial, Helvetica, sans-serif; 
        margin: 20px; 
        font-size: 13px; 
        line-height: 1.5;
        color: #000;
        background: white;
      }
      table { 
        width: 100% !important; 
        border-collapse: collapse !important; 
        margin: 15px 0 !important; 
        page-break-inside: avoid;
        border: 1px solid #333 !important;
      }
      td, th { 
        padding: 8px !important; 
        border: 1px solid #666 !important; 
        text-align: left !important;
        vertical-align: top !important;
        word-wrap: break-word !important;
        font-size: 12px !important;
      }
      th {
        background-color: #f0f0f0 !important;
        font-weight: bold !important;
      }
      .amount, .total, .price {
        text-align: right !important;
        font-weight: bold !important;
        white-space: nowrap !important;
      }
      h1, h2, h3 { 
        margin: 20px 0 10px 0 !important; 
        page-break-after: avoid;
        color: #000 !important;
      }
      .receipt-header {
        text-align: center;
        margin-bottom: 25px;
        border-bottom: 2px solid #000;
        padding-bottom: 15px;
      }
      .reservation-info {
        background-color: #f9f9f9;
        padding: 10px;
        margin: 15px 0;
        border: 1px solid #ccc;
      }
      .billing-section {
        margin: 20px 0;
        padding: 15px;
        border: 2px solid #000;
      }
      img {
        max-width: 200px !important;
        height: auto !important;
      }
      /* Ensure dollar amounts are visible */
      [class*="amount"], [class*="total"], [class*="price"], 
      td:contains("$"), th:contains("$") {
        min-width: 80px !important;
        text-align: right !important;
        font-weight: bold !important;
      }
      @media print {
        body { margin: 10px; }
        table { page-break-inside: avoid; }
        .no-print { display: none; }
      }
    </style>
  `;
  
  // Wrap in proper HTML structure if needed
  if (!processedHtml.includes('<html>')) {
    processedHtml = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Amtrak Sales Receipt</title>
          ${amtrakStyles}
        </head>
        <body>
          <div class="receipt-header">
            <h1>AMTRAK SALES RECEIPT</h1>
          </div>
          ${processedHtml}
        </body>
      </html>
    `;
  } else {
    // Insert styles into existing HTML
    processedHtml = processedHtml.replace(/<head[^>]*>/i, `<head>${amtrakStyles}`);
  }
  
  return processedHtml;
}

function isAmtrakReceiptFast(subject) {
  const result = /sales receipt|ticket confirmation|booking confirmation|receipt|eticket/i.test(subject);
  Logger.log(`🔍 Amtrak fast filter - Subject: "${subject}" -> ${result}`);
  return result;
}

// === OPTIMIZED MARRIOTT PROCESSING ===
function processMarriottReceiptOptimized(message, monthFolder, timestamp) {
  const subject = message.getSubject();
  
  Logger.log(`🏨 Marriott - Subject: "${subject}"`);
  
  // For Marriott, be more permissive if there are attachments
  const attachments = message.getAttachments();
  const hasAttachments = attachments.length > 0;
  
  Logger.log(`🏨 Marriott has ${attachments.length} attachments`);
  
  // Quick subject filter - more lenient if attachments exist
  if (!isMarriottReceiptFast(subject) && !hasAttachments) {
    Logger.log(`❌ Marriott failed fast filter and has no attachments`);
    return false;
  }
  
  let saved = false;

  try {
    // Prioritize attachments over email body - focus on receipt attachments
    if (attachments.length > 0) {
      Logger.log(`🏨 Processing ${attachments.length} Marriott attachments:`);
      
      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];
        Logger.log(`📎 Attachment ${i+1}: ${attachment.getName()}, size: ${attachment.getSize()} bytes`);
        
        if (isValidMarriottAttachmentFast(attachment)) {
          const originalName = attachment.getName();
          const ext = getFileExtension(originalName);
          
          // Create descriptive filename preserving some original info
          let newFileName;
          if (originalName.toLowerCase().includes('folio')) {
            newFileName = `${timestamp}_marriott_folio.${ext}`;
          } else if (originalName.toLowerCase().includes('invoice')) {
            newFileName = `${timestamp}_marriott_invoice.${ext}`;
          } else {
            newFileName = `${timestamp}_marriott_receipt.${ext}`;
          }
          
          const savedFile = monthFolder.createFile(attachment.copyBlob());
          savedFile.setName(newFileName);
          Logger.log(`✅ Marriott receipt attachment saved: ${newFileName} (original: ${originalName})`);
          saved = true;
          break; // Only save the first valid receipt attachment
        } else {
          Logger.log(`❌ Attachment "${attachment.getName()}" rejected - not a receipt`);
        }
      }
      
      if (!saved) {
        Logger.log(`⚠️ No valid receipt attachments found among ${attachments.length} attachments`);
      }
    }
    
    // Fallback to email PDF only if no receipt attachments found
    if (!saved) {
      // Check if email content suggests it's a receipt
      const plainText = message.getPlainBody();
      if (isMarriottReceipt(subject, plainText) || hasAttachments) {
        Logger.log(`🏨 No receipt attachments found, creating PDF from email content`);
        const fullHtml = getFullHtmlForPdf(message.getBody(), 'Marriott Email Receipt');
        const pdf = HtmlService.createHtmlOutput(fullHtml)
          .setWidth(800)
          .setHeight(1200)
          .getAs('application/pdf');
        pdf.setName(`${timestamp}_marriott_email.pdf`);
        monthFolder.createFile(pdf);
        Logger.log(`✅ Marriott email PDF saved: ${timestamp}_marriott_email.pdf`);
        saved = true;
      } else {
        Logger.log(`❌ Marriott failed detailed receipt check and no valid attachments`);
      }
    }
    
    return saved;
  } catch (error) {
    Logger.log(`❌ Marriott processing error: ${error.toString()}`);
    return false;
  }
}

function isMarriottReceiptFast(subject) {
  // Much more permissive for Marriott since they use generic subjects
  const result = /receipt|folio|invoice|confirmation|checkout|stay|bill|residence inn|marriott/i.test(subject) && 
         !/promotion|offer|newsletter|marketing|survey|welcome|points.*earn/i.test(subject);
  Logger.log(`🔍 Marriott fast filter - Subject: "${subject}" -> ${result}`);
  return result;
}

function isValidMarriottAttachmentFast(attachment) {
  const fileName = attachment.getName().toLowerCase();
  const fileSize = attachment.getSize();
  
  // Check file extension
  const validExtensions = ['pdf', 'png', 'jpg', 'jpeg'];
  const extension = fileName.split('.').pop();
  const hasValidExtension = validExtensions.includes(extension);
  
  // Check for receipt-specific filename patterns
  const receiptPatterns = [
    /folio/i,           // Hotel folios (like your "289904Folio-A_2...")
    /invoice/i,         // Hotel invoices
    /receipt/i,         // General receipts
    /bill/i,            // Hotel bills
    /\d{5,}/,          // Contains 5+ digit confirmation/folio numbers
    /conf/i,           // Confirmation documents
    /checkout/i        // Checkout receipts
  ];
  
  const hasReceiptPattern = receiptPatterns.some(pattern => pattern.test(fileName));
  
  // Size check - should be substantial (at least 5KB for a real receipt)
  const hasValidSize = fileSize > 5000;
  
  const isValid = hasValidExtension && hasReceiptPattern && hasValidSize;
  
  Logger.log(`📎 Marriott attachment validation: "${fileName}" (${fileSize} bytes)`);
  Logger.log(`   - Valid extension (${extension}): ${hasValidExtension}`);
  Logger.log(`   - Receipt pattern: ${hasReceiptPattern}`);
  Logger.log(`   - Valid size (>5KB): ${hasValidSize}`);
  Logger.log(`   - Overall valid: ${isValid}`);
  
  return isValid;
}

// === OPTIMIZED UBER PROCESSING ===
function processUberReceiptOptimized(message, monthFolder, timestamp) {
  const subject = message.getSubject();
  
  // Quick filter
  if (!isUberReceiptFast(subject)) {
    return false;
  }
  
  const plainText = message.getPlainBody();
  
  // More thorough check
  if (!isUberReceipt(subject, plainText, '')) {
    Logger.log(`❌ Skipped Uber: ${subject.substring(0, 50)}...`);
    return false;
  }

  try {
    // Generate unique filename for multiple trips per day
    const baseFilename = generateUniqueUberFilename(message, monthFolder, timestamp, plainText);
    
    // Check if this is a duplicate trip (null filename means skip)
    if (!baseFilename) {
      return false; // Skip this duplicate trip
    }
    
    // Check if file already exists to prevent duplicates
    if (fileExistsInFolder(monthFolder, baseFilename)) {
      Logger.log(`⚠️ Uber receipt already exists: ${baseFilename}`);
      return false;
    }
    
    Logger.log(`🚗 Creating Uber PDF with complete email content`);
    
    // Get the raw HTML email body and create Uber-specific formatting
    const rawHtml = message.getBody();
    const uberHtml = createUberReceiptHtml(rawHtml);
    
    const pdf = HtmlService.createHtmlOutput(uberHtml)
      .setWidth(850)   // Wider for proper content display
      .setHeight(1400) // Taller for complete trip details
      .getAs('application/pdf');
    pdf.setName(baseFilename);
    monthFolder.createFile(pdf);
    Logger.log(`✅ Uber saved with complete content: ${baseFilename}`);
    return true;
  } catch (error) {
    Logger.log(`❌ Uber error: ${error.toString()}`);
    // Quick fallback to text with unique naming
    try {
      const fallbackFilename = generateUniqueUberFilename(message, monthFolder, timestamp, plainText, true);
      if (!fallbackFilename) {
        Logger.log(`⚠️ Duplicate Uber trip detected in fallback - skipping`);
        return false;
      }
      const textBlob = Utilities.newBlob(plainText, 'text/plain', fallbackFilename);
      monthFolder.createFile(textBlob);
      Logger.log(`⚠️ Uber fallback saved: ${fallbackFilename}`);
      return true;
    } catch (fallbackError) {
      return false;
    }
  }
}

function createUberReceiptHtml(originalHtml) {
  // Minimal processing to preserve all Uber receipt content
  let processedHtml = originalHtml
    // Remove only problematic elements, keep everything else
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
    // Remove event handlers but keep all other attributes
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    // Ensure tables are properly formatted
    .replace(/<table(?![^>]*border)/gi, '<table border="1" cellpadding="8" cellspacing="0"')
    // Preserve image elements but make them PDF-friendly
    .replace(/<img([^>]*?)>/gi, '<img$1 style="max-width: 200px; height: auto; display: block; margin: 5px auto;">')
    // Ensure proper width handling
    .replace(/width\s*:\s*\d+px/gi, 'width: 100%')
    .replace(/max-width\s*:\s*\d+px/gi, 'max-width: 100%');

  // Comprehensive CSS specifically for Uber receipts
  const uberStyles = `
    <style>
      * {
        box-sizing: border-box;
      }
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; 
        margin: 20px; 
        font-size: 14px; 
        line-height: 1.6;
        color: #000;
        background: white;
      }
      table { 
        width: 100% !important; 
        border-collapse: collapse !important; 
        margin: 15px 0 !important; 
        page-break-inside: avoid;
        border: 1px solid #e0e0e0 !important;
      }
      td, th { 
        padding: 12px !important; 
        border: 1px solid #e0e0e0 !important; 
        text-align: left !important;
        vertical-align: top !important;
        word-wrap: break-word !important;
        font-size: 13px !important;
      }
      th {
        background-color: #f8f8f8 !important;
        font-weight: 600 !important;
      }
      /* Uber-specific styling */
      .uber-header {
        text-align: center;
        margin-bottom: 30px;
        padding: 20px;
        border-bottom: 3px solid #000;
      }
      .trip-details {
        background-color: #f9f9f9;
        padding: 15px;
        margin: 20px 0;
        border-radius: 8px;
        border: 1px solid #ddd;
      }
      .fare-breakdown {
        margin: 20px 0;
        padding: 15px;
        border: 2px solid #000;
        border-radius: 5px;
      }
      .amount, .total, .fare, .price {
        text-align: right !important;
        font-weight: bold !important;
        white-space: nowrap !important;
        min-width: 80px !important;
      }
      .driver-info {
        background-color: #f0f7ff;
        padding: 10px;
        margin: 15px 0;
        border-left: 4px solid #0066cc;
      }
      h1, h2, h3 { 
        margin: 20px 0 10px 0 !important; 
        page-break-after: avoid;
        color: #000 !important;
      }
      .receipt-title {
        font-size: 24px !important;
        font-weight: bold !important;
        color: #000 !important;
        text-align: center;
      }
      img {
        max-width: 150px !important;
        height: auto !important;
        display: block !important;
        margin: 10px auto !important;
      }
      /* Ensure all dollar amounts are visible */
      [class*="amount"], [class*="total"], [class*="fare"], [class*="price"],
      td:contains("$"), th:contains("$"), span:contains("$"), div:contains("$") {
        font-weight: bold !important;
        color: #000 !important;
      }
      .payment-method {
        background-color: #fff9e6;
        padding: 10px;
        border: 1px solid #ffcc00;
        margin: 10px 0;
      }
      @media print {
        body { margin: 10px; }
        table { page-break-inside: avoid; }
        .no-print { display: none; }
      }
      /* Fix any potential text color issues */
      * {
        color: #000 !important;
      }
      a {
        color: #0066cc !important;
        text-decoration: underline !important;
      }
    </style>
  `;
  
  // Wrap in proper HTML structure if needed
  if (!processedHtml.includes('<html>')) {
    processedHtml = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Uber Trip Receipt</title>
          ${uberStyles}
        </head>
        <body>
          <div class="uber-header">
            <h1 class="receipt-title">UBER RECEIPT</h1>
          </div>
          ${processedHtml}
        </body>
      </html>
    `;
  } else {
    // Insert styles into existing HTML
    processedHtml = processedHtml.replace(/<head[^>]*>/i, `<head>${uberStyles}`);
    // Ensure we don't have white text on white background
    processedHtml = processedHtml.replace(/color\s*:\s*white/gi, 'color: #000');
    processedHtml = processedHtml.replace(/color\s*:\s*#fff/gi, 'color: #000');
  }
  
  return processedHtml;
}

function isUberReceiptFast(subject) {
  const result = /receipt|trip.*uber|your.*ride|thank.*riding|uber.*trip/i.test(subject) &&
         !/promotion|discount|offer|free.*ride|referral/i.test(subject);
  Logger.log(`🔍 Uber fast filter - Subject: "${subject}" -> ${result}`);
  return result;
}

// === NEW UBER FILENAME GENERATION ===
function extractUberDateFromTextFast(text) {
  // Simplified date extraction
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s*202[45]\b/i);
  if (match) {
    const date = new Date(`${match[1]} ${match[2]}, ${match[3] || '2025'}`);
    if (!isNaN(date.getTime())) {
      return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMdd');
    }
  }
  return null;
}

function generateUniqueUberFilename(message, monthFolder, timestamp, plainText, isFallback = false) {
  const dateFromBody = extractUberDateFromTextFast(plainText) || timestamp.substring(0, 8);
  const timeFromTimestamp = timestamp.substring(9); // Gets HHmmss part
  
  // Try to extract trip details for more unique naming
  const tripDetails = extractUberTripDetails(plainText);
  
  // Build filename components
  let baseFilename;
  const extension = isFallback ? '.txt' : '.pdf';
  
  if (tripDetails.pickupLocation || tripDetails.dropoffLocation || tripDetails.amount) {
    // Use trip details if available
    const locationPart = (tripDetails.pickupLocation || tripDetails.dropoffLocation || '').substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');
    const amountPart = tripDetails.amount ? `_${tripDetails.amount.replace(/[^0-9.]/g, '')}` : '';
    baseFilename = `${dateFromBody}_${timeFromTimestamp}_Uber${locationPart ? '_' + locationPart : ''}${amountPart}${extension}`;
  } else {
    // Fallback to timestamp-based naming
    baseFilename = `${dateFromBody}_${timeFromTimestamp}_Uber_Receipt${extension}`;
  }
  
  // Ensure filename is unique in the folder
  return ensureUniqueFilename(monthFolder, baseFilename);
}

function extractUberTripDetails(plainText) {
  const details = {
    pickupLocation: null,
    dropoffLocation: null,
    amount: null
  };
  
  // Extract pickup location
  const pickupPatterns = [
    /(?:from|pickup)[:\s]*([^\n\r]{1,50}?)(?:\s*to\s|\n|\r|$)/i,
    /pickup[:\s]*([^\n\r]{1,50}?)(?:\n|\r|$)/i
  ];
  
  for (const pattern of pickupPatterns) {
    const match = plainText.match(pattern);
    if (match && match[1] && match[1].trim().length > 2) {
      details.pickupLocation = match[1].trim();
      break;
    }
  }
  
  // Extract dropoff location
  const dropoffPatterns = [
    /(?:to|dropoff|destination)[:\s]*([^\n\r]{1,50}?)(?:\n|\r|$)/i,
    /dropoff[:\s]*([^\n\r]{1,50}?)(?:\n|\r|$)/i
  ];
  
  for (const pattern of dropoffPatterns) {
    const match = plainText.match(pattern);
    if (match && match[1] && match[1].trim().length > 2) {
      details.dropoffLocation = match[1].trim();
      break;
    }
  }
  
  // Extract amount
  const amountPatterns = [
    /total[:\s]*\$?([\d,]+\.?\d*)/i,
    /charged[:\s]*\$?([\d,]+\.?\d*)/i,
    /fare[:\s]*\$?([\d,]+\.?\d*)/i,
    /\$([0-9,]+\.?\d{0,2})/
  ];
  
  for (const pattern of amountPatterns) {
    const match = plainText.match(pattern);
    if (match && match[1]) {
      details.amount = `${match[1]}`;
      break;
    }
  }
  
  return details;
}

function fileExistsInFolder(folder, filename) {
  try {
    const files = folder.getFilesByName(filename);
    return files.hasNext();
  } catch (error) {
    // If there's an error checking, assume it doesn't exist
    Logger.log(`⚠️ Error checking if file exists: ${error.toString()}`);
    return false;
  }
}

function checkForSimilarUberTrip(folder, date, amount) {
  try {
    const files = folder.getFiles();
    const dateStr = date.substring(0, 8); // YYYYMMDD
    const amountStr = amount || '';
    
    while (files.hasNext()) {
      const file = files.next();
      const fileName = file.getName();
      
      // Check if it's an Uber file from the same date with same amount
      if (fileName.includes('Uber') && 
          fileName.startsWith(dateStr) && 
          amountStr && 
          fileName.includes(amountStr)) {
        Logger.log(`🔍 Found similar trip: ${fileName} (looking for date: ${dateStr}, amount: ${amountStr})`);
        return true;
      }
    }
    return false;
  } catch (error) {
    Logger.log(`⚠️ Error checking for similar trips: ${error.toString()}`);
    return false;
  }
}

function ensureUniqueFilename(folder, baseFilename) {
  let filename = baseFilename;
  let counter = 1;
  
  // Keep trying until we find a unique filename
  while (fileExistsInFolder(folder, filename)) {
    const lastDotIndex = baseFilename.lastIndexOf('.');
    if (lastDotIndex === -1) {
      filename = `${baseFilename}_${counter}`;
    } else {
      const nameWithoutExt = baseFilename.substring(0, lastDotIndex);
      const extension = baseFilename.substring(lastDotIndex);
      filename = `${nameWithoutExt}_${counter}${extension}`;
    }
    counter++;
  }
  
  return filename;
}

// === OPTIMIZED UTILITY FUNCTIONS ===
function getFullHtmlForPdf(originalHtml, title) {
  // Preserve most HTML content but make it PDF-friendly
  let cleaned = originalHtml
    // Remove only problematic scripts and external resources
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '')
    .replace(/onclick\s*=\s*"[^"]*"/gi, '')
    .replace(/onload\s*=\s*"[^"]*"/gi, '')
    // Keep images but make them PDF-friendly
    .replace(/<img([^>]*?)>/gi, '<img$1 style="max-width: 100%; height: auto;">')
    // Ensure proper table formatting
    .replace(/<table/gi, '<table border="1" cellpadding="4" cellspacing="0"')
    // Fix any width issues
    .replace(/width\s*:\s*(\d+)px/gi, 'width: 100%')
    .replace(/max-width\s*:\s*(\d+)px/gi, 'max-width: 100%');

  // Add comprehensive CSS for better PDF rendering
  const pdfStyles = `
    <style>
      body { 
        font-family: Arial, sans-serif; 
        margin: 20px; 
        font-size: 12px; 
        line-height: 1.4;
        color: #333;
      }
      table { 
        width: 100% !important; 
        border-collapse: collapse; 
        margin: 10px 0; 
        page-break-inside: avoid;
      }
      td, th { 
        padding: 8px; 
        border: 1px solid #ddd; 
        text-align: left;
        vertical-align: top;
      }
      th {
        background-color: #f5f5f5;
        font-weight: bold;
      }
      h1, h2, h3 { 
        margin: 15px 0 10px 0; 
        page-break-after: avoid;
      }
      .receipt-header {
        text-align: center;
        margin-bottom: 20px;
      }
      .amount {
        font-weight: bold;
        text-align: right;
      }
      img {
        max-width: 100% !important;
        height: auto !important;
        display: block;
        margin: 5px auto;
      }
      @media print {
        body { margin: 10px; }
        table { page-break-inside: avoid; }
      }
    </style>
  `;
  
  // Wrap in proper HTML structure if needed
  if (!cleaned.includes('<html>')) {
    cleaned = `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${title}</title>
          ${pdfStyles}
        </head>
        <body>
          <div class="receipt-header">
            <h2>${title}</h2>
          </div>
          ${cleaned}
        </body>
      </html>
    `;
  } else {
    // Insert styles into existing HTML
    cleaned = cleaned.replace(/<head[^>]*>/i, `<head>${pdfStyles}`);
  }
  
  return cleaned;
}

function getMinimalHtml(originalHtml, title) {
  // Keep this for fallback, but use getFullHtmlForPdf for receipts
  return getFullHtmlForPdf(originalHtml, title);
}

function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

// Keep existing utility functions but add caching
const folderCache = {};
function getOrCreateSubfolder(parentFolder, subfolderName) {
  const cacheKey = `${parentFolder.getId()}_${subfolderName}`;
  if (folderCache[cacheKey]) {
    return folderCache[cacheKey];
  }
  
  const folders = parentFolder.getFoldersByName(subfolderName);
  const folder = folders.hasNext() ? folders.next() : parentFolder.createFolder(subfolderName);
  folderCache[cacheKey] = folder;
  return folder;
}

function clearFolderContents(folder) {
  const files = folder.getFiles();
  const filesToTrash = [];
  
  // Batch collect files first
  while (files.hasNext()) {
    filesToTrash.push(files.next());
  }
  
  // Then trash them
  filesToTrash.forEach(file => file.setTrashed(true));
}

// Keep existing detection functions
function isUberEmail(from) {
  return /uber\.com|noreply@uber\.com|receipts@uber\.com|no-reply@uber\.com|trip-receipts@uber\.com/i.test(from);
}

function isAmtrakReceipt(subject, plainText) {
  const patterns = [
    /sales receipt/i, 
    /ticket confirmation/i, 
    /booking confirmation/i, 
    /receipt.*train/i,
    /eticket/i,
    /reservation number/i,
    /purchase.*summary/i,
    /billing information/i
  ];
  const result = patterns.some(pattern => pattern.test(subject) || pattern.test(plainText));
  Logger.log(`🔍 Amtrak detailed filter - Subject: "${subject}" -> ${result}`);
  return result;
}

function isMarriottReceipt(subject, plainText) {
  const receiptPatterns = [/receipt/i, /folio/i, /invoice/i, /confirmation/i, /checkout/i, /stay.*summary/i, /billing/i];
  const excludePatterns = [/promotion/i, /offer/i, /newsletter/i, /marketing/i];
  
  const hasReceipt = receiptPatterns.some(p => p.test(subject) || p.test(plainText));
  const isExcluded = excludePatterns.some(p => p.test(subject) || p.test(plainText));
  
  return hasReceipt && !isExcluded;
}

function isUberReceipt(subject, plainText, htmlText) {
  const receiptSubjects = [/receipt/i, /trip.*with.*uber/i, /your.*ride/i, /thank.*you.*riding/i, /uber.*trip/i];
  const receiptPatterns = [/total.*[$₹€£¥]\s*\d+(\.\d{2})?/i, /fare.*[$₹€£¥]\s*\d+(\.\d{2})?/i, /payment.*method/i, /(visa|mastercard|apple pay|amex|paypal)/i];
  const promotionalPatterns = [/promotion/i, /discount/i, /offer/i, /save.*\$/i, /free.*ride/i, /referral/i];
  
  const hasReceiptSubject = receiptSubjects.some(pattern => pattern.test(subject));
  const hasReceiptContent = receiptPatterns.some(pattern => pattern.test(plainText) || pattern.test(htmlText));
  const isPromotional = promotionalPatterns.some(pattern => pattern.test(subject) || pattern.test(plainText));
  
  return (hasReceiptSubject || hasReceiptContent) && !isPromotional;
}