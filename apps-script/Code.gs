/**
 * CampaignPro - landing page form -> Google Sheet
 *
 * Paste this whole file into the Apps Script editor of your Google Sheet
 * (Extensions -> Apps Script), set the settings below, then deploy as a
 * Web app (Execute as: Me | Who has access: Anyone). Full steps in README.md.
 *
 * Security measures (all enforced here, on Google's side, so they can't be
 * bypassed by someone calling the URL directly):
 *  - Strict validation of every field (type, length, allowed characters)
 *  - Sanitising: control/invisible characters and < > " ` removed
 *  - Spreadsheet formula injection blocked: any value starting with
 *    = + - @ or a tab/newline is stored as plain text (prefixed with ')
 *  - Honeypot field and minimum fill time to silently drop bots
 *  - Global rate limit per minute
 *  - Optional Cloudflare Turnstile verification (invisible CAPTCHA)
 *  - Only fixed, known columns are ever written; unknown input is ignored
 */

// ---------------------------------------------------------------- SETTINGS
var SHEET_NAME = 'Leads';                 // tab name; created automatically
var NOTIFY_EMAIL = '';                    // e.g. 'hello@campaignpro.click' to get an email per lead ('' = off)
var TURNSTILE_SECRET = '';                // Cloudflare Turnstile secret key ('' = off)
var MAX_SUBMISSIONS_PER_MINUTE = 20;      // global cap against floods
var MIN_FILL_TIME_MS = 2500;              // humans need at least a few seconds

var HEADERS = ['Submitted at', 'Name', 'Email', 'Phone', 'Website', 'UTM source', 'UTM medium',
               'UTM campaign', 'UTM content', 'UTM term', 'fbclid', 'Page'];

// ---------------------------------------------------------------- ENTRY POINTS
function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    var body = (e && e.postData && e.postData.contents) || '';
    if (body.length > 5000) return respond_({ ok: false, error: 'too_large' });

    var data;
    try { data = JSON.parse(body); } catch (err) { return respond_({ ok: false, error: 'bad_request' }); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return respond_({ ok: false, error: 'bad_request' });

    // Bots: honeypot filled or form sent too fast -> pretend success, store nothing.
    if (data.company_fax) return respond_({ ok: true });
    var elapsed = Number(data.elapsed_ms);
    if (!isFinite(elapsed) || elapsed < MIN_FILL_TIME_MS) return respond_({ ok: true });

    if (!withinRateLimit_()) return respond_({ ok: false, error: 'rate_limited' });

    if (TURNSTILE_SECRET && !verifyTurnstile_(String(data.turnstile_token || ''))) {
      return respond_({ ok: false, error: 'verification_failed' });
    }

    var lead = validateLead_(data);
    if (!lead.ok) return respond_({ ok: false, error: 'invalid', fields: lead.errors });

    lock.waitLock(10000);
    locked = true;
    var sheet = getSheet_();
    var values = {
      'Submitted at': new Date(), 'Name': lead.name, 'Email': lead.email, 'Phone': lead.phone,
      'Website': lead.website, 'UTM source': lead.utm_source, 'UTM medium': lead.utm_medium,
      'UTM campaign': lead.utm_campaign, 'UTM content': lead.utm_content, 'UTM term': lead.utm_term,
      'fbclid': lead.fbclid, 'Page': lead.page
    };
    // Write by column name, so rows stay aligned even if columns were added later
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = header.map(function (h) {
      if (!Object.prototype.hasOwnProperty.call(values, h)) return '';
      return h === 'Submitted at' ? values[h] : toSafeCell_(values[h]);
    });
    var r = sheet.getLastRow() + 1;
    sheet.getRange(r, 1, 1, row.length).setNumberFormat('@');         // plain text: no formulas
    var dateCol = header.indexOf('Submitted at');
    if (dateCol !== -1) sheet.getRange(r, dateCol + 1).setNumberFormat('yyyy-mm-dd hh:mm');
    sheet.getRange(r, 1, 1, row.length).setValues([row]);

    if (NOTIFY_EMAIL) notify_(lead);
    return respond_({ ok: true });
  } catch (err) {
    console.error(err);
    return respond_({ ok: false, error: 'server_error' });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function doGet() {
  return respond_({ ok: true, service: 'campaignpro-leads' });
}

// ---------------------------------------------------------------- VALIDATION
var EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;
var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .\-]{0,79}$/u;
var WEBSITE_RE = /^(https?:\/\/)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(:\d{2,5})?(\/[A-Za-z0-9._~%!$&'()*+,;=:@\/?#-]*)?$/i;
var PHONE_RE = /^\+?[0-9 ().\-]{7,25}$/;
var TRACK_RE = /^[A-Za-z0-9 _.,:;|\/()+\-]{0,150}$/;

function validateLead_(d) {
  var errors = [];
  var name = clean_(d.name, 80);
  var email = clean_(d.email, 254).toLowerCase();
  var website = clean_(d.website, 200);
  var phone = clean_(d.phone, 25);
  var phoneDigits = phone.replace(/\D/g, '');

  if (!name || name.length < 2 || !NAME_RE.test(name)) errors.push('name');
  if (!EMAIL_RE.test(email)) errors.push('email');
  if (!PHONE_RE.test(phone) || phoneDigits.length < 7 || phoneDigits.length > 15) errors.push('phone');
  if (website && !WEBSITE_RE.test(website)) errors.push('website');

  return {
    ok: errors.length === 0,
    errors: errors,
    name: name,
    email: email,
    phone: phone,
    website: website,
    utm_source: tracking_(d.utm_source),
    utm_medium: tracking_(d.utm_medium),
    utm_campaign: tracking_(d.utm_campaign),
    utm_content: tracking_(d.utm_content),
    utm_term: tracking_(d.utm_term),
    fbclid: tracking_(d.fbclid, 250),
    page: tracking_(d.page, 100)
  };
}

/** Normalise, strip invisible/control characters and markup-sensitive symbols, collapse spaces, cap length. */
function clean_(value, maxLen) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  var s = String(value);
  if (s.normalize) s = s.normalize('NFKC');
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
       .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
       .replace(/[<>"`\\]/g, '')
       .replace(/\s+/g, ' ')
       .trim();
  return s.slice(0, maxLen);
}

/** Tracking values: keep only a safe character set; anything else is dropped entirely. */
function tracking_(value, maxLen) {
  var s = clean_(value, maxLen || 150);
  return TRACK_RE.test(s) ? s : '';
}

/** Spreadsheet formula injection guard: never let a cell start with a formula trigger. */
function toSafeCell_(value) {
  var s = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r\n|%]/.test(s) ? "'" + s : s;
}

// ---------------------------------------------------------------- HELPERS
function withinRateLimit_() {
  var cache = CacheService.getScriptCache();
  var key = 'rl_' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(key) || 0);
  if (count >= MAX_SUBMISSIONS_PER_MINUTE) return false;
  cache.put(key, String(count + 1), 120);
  return true;
}

function verifyTurnstile_(token) {
  if (!token || token.length > 2048) return false;
  var res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    payload: { secret: TURNSTILE_SECRET, response: token },
    muteHttpExceptions: true
  });
  try { return JSON.parse(res.getContentText()).success === true; } catch (e) { return false; }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Existing sheet: add any new columns (e.g. Phone) at the end without moving old data
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var missing = HEADERS.filter(function (h) { return header.indexOf(h) === -1; });
  if (missing.length) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
  return sheet;
}

function notify_(lead) {
  try {
    var lines = [
      'New free audit request from the landing page:',
      '',
      'Name: ' + lead.name,
      'Email: ' + lead.email,
      'Phone: ' + lead.phone,
      'Website: ' + (lead.website || '(not provided)'),
      'Source: ' + [lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(String).join(' / ')
    ];
    MailApp.sendEmail({ to: NOTIFY_EMAIL, subject: 'New lead: ' + lead.name, body: lines.join('\n') });
  } catch (e) {
    console.error('notify failed', e);
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
