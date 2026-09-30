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

var HEADERS = ['Submitted at', 'Name', 'Email', 'Website', 'UTM source', 'UTM medium',
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
    var row = [new Date()].concat([
      lead.name, lead.email, lead.website,
      lead.utm_source, lead.utm_medium, lead.utm_campaign, lead.utm_content, lead.utm_term,
      lead.fbclid, lead.page
    ].map(toSafeCell_));
    var r = sheet.getLastRow() + 1;
    sheet.getRange(r, 2, 1, row.length - 1).setNumberFormat('@');   // text columns stay plain text
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
var TRACK_RE = /^[A-Za-z0-9 _.,:;|\/()+\-]{0,150}$/;

function validateLead_(d) {
  var errors = [];
  var name = clean_(d.name, 80);
  var email = clean_(d.email, 254).toLowerCase();
  var website = clean_(d.website, 200);

  if (!name || name.length < 2 || !NAME_RE.test(name)) errors.push('name');
  if (!EMAIL_RE.test(email)) errors.push('email');
  if (website && !WEBSITE_RE.test(website)) errors.push('website');

  return {
    ok: errors.length === 0,
    errors: errors,
    name: name,
    email: email,
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
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
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
