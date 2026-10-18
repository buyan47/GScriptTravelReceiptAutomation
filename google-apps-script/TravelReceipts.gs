// ============================================================
// Travel Receipt Automation — Google Apps Script
// Source of truth: github.com/buyan47/GScriptTravelReceiptAutomation
//
// Saves Uber, Amtrak and Marriott receipts from Gmail into monthly
// subfolders (yyyy-MM) of one Google Drive folder.
//
// Run these from the Apps Script editor:
//   saveReceipts()          previous + current month (used by the trigger)
//   backfillReceipts()      CONFIG.BACKFILL_START → CONFIG.BACKFILL_END
//   installWeeklyTrigger()  run once to schedule saveReceipts every Monday
//
// Safe to re-run. Nothing is deleted, except that an Uber receipt is moved
// to Trash when a newer version of the same trip replaces it.
// Files you add to the folders by hand are never touched.
// ============================================================

const CONFIG = {
  DRIVE_FOLDER_ID: '1HjZxebwmw1XjWlZT9eWgx7Igrxa1pM3M', // "Receipts" folder
  BACKFILL_START: '2026/09/01',  // YYYY/MM/DD, inclusive
  BACKFILL_END:   '2026/11/01',  // YYYY/MM/DD, exclusive
  MAX_THREADS_PER_VENDOR: 300,
  MARKER: 'travel-receipts'      // tag written to each saved file's description
};

const VENDORS = [
  { name: 'Amtrak',   query: 'from:etickets@amtrak.com',                      handler: processAmtrak_ },
  { name: 'Uber',     query: 'from:noreply@uber.com subject:"trip with Uber"', handler: processUber_ },
  { name: 'Marriott', query: 'from:marriott.com',                              handler: processMarriott_ }
];

// ── Entry points ─────────────────────────────────────────────────────────────

function saveReceipts() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const tz = Session.getScriptTimeZone();
  runReceipts_(Utilities.formatDate(start, tz, 'yyyy/MM/dd'),
               Utilities.formatDate(end, tz, 'yyyy/MM/dd'));
}

function backfillReceipts() {
  runReceipts_(CONFIG.BACKFILL_START, CONFIG.BACKFILL_END);
}

function installWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'saveReceipts')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('saveReceipts').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
  Logger.log('Weekly trigger installed: saveReceipts, Mondays ~6 AM');
}

// ── Core loop ────────────────────────────────────────────────────────────────

function runReceipts_(startDate, endDate) {
  const started = Date.now();
  const ctx = {
    tz: Session.getScriptTimeZone(),
    parent: DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID),
    rangeStart: parseYmd_(startDate),
    rangeEnd: parseYmd_(endDate),
    folders: {},
    stats: { saved: 0, replaced: 0, skipped: 0, errors: 0 }
  };
  Logger.log(`Scanning ${startDate} → ${endDate}`);

  for (const vendor of VENDORS) {
    const threads = searchAll_(`${vendor.query} after:${startDate} before:${endDate}`);
    Logger.log(`${vendor.name}: ${threads.length} threads`);
    for (const thread of threads) {
      for (const message of thread.getMessages()) {
        const d = message.getDate();
        if (d < ctx.rangeStart || d >= ctx.rangeEnd) continue;
        try {
          vendor.handler(message, ctx);
        } catch (e) {
          ctx.stats.errors++;
          Logger.log(`❌ ${vendor.name} ${message.getId()}: ${e}`);
        }
      }
    }
  }
  const s = ctx.stats;
  Logger.log(`Done in ${Math.round((Date.now() - started) / 1000)}s: saved ${s.saved}, ` +
             `replaced ${s.replaced}, already had ${s.skipped}, errors ${s.errors}`);
}

function searchAll_(query) {
  const all = [];
  for (let start = 0; start < CONFIG.MAX_THREADS_PER_VENDOR; start += 100) {
    const page = GmailApp.search(query, start, 100);
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

// ── Amtrak: one file per sale / refund ───────────────────────────────────────

function processAmtrak_(message, ctx) {
  if (!/etickets@amtrak\.com/i.test(message.getFrom())) return; // skips your own forwards
  const text = message.getPlainBody();
  const type = (text.match(/\b(SALES|REFUND|EXCHANGE) RECEIPT\b/i) || [])[1];
  if (!type) return;

  const kind = type.toUpperCase() === 'SALES' ? 'sale' : type.toLowerCase();
  const res = (text.match(/Reservation Number\s*-\s*([A-Z0-9]{6})/i) || [])[1] || 'NORES';
  const purchased = (text.match(/Purchased:\s*([\d\/]+\s+[\d:]+\s*[AP]M)/i) || [])[1] || '';
  const modified  = (text.match(/Modified:\s*([\d\/]+\s+[\d:]+\s*[AP]M)/i) || [])[1] || '';
  const txnDate = parseUsDate_(modified || purchased) || message.getDate();
  const amount = kind === 'refund'
    ? matchAmount_(text, /Total Refunded\s*\$\s*([\d,]+\.\d{2})/i)
    : matchAmount_(text, /Total\s*\$\s*([\d,]+\.\d{2})/i);

  const name = `${fmt_(ctx, txnDate, 'yyyyMMdd')}_amtrak_${kind}_${res}_${amount}.pdf`;
  const key = `amtrak:${res}:${kind}:${modified || purchased}`;
  saveOnce_(ctx, txnDate, message.getId(), key, 1, () => htmlToPdf_(message.getBody(), name));
}

// ── Uber: one file per trip, newest version wins ─────────────────────────────

function processUber_(message, ctx) {
  if (!/@uber\.com/i.test(message.getFrom())) return;
  if (!/trip with Uber/i.test(message.getSubject())) return;
  const text = message.getPlainBody();

  let rank;
  if (/Thanks for tipping/i.test(text)) rank = 3;       // final total incl. tip
  else if (/Thanks for riding/i.test(text)) rank = 2;   // final receipt
  else if (/charge summary/i.test(text)) rank = 1;      // provisional, replaced later
  else return;

  const tripDate = parseUberTripDate_(text);
  const date = tripDate || message.getDate();
  const key = tripDate ? `uber:${fmt_(ctx, tripDate, 'yyyyMMddHHmm')}` : `uber:msg:${message.getId()}`;
  const amount = matchAmount_(text, /Total\s*\$\s*([\d,]+\.\d{2})/i);
  const suffix = rank === 1 ? '_charge-summary' : '';
  const name = `${fmt_(ctx, date, 'yyyyMMdd_HHmm')}_uber_${amount}${suffix}.pdf`;

  saveOnce_(ctx, date, message.getId(), key, rank, () => htmlToPdf_(message.getBody(), name));
}

// Uber emails start with the trip time, e.g. "Oct 14, 2026 4:44 PM".
function parseUberTripDate_(text) {
  const m = text.match(/\b([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4})\s*,?\s*(\d{1,2}):(\d{2})\s*([AP]M)/);
  if (!m) return null;
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  if (!(m[1] in months)) return null;
  const hour = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0);
  return new Date(Number(m[3]), months[m[1]], Number(m[2]), hour, Number(m[5]));
}

// ── Marriott: folio attachment, else the email as PDF ────────────────────────

function processMarriott_(message, ctx) {
  if (!/marriott\.com/i.test(message.getFrom())) return;
  const subject = message.getSubject();
  if (/promotion|offer|newsletter|survey|welcome|points|bonus|sale/i.test(subject)) return;

  const date = message.getDate();
  const day = fmt_(ctx, date, 'yyyyMMdd');
  const id = message.getId();
  const folio = message.getAttachments().find(isFolio_);

  if (folio) {
    const ext = folio.getName().split('.').pop().toLowerCase();
    const name = `${day}_marriott_folio.${ext}`;
    saveOnce_(ctx, date, id, `marriott:${id}`, 1, () => folio.copyBlob().setName(name));
  } else if (/folio|receipt|invoice|bill|check-?out/i.test(subject)) {
    const name = `${day}_marriott_email.pdf`;
    saveOnce_(ctx, date, id, `marriott:${id}`, 1, () => htmlToPdf_(message.getBody(), name));
  }
}

function isFolio_(attachment) {
  const name = attachment.getName().toLowerCase();
  const ext = name.split('.').pop();
  return ['pdf', 'png', 'jpg', 'jpeg'].includes(ext) &&
         attachment.getSize() > 5000 &&
         /folio|invoice|receipt|bill|conf|checkout|\d{5,}/.test(name);
}

// ── Drive: save once, track by description tag ──────────────────────────────

function saveOnce_(ctx, date, msgId, key, rank, makeBlob) {
  const month = getMonth_(ctx, date);
  const idx = month.index;
  const existing = idx.keys[key];
  if (idx.msgIds[msgId] || (existing && existing.rank >= rank)) {
    ctx.stats.skipped++;
    return;
  }
  const file = month.folder.createFile(makeBlob());
  file.setDescription(`${CONFIG.MARKER}|msg=${msgId}|key=${key}|rank=${rank}`);
  if (existing) {
    existing.file.setTrashed(true);
    ctx.stats.replaced++;
    Logger.log(`♻️ ${existing.file.getName()} → ${file.getName()}`);
  } else {
    ctx.stats.saved++;
    Logger.log(`✅ ${file.getName()}`);
  }
  idx.msgIds[msgId] = true;
  idx.keys[key] = { rank: rank, file: file };
}

function getMonth_(ctx, date) {
  const name = fmt_(ctx, date, 'yyyy-MM');
  if (!ctx.folders[name]) {
    const it = ctx.parent.getFoldersByName(name);
    const folder = it.hasNext() ? it.next() : ctx.parent.createFolder(name);
    ctx.folders[name] = { folder: folder, index: indexFolder_(folder) };
  }
  return ctx.folders[name];
}

function indexFolder_(folder) {
  const index = { msgIds: {}, keys: {} };
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    const tag = parseTag_(file.getDescription());
    if (!tag) continue;                       // hand-added files are ignored
    index.msgIds[tag.msg] = true;
    const prev = index.keys[tag.key];
    if (!prev || tag.rank > prev.rank) index.keys[tag.key] = { rank: tag.rank, file: file };
  }
  return index;
}

function parseTag_(desc) {
  if (!desc || desc.indexOf(CONFIG.MARKER + '|') !== 0) return null;
  const tag = {};
  desc.split('|').slice(1).forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) tag[part.slice(0, i)] = part.slice(i + 1);
  });
  tag.rank = Number(tag.rank) || 0;
  return tag.msg && tag.key ? tag : null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function htmlToPdf_(html, name) {
  const body = String(html).replace(/<script[\s\S]*?<\/script>/gi, '');
  const page = '<html><head><meta charset="UTF-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:12px;color:#000}' +
    'img{max-width:100%;height:auto}table{max-width:100%}' +
    '</style></head><body>' + body + '</body></html>';
  return HtmlService.createHtmlOutput(page).getAs('application/pdf').setName(name);
}

function matchAmount_(text, regex) {
  const m = text.match(regex);
  return m ? m[1].replace(/,/g, '') : 'unknown';
}

function parseUsDate_(s) {
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : null;
}

function parseYmd_(s) {
  const [y, m, d] = s.split('/').map(Number);
  return new Date(y, m - 1, d);
}

function fmt_(ctx, date, pattern) {
  return Utilities.formatDate(date, ctx.tz, pattern);
}
