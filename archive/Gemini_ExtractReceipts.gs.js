// ====================================================================
// GEMINI RECEIPT EXTRACTION SCRIPT (Designed for monthly reconciliation)
// ====================================================================

// --- Configuration Settings ---
// Set the names of your existing Drive folder structure
const GRAND_PARENT_FOLDER_NAME = 'EigenX'; // Folder above 'Receipts'
const TOP_LEVEL_PARENT_FOLDER_NAME = 'Receipts'; // Folder above the dynamic month folders

// Set the names for the script's output
const GEMINI_SUBFOLDER_NAME = 'Gemini'; 
const GEMINI_SHEET_NAME = 'Gemini Expense Log'; 

// The core search query targeting travel receipts.
const GEMINI_RECEIPT_QUERY_BASE = 'has:attachment (from:uber.com OR from:amtrak.com OR subject:"Hotel Confirmation" OR subject:"Receipt")';
// ------------------------------

/**
 * Wrapper function to run the process for the CURRENT month (offset = 0).
 */
function runForCurrentMonth_Gemini() {
  Logger.log('Triggered: Running for Current Month.');
  processGmailReceipts_Gemini(0); 
}

/**
 * Wrapper function to run the process for the PREVIOUS month (offset = -1).
 */
function runForPreviousMonth_Gemini() {
  Logger.log('Triggered: Running for Previous Month.');
  processGmailReceipts_Gemini(-1);
}


/**
 * Main function to run the entire automation process for a specified month.
 * @param {number} monthOffset - Offset from the current month (0=current, -1=last month, etc.).
 */
function processGmailReceipts_Gemini(monthOffset) {
  
  // Gets the date range and the required folder name (e.g., "December 2025")
  const { startDate, endDate, periodDescription, monthFolderName } = getDateRange_Gemini(monthOffset);
  
  // Combine base query with dynamic date range (YYYY/MM/DD)
  const SEARCH_QUERY = `${GEMINI_RECEIPT_QUERY_BASE} after:${startDate} before:${endDate}`;

  Logger.log(`Searching for period: ${periodDescription}`);

  try {
    // 1. Navigate/Create the full folder structure (EigenX/Receipts/December 2025/Gemini)
    const targetFolder = getOrCreateTargetFolder_Gemini(monthFolderName);
    
    // 2. Create the Google Sheet inside the final 'Gemini' folder
    const sheetFile = createSheetInFolder_Gemini(targetFolder, GEMINI_SHEET_NAME + ' - ' + monthFolderName);
    const spreadsheet = SpreadsheetApp.openById(sheetFile.getId());
    const sheet = spreadsheet.getSheetByName('Receipt Log') || spreadsheet.insertSheet('Receipt Log', 0);
    // Clean up the default Sheet1 if it was created
    if (spreadsheet.getSheetByName('Sheet1')) {
        spreadsheet.deleteSheet(spreadsheet.getSheetByName('Sheet1')); 
    }

    // Initialize the sheet header if it's empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Date', 'File Name', 'Amount Extracted', 'Drive Link', 'Email Subject']);
    }

    // --- Core Processing Loop ---
    const threads = GmailApp.search(SEARCH_QUERY + ' is:unread');
    let processedCount = 0;

    for (const thread of threads) {
      const messages = thread.getMessages();
      for (const message of messages) {
        
        const attachments = message.getAttachments();
        
        for (const attachment of attachments) {
          if (!attachment.getContentType().match(/application|image|text/)) continue;
          
          // Save file to the final target folder
          const file = targetFolder.createFile(attachment);
          const fileDate = new Date(message.getDate()).toLocaleDateString('en-US');
          const fileName = file.getName();
          const driveLink = file.getUrl();
          const emailSubject = message.getSubject();
          
          const amount = extractAmountFromAttachment_Gemini(attachment);
          
          sheet.appendRow([fileDate, fileName, amount, driveLink, emailSubject]);
          processedCount++;
        }
        
        // Mark the email as read
        message.markRead();
      }
    }

    Logger.log(`Successfully processed and logged ${processedCount} attachments into folder: ${targetFolder.getName()}.`);
    
  } catch (e) {
    Logger.log('FATAL ERROR in processGmailReceipts_Gemini: ' + e.toString());
  }
}


// --- FOLDER AND FILE MANAGEMENT HELPERS ---

/**
 * Creates the Google Sheet inside the specified folder.
 * @param {GoogleAppsScript.Drive.Folder} folder The folder to create the sheet in.
 * @param {string} sheetName The name of the spreadsheet file.
 * @return {GoogleAppsScript.Drive.File} The newly created sheet file.
 */
function createSheetInFolder_Gemini(folder, sheetName) {
  // Check if a sheet with the same name already exists in the target folder
  const files = folder.getFilesByName(sheetName);
  if (files.hasNext()) {
    Logger.log(`Using existing spreadsheet: ${sheetName}`);
    return files.next();
  }
  
  const ss = SpreadsheetApp.create(sheetName);
  const file = DriveApp.getFileById(ss.getId());
  
  // Move the sheet into the target folder
  file.getParents().next().removeFile(file);
  folder.addFile(file);
  
  return file;
}


/**
 * Navigates the folder structure (EigenX/Receipts/Month YYYY) and creates the 'Gemini' sub-folder.
 * @param {string} monthFolderName The MMMM YYYY name of the target month's folder (e.g., 'December 2025').
 * @return {GoogleAppsScript.Drive.Folder} The final 'Gemini' sub-folder.
 */
function getOrCreateTargetFolder_Gemini(monthFolderName) {
  try {
    // 1. Find GRAND_PARENT_FOLDER_NAME (e.g., EigenX)
    let folders = DriveApp.getFoldersByName(GRAND_PARENT_FOLDER_NAME);
    if (!folders.hasNext()) throw new Error(`Grand parent folder "${GRAND_PARENT_FOLDER_NAME}" not found.`);
    const grandParentFolder = folders.next();

    // 2. Find TOP_LEVEL_PARENT_FOLDER_NAME (e.g., Receipts) inside Grand Parent
    // FIX: Corrected the order of initialization to use grandParentFolder
    folders = grandParentFolder.getFoldersByName(TOP_LEVEL_PARENT_FOLDER_NAME); 
    if (!folders.hasNext()) throw new Error(`Top level folder "${TOP_LEVEL_PARENT_FOLDER_NAME}" not found inside "${GRAND_PARENT_FOLDER_NAME}".`);
    const topParentFolder = folders.next(); 

    // 3. Find or Create the MONTH folder (e.g., December 2025) inside Top Parent
    folders = topParentFolder.getFoldersByName(monthFolderName);
    let monthFolder;
    if (folders.hasNext()) {
        monthFolder = folders.next();
        Logger.log(`Found month folder: ${monthFolderName}`);
    } else {
        monthFolder = topParentFolder.createFolder(monthFolderName);
        Logger.log(`Created new month folder: ${monthFolderName}`);
    }
    
    // 4. Find or Create the GEMINI sub-folder inside the Month folder
    folders = monthFolder.getFoldersByName(GEMINI_SUBFOLDER_NAME);
    if (folders.hasNext()) {
      Logger.log(`Using existing Gemini sub-folder.`);
      return folders.next();
    } else {
      Logger.log(`Creating new Gemini sub-folder in ${monthFolderName}.`);
      return monthFolder.createFolder(GEMINI_SUBFOLDER_NAME);
    }
    
  } catch (e) {
    Logger.log('Drive Folder Structure Error: ' + e.toString());
    throw new Error('Failed to find or create the required Drive folder structure. Check folder names and permissions.');
  }
}


// --- DATE AND PARSING HELPERS ---

/**
 * Calculates the start and end dates for a month based on the offset.
 */
function getDateRange_Gemini(offset) {
  const today = new Date();
  const targetDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  
  const startOfMonth = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
  const startOfNextMonth = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 1);
  
  const formatDate = (date) => Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  const formatFolder = (date) => Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMMM yyyy'); 

  return {
    startDate: formatDate(startOfMonth),
    endDate: formatDate(startOfNextMonth),
    periodDescription: formatFolder(startOfMonth),
    monthFolderName: formatFolder(startOfMonth) 
  };
}

/**
 * Helper function to parse the attachment content for a dollar amount using basic regex.
 */
function extractAmountFromAttachment_Gemini(attachment) {
  try {
    const textContent = attachment.getDataAsString();
    const amountRegex = /(total|amount due|grand total|charge|fare)[:\s]*\$?\s*(\d{1,3}(,\d{3})*(\.\d{2}))/i;
    const match = textContent.match(amountRegex);
    
    if (match && match[2]) {
      return match[2];
    }
    
    const simpleDollarRegex = /\$(\d+\.\d{2})/g;
    const simpleMatch = textContent.match(simpleDollarRegex);
    
    if (simpleMatch && simpleMatch.length > 0) {
        return simpleMatch[0].replace('$', '');
    }

    return "N/A - Cannot Parse";

  } catch (e) {
    return "N/A - Binary File";
  }
}

