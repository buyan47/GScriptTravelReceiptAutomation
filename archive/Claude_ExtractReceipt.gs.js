/**
 * ============================================================================
 * Gmail Travel Receipt Organizer - CLAUDE VERSION (COMBINED)
 * ============================================================================
 *
 * This is a single-file version combining all modules.
 * Simply copy this entire file and paste it into Code.gs in your Apps Script project.
 *
 * Version: Claude AI Implementation
 * Created: 2025-12-13
 * Structure: EigenXReceipts/December 2025/Claude/
 *
 * ============================================================================
 */


// ============================================================================
// CONFIGURATION
// ============================================================================

var CONFIG = {
  // Parent folder name in Google Drive
  PARENT_FOLDER_NAME: 'EigenXReceipts',

  // Use monthly organization (creates folders like "December 2025")
  USE_MONTHLY_FOLDERS: true,

  // Version subfolder name (use "Claude" for Claude version, "Gemini" for Gemini version)
  VERSION_FOLDER_NAME: 'Claude',

  // Name of the Google Sheets spreadsheet for tracking (created in monthly/Claude folder)
  SPREADSHEET_NAME: 'Receipt Tracker - Claude',

  // Gmail label to mark processed emails
  PROCESSED_LABEL: 'Receipts/Processed-Claude',

  // Gmail search query for finding receipts
  // Customize this to match your receipt emails
  // Note: Uber emails don't have attachments, so we search for them separately
  GMAIL_QUERY: '(has:attachment (from:amtrak.com OR subject:hotel OR subject:reservation OR subject:receipt)) OR (from:uber.com subject:(trip receipt))',

  // Vendors to organize by - these will create subfolders in Drive
  VENDORS: ['Amtrak', 'Uber', 'Hotel', 'Other'],

  // Maximum number of emails to process per run (to avoid timeout)
  MAX_EMAILS: 50,

  // Days to look back for emails (set to null for all emails)
  DAYS_BACK: 30,

  // File types to process
  ALLOWED_EXTENSIONS: ['pdf', 'png', 'jpg', 'jpeg', 'gif'],

  // Maximum file size in bytes (10MB)
  MAX_FILE_SIZE: 10 * 1024 * 1024,

  // Vendor detection patterns (case-insensitive)
  VENDOR_PATTERNS: {
    'Amtrak': ['amtrak', 'amtk'],
    'Uber': ['uber'],
    'Hotel': ['hotel', 'marriott', 'hilton', 'hyatt', 'ihg', 'best western', 'holiday inn', 'booking.com', 'hotels.com'],
    'Other': [] // catch-all
  },

  // Amount extraction regex patterns
  AMOUNT_PATTERNS: [
    /\$\s*(\d+[\d,]*\.?\d{0,2})/,           // $123.45 or $1,234.56
    /USD\s*(\d+[\d,]*\.?\d{0,2})/i,         // USD 123.45
    /total[:\s]+\$?\s*(\d+[\d,]*\.?\d{0,2})/i,  // Total: $123.45
    /amount[:\s]+\$?\s*(\d+[\d,]*\.?\d{0,2})/i  // Amount: $123.45
  ],

  // Date extraction regex patterns
  DATE_PATTERNS: [
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,          // 12/31/2024 or 1/1/24
    /(\d{4}-\d{2}-\d{2})/,                   // 2024-12-31
    /(\w+\s+\d{1,2},?\s+\d{4})/,            // December 31, 2024
    /(\d{1,2}\s+\w+\s+\d{4})/               // 31 December 2024
  ]
};

/**
 * Get configuration value
 */
function getConfig(key) {
  return CONFIG[key];
}

/**
 * Update configuration value
 */
function setConfig(key, value) {
  CONFIG[key] = value;
}


// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Initial setup function - run this first
 * Creates necessary folders and spreadsheet
 */
function setupInitial() {
  Logger.log('Starting initial setup...');

  try {
    // Create Drive folder structure
    var mainFolder = createMainFolder();
    Logger.log('Created main folder: ' + mainFolder.getName());

    // Create vendor subfolders
    var vendors = getConfig('VENDORS');
    for (var i = 0; i < vendors.length; i++) {
      var subfolder = createVendorFolder(mainFolder, vendors[i]);
      Logger.log('Created subfolder: ' + subfolder.getName());
    }

    // Create tracking spreadsheet
    var spreadsheet = createTrackingSpreadsheet();
    Logger.log('Created spreadsheet: ' + spreadsheet.getName());

    // Create Gmail label
    createProcessedLabel();
    Logger.log('Created Gmail label');

    Logger.log('Setup complete! You can now run processReceipts()');
    return 'Setup completed successfully';

  } catch (error) {
    Logger.log('Setup error: ' + error.toString());
    throw error;
  }
}

/**
 * Main function to process receipts
 * Run this manually or set up as a trigger
 */
function processReceipts() {
  Logger.log('Starting receipt processing...');

  var stats = {
    emailsProcessed: 0,
    attachmentsFound: 0,
    attachmentsSaved: 0,
    errors: 0
  };

  try {
    // Get the main Drive folder
    var mainFolder = getOrCreateMainFolder();

    // Get the tracking spreadsheet
    var spreadsheet = getOrCreateSpreadsheet();

    // Get Gmail threads
    var threads = getReceiptThreads();
    Logger.log('Found ' + threads.length + ' email threads to process');

    // Process each thread
    for (var i = 0; i < threads.length; i++) {
      try {
        var messages = threads[i].getMessages();

        for (var j = 0; j < messages.length; j++) {
          var message = messages[j];
          var result = processMessage(message, mainFolder, spreadsheet);

          stats.emailsProcessed++;
          stats.attachmentsFound += result.attachmentsFound;
          stats.attachmentsSaved += result.attachmentsSaved;
        }

        // Mark thread as processed
        markThreadAsProcessed(threads[i]);

      } catch (error) {
        Logger.log('Error processing thread: ' + error.toString());
        stats.errors++;
      }
    }

    Logger.log('Processing complete!');
    Logger.log('Stats: ' + JSON.stringify(stats));
    return stats;

  } catch (error) {
    Logger.log('Fatal error: ' + error.toString());
    throw error;
  }
}

/**
 * Process a single email message
 */
function processMessage(message, mainFolder, spreadsheet) {
  var result = {
    attachmentsFound: 0,
    attachmentsSaved: 0
  };

  var from = message.getFrom().toLowerCase();
  var attachments = message.getAttachments();
  result.attachmentsFound = attachments.length;

  Logger.log('Processing email from: ' + message.getFrom() + ' with ' + attachments.length + ' attachments');

  // Special handling for Uber emails (no attachments)
  if (from.indexOf('uber.com') !== -1 && attachments.length === 0) {
    try {
      Logger.log('Processing Uber email without attachment');

      // Get Uber folder
      var uberFolder = getVendorFolder(mainFolder, 'Uber');

      // Save email as PDF
      var file = saveEmailAsPDF(message, uberFolder);
      Logger.log('Saved Uber email as PDF: ' + file.getName());

      // Extract receipt data from email body
      var receiptData = extractReceiptDataFromEmail(message, file, 'Uber');

      // Add to spreadsheet
      addToSpreadsheet(spreadsheet, receiptData);
      Logger.log('Added to spreadsheet');

      result.attachmentsSaved++;

    } catch (error) {
      Logger.log('Error processing Uber email: ' + error.toString());
    }

    return result;
  }

  // Process regular attachments
  for (var i = 0; i < attachments.length; i++) {
    try {
      var attachment = attachments[i];

      // Check if attachment should be processed
      if (!shouldProcessAttachment(attachment)) {
        Logger.log('Skipping attachment: ' + attachment.getName());
        continue;
      }

      // Determine vendor
      var vendor = detectVendor(message, attachment);
      Logger.log('Detected vendor: ' + vendor);

      // Get vendor folder
      var vendorFolder = getVendorFolder(mainFolder, vendor);

      // Save attachment to Drive
      var file = saveAttachmentToDrive(attachment, vendorFolder);
      Logger.log('Saved file: ' + file.getName());

      // Extract receipt data
      var receiptData = extractReceiptData(file, message, vendor);

      // Add to spreadsheet
      addToSpreadsheet(spreadsheet, receiptData);
      Logger.log('Added to spreadsheet');

      result.attachmentsSaved++;

    } catch (error) {
      Logger.log('Error processing attachment: ' + error.toString());
    }
  }

  return result;
}

/**
 * Check if attachment should be processed
 */
function shouldProcessAttachment(attachment) {
  var name = attachment.getName().toLowerCase();
  var allowedExtensions = getConfig('ALLOWED_EXTENSIONS');
  var maxSize = getConfig('MAX_FILE_SIZE');

  // Check file extension
  var hasValidExtension = false;
  for (var i = 0; i < allowedExtensions.length; i++) {
    if (name.endsWith('.' + allowedExtensions[i])) {
      hasValidExtension = true;
      break;
    }
  }

  if (!hasValidExtension) {
    return false;
  }

  // Check file size
  if (attachment.getSize() > maxSize) {
    Logger.log('File too large: ' + attachment.getName());
    return false;
  }

  return true;
}

/**
 * Test function to verify setup
 */
function testSetup() {
  Logger.log('Testing setup...');

  // Test Drive folder
  var folder = getOrCreateMainFolder();
  Logger.log('✓ Drive folder accessible: ' + folder.getName());

  // Test spreadsheet
  var spreadsheet = getOrCreateSpreadsheet();
  Logger.log('✓ Spreadsheet accessible: ' + spreadsheet.getName());

  // Test Gmail label
  var label = getOrCreateProcessedLabel();
  Logger.log('✓ Gmail label accessible: ' + label.getName());

  // Test Gmail query
  var threads = GmailApp.search(getConfig('GMAIL_QUERY'), 0, 5);
  Logger.log('✓ Found ' + threads.length + ' test emails');

  Logger.log('All tests passed!');
  return 'Setup is working correctly';
}

/**
 * Reset function - removes all processed labels
 */
function resetProcessedEmails() {
  var label = getOrCreateProcessedLabel();
  var threads = label.getThreads();

  Logger.log('Removing label from ' + threads.length + ' threads');

  for (var i = 0; i < threads.length; i++) {
    threads[i].removeLabel(label);
  }

  Logger.log('Reset complete');
  return 'Removed processed label from ' + threads.length + ' threads';
}


// ============================================================================
// GMAIL HANDLER
// ============================================================================

/**
 * Get receipt threads from Gmail
 */
function getReceiptThreads() {
  var query = buildGmailQuery();
  var maxEmails = getConfig('MAX_EMAILS');

  Logger.log('Gmail query: ' + query);

  var threads = GmailApp.search(query, 0, maxEmails);
  return threads;
}

/**
 * Build Gmail search query
 */
function buildGmailQuery() {
  var baseQuery = getConfig('GMAIL_QUERY');
  var daysBack = getConfig('DAYS_BACK');
  var labelName = getConfig('PROCESSED_LABEL');

  // Exclude already processed emails
  var query = baseQuery + ' -label:' + labelName;

  // Add date filter if specified
  if (daysBack !== null && daysBack > 0) {
    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    var year = cutoffDate.getFullYear();
    var month = cutoffDate.getMonth() + 1;
    var day = cutoffDate.getDate();

    query += ' after:' + year + '/' + month + '/' + day;
  }

  return query;
}

/**
 * Get or create the "Processed" label
 */
function getOrCreateProcessedLabel() {
  var labelName = getConfig('PROCESSED_LABEL');
  var label = GmailApp.getUserLabelByName(labelName);

  if (!label) {
    label = createProcessedLabel();
  }

  return label;
}

/**
 * Create the "Processed" label
 */
function createProcessedLabel() {
  var labelName = getConfig('PROCESSED_LABEL');

  // Check if parent label exists (Receipts)
  var parts = labelName.split('/');
  var currentPath = '';

  for (var i = 0; i < parts.length; i++) {
    if (currentPath) {
      currentPath += '/' + parts[i];
    } else {
      currentPath = parts[i];
    }

    var existingLabel = GmailApp.getUserLabelByName(currentPath);
    if (!existingLabel) {
      GmailApp.createLabel(currentPath);
    }
  }

  return GmailApp.getUserLabelByName(labelName);
}

/**
 * Mark thread as processed
 */
function markThreadAsProcessed(thread) {
  var label = getOrCreateProcessedLabel();
  thread.addLabel(label);
}

/**
 * Detect vendor from email message
 */
function detectVendor(message, attachment) {
  var from = message.getFrom().toLowerCase();
  var subject = message.getSubject().toLowerCase();
  var filename = attachment.getName().toLowerCase();
  var body = message.getPlainBody().toLowerCase();

  var searchText = from + ' ' + subject + ' ' + filename + ' ' + body;

  var vendorPatterns = getConfig('VENDOR_PATTERNS');

  // Check each vendor pattern
  for (var vendor in vendorPatterns) {
    var patterns = vendorPatterns[vendor];

    for (var i = 0; i < patterns.length; i++) {
      if (searchText.indexOf(patterns[i]) !== -1) {
        return vendor;
      }
    }
  }

  // Default to 'Other' if no match
  return 'Other';
}

/**
 * Extract email metadata
 */
function getEmailMetadata(message) {
  return {
    from: message.getFrom(),
    subject: message.getSubject(),
    date: message.getDate(),
    body: message.getPlainBody()
  };
}


// ============================================================================
// DRIVE HANDLER
// ============================================================================

/**
 * Get or create the main Drive folder (version folder in current month)
 * Structure: EigenXReceipts/December 2025/Claude
 */
function getOrCreateMainFolder() {
  var parentFolderName = getConfig('PARENT_FOLDER_NAME');
  var useMonthly = getConfig('USE_MONTHLY_FOLDERS');
  var versionFolderName = getConfig('VERSION_FOLDER_NAME');

  // Get or create parent folder (e.g., EigenXReceipts)
  var parentFolder = getOrCreateSubfolder(DriveApp.getRootFolder(), parentFolderName);

  // Get or create monthly folder if enabled
  if (useMonthly) {
    var monthFolder = getOrCreateMonthlyFolder(parentFolder);
    // Create version subfolder in monthly folder
    return getOrCreateSubfolder(monthFolder, versionFolderName);
  } else {
    // Create version folder directly in parent
    return getOrCreateSubfolder(parentFolder, versionFolderName);
  }
}

/**
 * Create the main Drive folder
 */
function createMainFolder() {
  return getOrCreateMainFolder();
}

/**
 * Get or create monthly folder (e.g., "December 2025")
 */
function getOrCreateMonthlyFolder(parentFolder) {
  var now = new Date();
  var monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
  var year = now.getFullYear();
  var monthName = monthNames[now.getMonth()];
  var monthFolderName = monthName + ' ' + year;

  return getOrCreateSubfolder(parentFolder, monthFolderName);
}

/**
 * Get or create a subfolder
 */
function getOrCreateSubfolder(parentFolder, folderName) {
  var folders = parentFolder.getFoldersByName(folderName);

  if (folders.hasNext()) {
    return folders.next();
  } else {
    return parentFolder.createFolder(folderName);
  }
}

/**
 * Get or create a vendor subfolder
 */
function getVendorFolder(parentFolder, vendorName) {
  var folders = parentFolder.getFoldersByName(vendorName);

  if (folders.hasNext()) {
    return folders.next();
  } else {
    return createVendorFolder(parentFolder, vendorName);
  }
}

/**
 * Create a vendor subfolder
 */
function createVendorFolder(parentFolder, vendorName) {
  return parentFolder.createFolder(vendorName);
}

/**
 * Save attachment to Google Drive
 */
function saveAttachmentToDrive(attachment, folder) {
  var filename = attachment.getName();
  var blob = attachment.copyBlob();

  // Check if file already exists
  var existingFiles = folder.getFilesByName(filename);

  if (existingFiles.hasNext()) {
    // File exists, create with timestamp
    var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    var nameParts = filename.split('.');
    var extension = nameParts.pop();
    var baseName = nameParts.join('.');
    filename = baseName + '_' + timestamp + '.' + extension;
  }

  // Create file
  var file = folder.createFile(blob);
  file.setName(filename);

  return file;
}

/**
 * Save email as PDF to Google Drive
 */
function saveEmailAsPDF(message, folder) {
  var subject = message.getSubject();
  var date = message.getDate();
  var from = message.getFrom();
  var body = message.getBody();

  // Create HTML content for the PDF
  var htmlContent = '<html><head><style>' +
    'body { font-family: Arial, sans-serif; margin: 20px; }' +
    '.header { background-color: #f0f0f0; padding: 10px; margin-bottom: 20px; }' +
    '.label { font-weight: bold; }' +
    '</style></head><body>' +
    '<div class="header">' +
    '<div><span class="label">From:</span> ' + from + '</div>' +
    '<div><span class="label">Date:</span> ' + Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') + '</div>' +
    '<div><span class="label">Subject:</span> ' + subject + '</div>' +
    '</div>' +
    '<div class="content">' + body + '</div>' +
    '</body></html>';

  // Create blob from HTML
  var blob = Utilities.newBlob(htmlContent, MimeType.HTML);

  // Generate filename
  var timestamp = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  var filename = 'Uber_Receipt_' + timestamp + '.pdf';

  // Check if file already exists
  var existingFiles = folder.getFilesByName(filename);
  if (existingFiles.hasNext()) {
    filename = 'Uber_Receipt_' + timestamp + '_' + new Date().getTime() + '.pdf';
  }

  // Convert HTML to PDF
  try {
    var pdfBlob = blob.getAs(MimeType.PDF);
    var file = folder.createFile(pdfBlob);
    file.setName(filename);
    return file;
  } catch (error) {
    Logger.log('Error creating PDF, saving as HTML: ' + error.toString());
    var htmlFilename = 'Uber_Receipt_' + timestamp + '.html';
    var file = folder.createFile(blob);
    file.setName(htmlFilename);
    return file;
  }
}

/**
 * Get file text content (for PDFs)
 */
function getFileText(file) {
  try {
    var mimeType = file.getMimeType();

    // For PDFs, try to extract text
    if (mimeType === MimeType.PDF) {
      return extractTextFromPDF(file);
    }

    // For images, return empty (would need OCR)
    if (mimeType.indexOf('image') !== -1) {
      Logger.log('Image file - OCR not implemented: ' + file.getName());
      return '';
    }

    // For other types, try to get as text
    return file.getBlob().getDataAsString();

  } catch (error) {
    Logger.log('Error extracting text from file: ' + error.toString());
    return '';
  }
}

/**
 * Extract text from PDF file
 */
function extractTextFromPDF(file) {
  try {
    // Convert PDF to Google Doc temporarily to extract text
    var blob = file.getBlob();
    var resource = {
      title: file.getName() + '_temp',
      mimeType: MimeType.GOOGLE_DOCS
    };

    // Create temporary Google Doc from PDF
    var doc = Drive.Files.insert(resource, blob, {
      ocr: true,
      ocrLanguage: 'en'
    });

    // Get the document text
    var docFile = DriveApp.getFileById(doc.id);
    var docContent = DocumentApp.openById(doc.id).getBody().getText();

    // Delete temporary doc
    docFile.setTrashed(true);

    return docContent;

  } catch (error) {
    Logger.log('PDF text extraction error: ' + error.toString());
    return '';
  }
}


// ============================================================================
// RECEIPT PARSER
// ============================================================================

/**
 * Extract receipt data from file
 */
function extractReceiptData(file, message, vendor) {
  var text = getFileText(file);
  var emailMeta = getEmailMetadata(message);

  var receiptData = {
    filename: file.getName(),
    fileUrl: file.getUrl(),
    vendor: vendor,
    emailFrom: emailMeta.from,
    emailSubject: emailMeta.subject,
    emailDate: emailMeta.date,
    processedDate: new Date(),
    amount: extractAmount(text, emailMeta),
    date: extractDate(text, emailMeta),
    rawText: text.substring(0, 500) // Store first 500 chars for reference
  };

  return receiptData;
}

/**
 * Extract amount from text
 */
function extractAmount(text, emailMeta) {
  var searchText = text + ' ' + emailMeta.subject + ' ' + emailMeta.body;
  var patterns = getConfig('AMOUNT_PATTERNS');

  for (var i = 0; i < patterns.length; i++) {
    var match = searchText.match(patterns[i]);
    if (match && match[1]) {
      // Clean up the amount
      var amount = match[1].replace(/,/g, '');
      return parseFloat(amount).toFixed(2);
    }
  }

  return '';
}

/**
 * Extract date from text
 */
function extractDate(text, emailMeta) {
  var searchText = text + ' ' + emailMeta.subject;
  var patterns = getConfig('DATE_PATTERNS');

  for (var i = 0; i < patterns.length; i++) {
    var match = searchText.match(patterns[i]);
    if (match && match[1]) {
      try {
        var dateStr = match[1];
        var parsedDate = parseDate(dateStr);
        if (parsedDate) {
          return parsedDate;
        }
      } catch (error) {
        // Continue to next pattern
      }
    }
  }

  // Default to email date
  return emailMeta.date;
}

/**
 * Parse date string
 */
function parseDate(dateStr) {
  try {
    // Try standard date parsing
    var date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }

    // Try MM/DD/YYYY format
    var parts = dateStr.split('/');
    if (parts.length === 3) {
      var month = parseInt(parts[0], 10) - 1;
      var day = parseInt(parts[1], 10);
      var year = parseInt(parts[2], 10);

      // Handle 2-digit years
      if (year < 100) {
        year += 2000;
      }

      return new Date(year, month, day);
    }

    // Try YYYY-MM-DD format
    parts = dateStr.split('-');
    if (parts.length === 3) {
      var year = parseInt(parts[0], 10);
      var month = parseInt(parts[1], 10) - 1;
      var day = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }

  } catch (error) {
    Logger.log('Error parsing date: ' + dateStr);
  }

  return null;
}

/**
 * Format currency amount
 */
function formatCurrency(amount) {
  if (!amount) return '';

  var num = parseFloat(amount);
  if (isNaN(num)) return '';

  return '$' + num.toFixed(2);
}

/**
 * Extract receipt data from email body (for Uber emails without attachments)
 */
function extractReceiptDataFromEmail(message, file, vendor) {
  var emailMeta = getEmailMetadata(message);
  var body = message.getPlainBody();

  // Extract amount and date from email body
  var receiptData = {
    filename: file.getName(),
    fileUrl: file.getUrl(),
    vendor: vendor,
    emailFrom: emailMeta.from,
    emailSubject: emailMeta.subject,
    emailDate: emailMeta.date,
    processedDate: new Date(),
    amount: extractAmount(body, emailMeta),
    date: extractDate(body, emailMeta),
    rawText: body.substring(0, 500) // Store first 500 chars for reference
  };

  return receiptData;
}


// ============================================================================
// SHEETS HANDLER
// ============================================================================

/**
 * Get or create the tracking spreadsheet
 */
function getOrCreateSpreadsheet() {
  var spreadsheetName = getConfig('SPREADSHEET_NAME');

  // First check if spreadsheet exists in the Claude folder
  var claudeFolder = getOrCreateMainFolder();
  var files = claudeFolder.getFilesByName(spreadsheetName);

  if (files.hasNext()) {
    var file = files.next();
    return SpreadsheetApp.openById(file.getId());
  } else {
    return createTrackingSpreadsheet();
  }
}

/**
 * Create the tracking spreadsheet in the Claude folder
 */
function createTrackingSpreadsheet() {
  var spreadsheetName = getConfig('SPREADSHEET_NAME');
  var spreadsheet = SpreadsheetApp.create(spreadsheetName);

  // Move spreadsheet to Claude folder
  var claudeFolder = getOrCreateMainFolder();
  var file = DriveApp.getFileById(spreadsheet.getId());

  // Remove from root and add to Claude folder
  var parents = file.getParents();
  while (parents.hasNext()) {
    parents.next().removeFile(file);
  }
  claudeFolder.addFile(file);

  // Set up the header row
  setupSpreadsheetHeaders(spreadsheet);

  return spreadsheet;
}

/**
 * Set up spreadsheet headers
 */
function setupSpreadsheetHeaders(spreadsheet) {
  var sheet = spreadsheet.getActiveSheet();
  sheet.setName('Receipts');

  // Define headers
  var headers = [
    'Date',
    'Vendor',
    'Filename',
    'Amount',
    'Email From',
    'Email Subject',
    'Email Date',
    'Processed Date',
    'File URL',
    'Status'
  ];

  // Set headers
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Format header row
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#4285f4');
  headerRange.setFontColor('#ffffff');

  // Set column widths
  sheet.setColumnWidth(1, 100);  // Date
  sheet.setColumnWidth(2, 100);  // Vendor
  sheet.setColumnWidth(3, 200);  // Filename
  sheet.setColumnWidth(4, 80);   // Amount
  sheet.setColumnWidth(5, 200);  // Email From
  sheet.setColumnWidth(6, 250);  // Email Subject
  sheet.setColumnWidth(7, 120);  // Email Date
  sheet.setColumnWidth(8, 120);  // Processed Date
  sheet.setColumnWidth(9, 300);  // File URL
  sheet.setColumnWidth(10, 100); // Status

  // Freeze header row
  sheet.setFrozenRows(1);
}

/**
 * Add receipt data to spreadsheet
 */
function addToSpreadsheet(spreadsheet, receiptData) {
  var sheet = spreadsheet.getActiveSheet();

  // Check if entry already exists
  if (isDuplicateEntry(sheet, receiptData)) {
    Logger.log('Duplicate entry, skipping: ' + receiptData.filename);
    return;
  }

  // Prepare row data
  var rowData = [
    receiptData.date || '',
    receiptData.vendor || '',
    receiptData.filename || '',
    receiptData.amount ? formatCurrency(receiptData.amount) : '',
    receiptData.emailFrom || '',
    receiptData.emailSubject || '',
    receiptData.emailDate || '',
    receiptData.processedDate || new Date(),
    receiptData.fileUrl || '',
    'Processed'
  ];

  // Append row
  sheet.appendRow(rowData);

  // Format the new row
  var lastRow = sheet.getLastRow();
  formatReceiptRow(sheet, lastRow, receiptData);
}

/**
 * Check if entry is duplicate
 */
function isDuplicateEntry(sheet, receiptData) {
  var data = sheet.getDataRange().getValues();

  // Skip header row
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var existingFilename = row[2]; // Filename column
    var existingFileUrl = row[8];  // File URL column

    if (existingFilename === receiptData.filename || existingFileUrl === receiptData.fileUrl) {
      return true;
    }
  }

  return false;
}

/**
 * Format receipt row
 */
function formatReceiptRow(sheet, rowIndex, receiptData) {
  // Format date columns
  var dateColumn = sheet.getRange(rowIndex, 1);
  dateColumn.setNumberFormat('yyyy-mm-dd');

  var emailDateColumn = sheet.getRange(rowIndex, 7);
  emailDateColumn.setNumberFormat('yyyy-mm-dd hh:mm');

  var processedDateColumn = sheet.getRange(rowIndex, 8);
  processedDateColumn.setNumberFormat('yyyy-mm-dd hh:mm');

  // Format amount column
  var amountColumn = sheet.getRange(rowIndex, 4);
  amountColumn.setHorizontalAlignment('right');

  // Make file URL clickable
  var urlColumn = sheet.getRange(rowIndex, 9);
  if (receiptData.fileUrl) {
    urlColumn.setFormula('=HYPERLINK("' + receiptData.fileUrl + '", "View File")');
  }

  // Alternate row colors
  if (rowIndex % 2 === 0) {
    sheet.getRange(rowIndex, 1, 1, 10).setBackground('#f8f9fa');
  }
}