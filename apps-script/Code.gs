/**
 * Perth Resoles - website order automation (Google Apps Script, bound to the "Order Tracker" sheet).
 *
 * The website Worker POSTs one clean JSON per PAID order. This script:
 *   1. checks the shared secret,
 *   2. appends a row to 'Order Tracking' (or 'Test Orders' while TEST_MODE is on),
 *      skipping duplicate Order IDs and never overwriting the formula columns,
 *   3. creates a Gmail DRAFT confirmation email (never sends), guarded against home-address words.
 *
 * Script properties (Project Settings > Script properties):
 *   SHARED_SECRET  - same value as SHEET_WEBHOOK_SECRET in the website's .dev.vars / Worker secret
 *   TEST_MODE      - "true" (default) writes to 'Test Orders'; set "false" to use 'Order Tracking'
 *   BLOCKED_WORDS  - comma list; a draft containing any of these is NOT created (logged instead)
 *   CREATE_DRAFTS  - "true" (default) / "false"
 */

var CONFIG = {
  TRACKING_TAB: 'Order Tracking',
  TEST_TAB: 'Test Orders',
  PRICE_TAB: 'Price List',
  LOG_TAB: 'Automation Log',
  HEADERS: ['Order ID', 'Customer Name', 'Email', 'Phone', 'Order Date', 'Service', 'Rubber', 'Thickness',
    'Rand Repair', 'Rand Coverage', 'Pairs', 'Shoe Model', 'Size', 'Amount (AUD)', 'List Price (x Pairs)',
    'Drop-off / Pick-up', 'Status', 'Shoes Received Date', 'Due Date', 'Returned Date', 'Square Receipt', 'Notes'],
  FORMULA_COLS: [15, 19], // O = List Price (x Pairs), S = Due Date. Never written by this script.
  DEFAULT_BLOCKED_WORDS: ['Perth Hills', 'ADD_YOUR_STREET_NAME_HERE'],
  ALLOWED: {
    rubber: ['Unparallel RH', 'Vibram XS Grip', 'Vibram XS Edge', 'Other'],
    thickness: ['4.0mm', '4.2mm', '5.5mm', 'Other'],
    rand_repair: ['None', 'Toe cap', 'Half rand', 'Full rand'],
    rand_coverage: ['', 'Both shoes', 'Single shoe only']
  },
  TURNAROUND: '3 weeks from when we collect your shoes',
  CONTACT_EMAIL: 'perthresoles@gmail.com',
  INSTAGRAM_HANDLE: '@perthresoles',
  INSTAGRAM_URL: 'https://www.instagram.com/perthresoles/',
  SITE_URL: 'https://www.perthresoles.com.au'
};

// ---------------- entry points ----------------

function doGet() {
  return ContentService.createTextOutput('Perth Resoles order hook is running.');
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: 'bad json' });
  }
  var cfg = props_();
  if (!cfg.secret) return out_({ ok: false, error: 'SHARED_SECRET script property is not set' });
  if (!safeEqual_(String(data.auth || ''), cfg.secret)) return out_({ ok: false, error: 'unauthorized' });
  delete data.auth;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // one order at a time, so duplicates can't slip in side by side
  try {
    return out_(processOrder_(data, cfg));
  } catch (err) {
    log_('ERROR', data.order_id, 'Order not processed', String(err && err.message || err));
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/** Run once from the editor: sets safe defaults (Test mode ON) and creates a shared secret if missing. */
function setupTestMode() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SHARED_SECRET')) {
    p.setProperty('SHARED_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  if (!p.getProperty('TEST_MODE')) p.setProperty('TEST_MODE', 'true');
  if (!p.getProperty('BLOCKED_WORDS')) p.setProperty('BLOCKED_WORDS', CONFIG.DEFAULT_BLOCKED_WORDS.join(','));
  if (!p.getProperty('CREATE_DRAFTS')) p.setProperty('CREATE_DRAFTS', 'true');
  getOrCreateTestTab_(SpreadsheetApp.getActiveSpreadsheet());
  getLogSheet_(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('Done. Copy SHARED_SECRET from Project Settings > Script properties into SHEET_WEBHOOK_SECRET.');
}

/** Run from the editor to try the whole thing without the website (writes to Test Orders in TEST_MODE). */
function testWithSampleOrder() {
  var cfg = props_();
  var res = processOrder_({
    type: 'order.paid', via: 'manual-test', environment: 'sandbox',
    order_id: 'PR-' + (1000 + Math.floor(Math.random() * 9000)),
    square_order_id: 'TEST-ORDER', square_payment_id: 'TEST-PAYMENT-' + Date.now(),
    paid_at: new Date().toISOString(), customer_name: 'Test Customer', email: Session.getActiveUser().getEmail(),
    phone: '+61412345678', service: 'Resole: Vibram XS Grip 4.0mm + Toe cap (both shoes)',
    rubber: 'Vibram XS Grip', thickness: '4.0mm', rand_repair: 'Toe cap', rand_coverage: 'Both shoes', pairs: 1,
    shoe_model: 'La Sportiva Solution', shoe_size: 'EU 41.5', amount_aud: 120,
    dropoff: 'Drop off and Pick up at Urban Jungle Climbing Gym', dropoff_key: 'urban-jungle',
    receipt_url: 'https://squareupsandbox.com/receipt/preview/TEST'
  }, cfg);
  Logger.log(JSON.stringify(res));
}

// ---------------- core ----------------

function processOrder_(d, cfg) {
  if (!/^PR-\d{4}$/.test(String(d.order_id || ''))) throw new Error('missing/invalid order_id');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = cfg.testMode ? getOrCreateTestTab_(ss) : ss.getSheetByName(CONFIG.TRACKING_TAB);
  if (!sheet) throw new Error('tab not found: ' + CONFIG.TRACKING_TAB);
  checkHeaders_(sheet);

  // ---- duplicate check (Order ID; same Square payment/receipt = the same order) ----
  var last = lastOrderRow_(sheet);
  if (last >= 2) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
    var receipts = sheet.getRange(2, 21, last - 1, 1).getDisplayValues();
    var notes = sheet.getRange(2, 22, last - 1, 1).getDisplayValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() !== d.order_id) continue;
      var samePayment = (d.receipt_url && receipts[i][0] === d.receipt_url) ||
        (d.square_payment_id && notes[i][0].indexOf(d.square_payment_id) >= 0) || !d.square_payment_id;
      if (samePayment) {
        log_('INFO', d.order_id, 'Duplicate skipped', 'Already on ' + sheet.getName() + ' row ' + (i + 2) + ' (via ' + d.via + ')');
        return { ok: true, status: 'duplicate', sheet: sheet.getName(), row: i + 2 };
      }
      // Same 4-digit number but a different Square payment: a genuinely different (older) order.
      log_('WARN', d.order_id, 'Order number reused', 'Row ' + (i + 2) + ' has the same Order ID but a different Square payment. New row added; please check.');
    }
  }

  var mapped = mapOrder_(d, ss);
  var r = last + 1;
  // Copy formats + dropdown rules from the row above so the new row looks like the rest.
  if (r - 1 >= 2) {
    var above = sheet.getRange(r - 1, 1, 1, CONFIG.HEADERS.length);
    var target = sheet.getRange(r, 1, 1, CONFIG.HEADERS.length);
    above.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    above.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  var row = mapped.row;
  // Write around the formula columns (O and S) so the header ARRAYFORMULAs keep working.
  sheet.getRange(r, 1, 1, 14).setValues([row.slice(0, 14)]);   // A..N
  sheet.getRange(r, 16, 1, 3).setValues([row.slice(15, 18)]);  // P..R
  sheet.getRange(r, 20, 1, 3).setValues([row.slice(19, 22)]);  // T..V
  // If the formula columns use per-row formulas (not a header ARRAYFORMULA), copy them down.
  CONFIG.FORMULA_COLS.forEach(function (c) {
    if (r - 1 >= 2 && sheet.getRange(r - 1, c).getFormula()) {
      sheet.getRange(r - 1, c).copyTo(sheet.getRange(r, c), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
    }
  });
  mapped.warnings.forEach(function (w) { log_('WARN', d.order_id, 'Mapping', w); });

  var draft = draftConfirmation_(d, mapped.service, cfg);
  log_('INFO', d.order_id, 'Order added', sheet.getName() + ' row ' + r + ' (via ' + d.via + '); email draft: ' + draft);
  return { ok: true, status: 'appended', sheet: sheet.getName(), row: r, draft: draft };
}

/** Pure mapping from the Worker JSON to the 22 sheet columns (index 0 = column A). */
function mapOrder_(d, ss) {
  var warnings = [];
  var pick = function (field, value) {
    var v = value == null ? '' : String(value);
    if (CONFIG.ALLOWED[field].indexOf(v) >= 0) return v;
    warnings.push(field + ' "' + v + '" is not a dropdown option; used "' + (field === 'rand_coverage' ? '' : field === 'rand_repair' ? 'None' : 'Other') + '"');
    return field === 'rand_coverage' ? '' : field === 'rand_repair' ? 'None' : 'Other';
  };
  var rubber = pick('rubber', d.rubber), thickness = pick('thickness', d.thickness);
  var rand = pick('rand_repair', d.rand_repair);
  var coverage = rand === 'None' ? '' : pick('rand_coverage', d.rand_coverage);
  var service = lookupService_(ss, rubber, thickness, rand, coverage);
  if (!service) {
    service = String(d.service || '');
    warnings.push('No Price List row for ' + [rubber, thickness, rand, coverage].join(' / ') + '; used "' + service + '"');
  }
  var paid = d.paid_at ? new Date(d.paid_at) : new Date();
  var note = 'Website order via ' + (d.via || '?') + (d.environment === 'sandbox' ? ' (SANDBOX TEST)' : '') +
    '. Square order ' + (d.square_order_id || '?') + ', payment ' + (d.square_payment_id || '?') + '.';
  var row = [
    d.order_id,                    // A Order ID
    d.customer_name || '',         // B Customer Name
    d.email || '',                 // C Email
    d.phone || '',                 // D Phone
    paid,                          // E Order Date
    service,                       // F Service (Price List column A)
    rubber,                        // G Rubber
    thickness,                     // H Thickness
    rand,                          // I Rand Repair
    coverage,                      // J Rand Coverage
    Number(d.pairs || 1),          // K Pairs
    d.shoe_model || '',            // L Shoe Model
    d.shoe_size || '',             // M Size
    Number(d.amount_aud || 0),     // N Amount (AUD)
    null,                          // O List Price (x Pairs)  [FORMULA - not written]
    d.dropoff || 'TBC',            // P Drop-off / Pick-up
    'Paid',                        // Q Status
    '',                            // R Shoes Received Date
    null,                          // S Due Date              [FORMULA - not written]
    '',                            // T Returned Date
    d.receipt_url || '',           // U Square Receipt
    note                           // V Notes
  ];
  return { row: row, service: service, warnings: warnings };
}

function lookupService_(ss, rubber, thickness, rand, coverage) {
  var pl = ss.getSheetByName(CONFIG.PRICE_TAB);
  if (!pl || pl.getLastRow() < 2) return '';
  var v = pl.getRange(2, 1, pl.getLastRow() - 1, 6).getDisplayValues(); // A..F only
  for (var i = 0; i < v.length; i++) {
    if (v[i][2] === rubber && v[i][3] === thickness && v[i][4] === rand &&
        (v[i][5] === coverage || (rand === 'None' && v[i][5] === ''))) return v[i][0];
  }
  return '';
}

// ---------------- email draft ----------------

function draftConfirmation_(d, service, cfg) {
  if (!cfg.drafts) return 'skipped (CREATE_DRAFTS is off)';
  if (!d.email) { log_('WARN', d.order_id, 'No email draft', 'Order has no email address'); return 'skipped (no email)'; }
  if (d.dropoff_key !== 'urban-jungle') {
    log_('INFO', d.order_id, 'No email draft', 'Drop-off is not Urban Jungle - send a manual email');
    return 'skipped (not Urban Jungle)';
  }
  var email = renderConfirmationEmail_(d, service);
  var hit = findBlockedWord_([email.subject, email.text, email.html].join('\n'), cfg.blocked);
  if (hit) {
    log_('BLOCKED', d.order_id, 'Email draft blocked by address guard', 'Matched blocked word "' + hit + '". No draft created - check this order manually.');
    return 'blocked';
  }
  GmailApp.createDraft(d.email, email.subject, email.text, { htmlBody: email.html, name: 'Perth Resoles' });
  return 'created';
}

function findBlockedWord_(text, words) {
  var t = String(text).toLowerCase();
  for (var i = 0; i < words.length; i++) {
    var w = String(words[i]).trim();
    if (w && t.indexOf(w.toLowerCase()) >= 0) return w;
  }
  return '';
}

/** Built ONLY from these template fields - never from Notes or any other free text in the sheet. */
function renderConfirmationEmail_(d, service) {
  var f = {
    first: String(d.customer_name || '').trim().split(/\s+/)[0] || 'there',
    order_id: d.order_id,
    service: service || d.service || 'resole',
    pairs: String(d.pairs || 1),
    model: d.shoe_model || '',
    size: d.shoe_size || '',
    amount: '$' + Number(d.amount_aud || 0).toFixed(2) + ' AUD',
    receipt: /^https:\/\/(squareup|squareupsandbox)\.com\//.test(String(d.receipt_url || '')) ? d.receipt_url : ''
  };
  var h = {};
  Object.keys(f).forEach(function (k) { h[k] = esc_(f[k]); });
  var subject = 'Thanks for your order - here is what happens next (' + f.order_id + ')';
  var link = 'color:#b8860b;';
  var html =
'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc_(subject) + '</title></head>' +
'<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;">' +
'<span style="display:none;max-height:0;overflow:hidden;">Payment received. Drop your shoes at Urban Jungle and we\'ll take it from there.</span>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;"><tr><td align="center">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">' +
'<tr><td style="background:#111111;padding:18px 28px;color:#e3b93c;font-size:20px;font-weight:700;letter-spacing:.3px;">Perth Resoles</td></tr>' +
'<tr><td style="padding:28px;font-size:15px;line-height:1.6;">' +
'<p style="margin:0 0 16px;">Hi ' + h.first + ',</p>' +
'<p style="margin:0 0 16px;">Thanks for your order! We have received payment for your <strong>' + h.service + '</strong>.</p>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid #e3b93c;border-radius:12px;margin:0 0 20px;">' +
'<tr><td style="padding:14px 16px;font-size:14px;line-height:1.7;">' +
'<strong>Your order</strong><br>Order number: <strong style="font-size:16px;">' + h.order_id + '</strong><br>' +
'Repair: ' + h.service + '<br>Pairs: ' + h.pairs + '<br>Shoes: ' + h.model + ', size ' + h.size + '<br>' +
'Paid: ' + h.amount + (f.receipt ? ' &middot; <a href="' + h.receipt + '" style="' + link + '">View receipt</a>' : '') +
'</td></tr></table>' +
'<p style="margin:0 0 8px;"><strong>Drop-off and pick-up location:</strong> Urban Jungle Climbing Gym</p>' +
'<p style="margin:0 0 6px;"><strong>How to drop off your shoes</strong></p>' +
'<ol style="margin:0 0 16px;padding-left:20px;">' +
'<li>Grab a tag and note from the Perth Resoles wooden board at the gym.</li>' +
'<li>Write your name and order number (<strong>' + h.order_id + '</strong>) on the note, attach the tag to your shoes, and hand them in at the counter.</li>' +
'<li>Let us know once they\'re dropped off by replying to this email or messaging us on Instagram.</li>' +
'</ol>' +
'<p style="margin:0 0 6px;"><strong>What happens next</strong></p>' +
'<p style="margin:0 0 8px;"><strong>Turnaround:</strong> ' + esc_(CONFIG.TURNAROUND) + '. We will email you as soon as they are done and ready for pick up at Urban Jungle.</p>' +
'<p style="margin:0 0 20px;font-size:14px;color:#4b5563;">Final price may change if the shoes need more work &mdash; we\'ll check with you first.</p>' +
'<p style="margin:0 0 20px;">If you have any questions, email us at <a href="mailto:' + CONFIG.CONTACT_EMAIL + '" style="' + link + '">' + CONFIG.CONTACT_EMAIL + '</a> or message us on Instagram <a href="' + CONFIG.INSTAGRAM_URL + '" style="' + link + '">' + CONFIG.INSTAGRAM_HANDLE + '</a>.</p>' +
'<p style="margin:0;">Cheers,<br>Perth Resoles<br><a href="' + CONFIG.SITE_URL + '" style="color:#6b7280;font-size:13px;">perthresoles.com.au</a></p>' +
'</td></tr></table></td></tr></table></body></html>';
  var text = [
    'Hi ' + f.first + ',', '',
    'Thanks for your order! We have received payment for your ' + f.service + '.', '',
    'YOUR ORDER',
    'Order number: ' + f.order_id,
    'Repair: ' + f.service,
    'Pairs: ' + f.pairs,
    'Shoes: ' + f.model + ', size ' + f.size,
    'Paid: ' + f.amount + (f.receipt ? '\nReceipt: ' + f.receipt : ''), '',
    'DROP-OFF AND PICK-UP: Urban Jungle Climbing Gym',
    '1. Grab a tag and note from the Perth Resoles wooden board at the gym.',
    '2. Write your name and order number (' + f.order_id + ') on the note, attach the tag to your shoes, and hand them in at the counter.',
    '3. Let us know once they\'re dropped off by replying to this email or messaging us on Instagram.', '',
    'WHAT HAPPENS NEXT',
    'Turnaround: ' + CONFIG.TURNAROUND + '. We will email you as soon as they are done and ready for pick up at Urban Jungle.',
    'Final price may change if the shoes need more work - we\'ll check with you first.', '',
    'Questions? Email ' + CONFIG.CONTACT_EMAIL + ' or message us on Instagram ' + CONFIG.INSTAGRAM_HANDLE + '.', '',
    'Cheers,', 'Perth Resoles', 'www.perthresoles.com.au'
  ].join('\n');
  return { subject: subject, html: html, text: text };
}

// ---------------- sheet helpers ----------------

function checkHeaders_(sheet) {
  var got = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).getDisplayValues()[0];
  for (var i = 0; i < CONFIG.HEADERS.length; i++) {
    if (String(got[i]).trim() !== CONFIG.HEADERS[i]) {
      throw new Error('Column ' + (i + 1) + ' of ' + sheet.getName() + ' is "' + got[i] + '", expected "' + CONFIG.HEADERS[i] + '". Nothing written.');
    }
  }
}

/** Last row with an Order ID (column A). ARRAYFORMULA columns fill other columns with blanks, so getLastRow() is not reliable. */
function lastOrderRow_(sheet) {
  var n = sheet.getLastRow();
  if (n < 2) return 1;
  var a = sheet.getRange(1, 1, n, 1).getDisplayValues();
  for (var i = a.length - 1; i >= 1; i--) if (String(a[i][0]).trim() !== '') return i + 1;
  return 1;
}

function getOrCreateTestTab_(ss) {
  var t = ss.getSheetByName(CONFIG.TEST_TAB);
  if (t) return t;
  var src = ss.getSheetByName(CONFIG.TRACKING_TAB);
  t = ss.insertSheet(CONFIG.TEST_TAB);
  var n = CONFIG.HEADERS.length;
  src.getRange(1, 1, 1, n).copyTo(t.getRange(1, 1, 1, n)); // header incl. the O/S ARRAYFORMULAs
  var rows = Math.min(src.getMaxRows(), t.getMaxRows()) - 1;
  if (rows > 0) {
    src.getRange(2, 1, rows, n).copyTo(t.getRange(2, 1, rows, n), SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    src.getRange(2, 1, 1, n).copyTo(t.getRange(2, 1, rows, n), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  t.setFrozenRows(1);
  return t;
}

function getLogSheet_(ss) {
  var s = ss.getSheetByName(CONFIG.LOG_TAB);
  if (!s) {
    s = ss.insertSheet(CONFIG.LOG_TAB);
    s.getRange(1, 1, 1, 5).setValues([['Timestamp', 'Level', 'Order ID', 'Event', 'Details']]);
    s.setFrozenRows(1);
  }
  return s;
}

function log_(level, orderId, event, details) {
  try {
    getLogSheet_(SpreadsheetApp.getActiveSpreadsheet()).appendRow([new Date(), level, orderId || '', event, details || '']);
  } catch (err) {
    Logger.log(level + ' ' + orderId + ' ' + event + ' ' + details);
  }
}

function props_() {
  var p = PropertiesService.getScriptProperties();
  var blocked = (p.getProperty('BLOCKED_WORDS') || CONFIG.DEFAULT_BLOCKED_WORDS.join(','))
    .split(',').map(function (s) { return s.trim(); }).filter(String);
  if (blocked.indexOf('Perth Hills') < 0) blocked.push('Perth Hills'); // always on
  return {
    secret: p.getProperty('SHARED_SECRET') || '',
    testMode: String(p.getProperty('TEST_MODE') || 'true').toLowerCase() !== 'false', // safe default: test tab
    blocked: blocked,
    drafts: String(p.getProperty('CREATE_DRAFTS') || 'true').toLowerCase() !== 'false'
  };
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
