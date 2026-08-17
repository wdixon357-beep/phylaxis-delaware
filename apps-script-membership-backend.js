// Phylaxis Chapter Membership Application - Google Apps Script backend  [HARDENED]
// EMAIL ONLY. No Google Sheets, no third-party form service, no database.
// The email IS the record, so the record has to be tamper evident.
//
// Replaces apps-script-membership-backend.js in full. Paste over the whole file.
// AFTER PASTING: run setup() once from the editor, read the log, then
// Deploy > Manage deployments > pencil > Version: New version > Deploy.
// Re-open Manage deployments and read the version number back. Anything else
// orphans the live /exec URL.
//
// What changed and why:
//   1. Server-side validation. An empty or partial POST is refused and no mail is sent.
//   2. Every applicant-supplied value is stripped of control characters and truncated.
//      The free-text boxes are quoted line by line with a "| " prefix, so nothing typed
//      into them can imitate a heading in this report. That closes the certification forgery.
//   3. The certification verdict is stated in the subject line and at the very top of the
//      body, above any applicant text. Untrusted text can no longer appear above the truth.
//   4. The applicant confirmation contains no applicant-supplied text. It can no longer be
//      used to send an attacker's message to an attacker's address from our own domain.
//   5. Honeypot field, minimum fill time, burst cap, daily cap, and a mail-quota reserve.
//   6. A kill switch reachable from a phone: doGet with the admin key.

// TESTING ONLY. The President is removed so test submissions do not flood his inbox.
// RESTORE THIS LINE BEFORE THE FORM IS PUBLICISED:
//   const NOTIFY = ['brodixonsaunders@stonesquare22pha.org', 'apiii@mac.com'];
const NOTIFY = ['brodixonsaunders@stonesquare22pha.org'];
const FORM_URL = 'https://wdixon357-beep.github.io/phylaxis-delaware/apply/';
const CHAPTER = 'John T. Luke, Grand Lecturer Emeritus Delaware Chapter of The Phylaxis Society';
const SECRETARY = 'brodixonsaunders@stonesquare22pha.org';

// Operational limits. Tune these, do not remove them.
const MAX_PER_DAY = 40;      // applications accepted in a rolling 24 hours
const MAX_PER_10_MIN = 8;    // burst cap. Raise it if announcement night turns real Brothers away.
const QUOTA_RESERVE = 25;    // never spend the last N recipients of the daily mail quota
const MIN_FILL_SECONDS = 4;  // nobody completes this form honestly in less

// ---------------------------------------------------------------- entry points

function doPost(e) {
  try {
    return handle(e);
  } catch (err) {
    try {
      MailApp.sendEmail(SECRETARY,
        'ACTION NEEDED - Phylaxis application could not be processed',
        'An application was submitted but the handler threw an error.\n\n' +
        'Error: ' + err + '\n\nRaw submission:\n' + JSON.stringify(e && e.parameter) + '\n');
    } catch (ignored) {}
    return page('We could not complete your application',
      'Something went wrong on our end and your application may not have been recorded. ' +
      'Please contact the Chapter Secretary at ' + SECRETARY + ' so nothing is lost.');
  }
}

// GET is the kill switch and the status board. Without the key it is a plain signpost,
// which also stops Google's error page from leaking our function names.
function doGet(e) {
  const p = (e && e.parameter) || {};
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ADMIN_KEY');

  if (!key || p.k !== key) {
    return page('Membership Application',
      'Applications are taken on the Chapter application page. Use the link below.');
  }
  if (p.set === 'off') { props.setProperty('FORM_OPEN', 'no'); }
  if (p.set === 'on') { props.setProperty('FORM_OPEN', 'yes'); }
  if (p.set === 'reset') { props.deleteProperty('HITS'); }

  let quota = 'unknown';
  try { quota = String(MailApp.getRemainingDailyQuota()); } catch (err) {}
  return page('Chapter form control',
    'Form is ' + (props.getProperty('FORM_OPEN') === 'no' ? 'CLOSED' : 'OPEN') + '. ' +
    'Applications in the last 24 hours: ' + recentCount_() + '. ' +
    'Mail recipients left today: ' + quota + '. ' +
    'Add &set=off to close, &set=on to open, &set=reset to clear the counter.');
}

// Run once from the editor. Prints the kill switch URL and the real mail quota.
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, ''));
  }
  props.setProperty('FORM_OPEN', 'yes');
  Logger.log('ADMIN_KEY: ' + props.getProperty('ADMIN_KEY'));
  Logger.log('KILL SWITCH: <your /exec url>?k=' + props.getProperty('ADMIN_KEY') + '&set=off');
  Logger.log('Mail recipients remaining today: ' + MailApp.getRemainingDailyQuota());
  Logger.log('100 means a consumer Gmail account. 1500 means Google Workspace.');
}

// ---------------------------------------------------------------- the handler

function handle(e) {
  const p = (e && e.parameter) || {};
  const props = PropertiesService.getScriptProperties();

  // Silent drops. A bot learns nothing from a page that looks like success.
  if (oneLine_(p.Company, 200)) { return receivedPage_(false); }           // honeypot
  const started = parseInt(p.t, 10);
  if (started && (Date.now() - started) < MIN_FILL_SECONDS * 1000) { return receivedPage_(false); }

  if (props.getProperty('FORM_OPEN') === 'no') {
    return page('Applications are paused',
      'The Chapter is not accepting applications through this page at the moment. ' +
      'Please write to the Chapter Secretary at ' + SECRETARY + ' and your application will be taken by hand.');
  }

  // ---- fields, cleaned. Control characters and zero-width characters go.
  const f = {
    name:      oneLine_(p.Name, 120),
    title:     oneLine_(p.Title, 80),
    office:    oneLine_(p.Office, 120),
    phone:     oneLine_(p.Phone, 30),
    email:     oneLine_(p.Email, 160),
    address:   oneLine_(p.Address, 160),
    city:      oneLine_(p.City, 80),
    state:     oneLine_(p.State, 20),
    zip:       oneLine_(p.ZIP, 10),
    other:     oneLine_(p.Other, 160),
    signature: oneLine_(p.Signature, 120),
    date:      oneLine_(p.Date, 60),
    lodge:     multiLine_(p.Affiliations, 1200, 30)
  };
  const certified = (oneLine_(p.Certification, 20) === 'Agreed');
  const rawInterests = (e && e.parameters &&
    (e.parameters['Interest[]'] || e.parameters['Interest'])) || [];
  const interests = rawInterests.map(function (v) { return oneLine_(v, 60); })
                                .filter(function (v) { return v; }).slice(0, 12);

  // ---- server-side validation. Nothing is emailed until this passes.
  const missing = [];
  if (!f.name) { missing.push('your full name'); }
  if (!f.lodge) { missing.push('your Masonic affiliations'); }
  if (!f.office) { missing.push('your current Masonic office'); }
  if (!validPhone_(f.phone)) { missing.push('a ten digit telephone number'); }
  if (!validEmail_(f.email)) { missing.push('a valid email address'); }
  if (!f.address) { missing.push('your mailing address'); }
  if (!f.city) { missing.push('your city'); }
  if (!f.state) { missing.push('your state'); }
  if (!validZip_(f.zip)) { missing.push('a five digit ZIP code'); }
  if (!interests.length && !f.other) { missing.push('at least one area of interest'); }
  if (!f.signature) { missing.push('your signature'); }
  if (!certified) { missing.push('the certification box, which must be checked'); }

  if (missing.length) {
    return page('Your application is not complete',
      'Nothing has been sent yet. Please go back and supply ' + missing.join(', ') + '. ' +
      'If the form will not accept your entry, write to the Chapter Secretary at ' + SECRETARY +
      ' and your application will be taken by hand.');
  }

  // ---- rate limits and mail quota reserve
  if (!rateOk_()) {
    alertOnce_('ALERTED_RATE', 'Phylaxis application form hit its rate limit',
      'The membership application form refused submissions because it passed ' + MAX_PER_DAY +
      ' in 24 hours or ' + MAX_PER_10_MIN + ' in 10 minutes.\n\n' +
      'If this was not a genuine rush of applications, close the form with the kill switch URL ' +
      'from setup(), then look at the executions log.\n');
    return page('Please try again shortly',
      'The application page is receiving an unusual number of submissions and has paused to protect ' +
      'the Chapter mailbox. Please try again in a few minutes, or write to the Chapter Secretary at ' +
      SECRETARY + ' and your application will be taken by hand.');
  }
  let quotaLeft = 0;
  try { quotaLeft = MailApp.getRemainingDailyQuota(); } catch (err) { quotaLeft = 0; }
  if (quotaLeft < QUOTA_RESERVE) {
    alertOnce_('ALERTED_QUOTA', 'Phylaxis application form is out of mail quota',
      'The daily mail quota is nearly spent, so the form stopped sending to protect the last ' +
      QUOTA_RESERVE + ' sends. Applications are being refused with a message telling the applicant ' +
      'to email you directly. The quota refills on a rolling 24 hour basis.\n');
    return page('We could not record your application',
      'Our mail system has reached its limit for today, so nothing was recorded and no email was sent. ' +
      'Please write to the Chapter Secretary at ' + SECRETARY + ' and your application will be taken by hand.');
  }

  // ---- the record. Trusted verdict first, applicant text second, always quoted.
  const stamp = Utilities.formatDate(new Date(), 'America/New_York', "EEEE, MMMM d, yyyy 'at' h:mm a z");
  const body =
    'MEMBERSHIP APPLICATION\n' + CHAPTER + '\n' +
    '========================================\n' +
    'CERTIFICATION: ' + (certified ? 'CHECKED by the applicant' : 'NOT CHECKED') + '\n' +
    'Received: ' + stamp + '\n' +
    'Reply-to on this message: ' + f.email + '   (supplied by the submitter, not verified)\n' +
    '========================================\n' +
    'Everything below is typed by the submitter and is not verified by the Chapter.\n' +
    'Lines beginning with | are quoted from a free-text box. Any heading that appears\n' +
    'inside a quoted block was typed by the submitter and is not part of this record.\n' +
    '========================================\n\n' +
    'APPLICANT\n' +
    line_('Full name', f.name) +
    line_('Masonic title or rank', f.title) +
    line_('Current Masonic office', f.office) +
    line_('Telephone', f.phone) +
    line_('Email', f.email) +
    line_('Address', f.address) +
    'City, State, ZIP: ' + f.city + ', ' + f.state + ' ' + f.zip + '\n' +
    '\nMASONIC AFFILIATIONS (free text, quoted)\n' + f.lodge + '\n' +
    '\nAREAS OF INTEREST\n' +
    (interests.length ? '  - ' + interests.join('\n  - ') + '\n' : '') +
    line_('  Other', f.other) +
    '\nMEMBERSHIP\n' +
    'Chapter dues: $10.00 a year, payable to the Treasurer on approval.\n' +
    'National Phylaxis Society membership is separate, is paid to the national Society,\n' +
    'and is $50.00 a year. It is not required in order to join this Chapter.\n' +
    '\nCERTIFICATION\n' +
    'The applicant checked the certification box, which reads:\n\n' +
    '  "I certify that I am a Master Mason in good standing in a regular lodge of\n' +
    '   Prince Hall Affiliation, and that the information given above is true and\n' +
    '   correct to the best of my knowledge. I hereby apply for membership in the\n' +
    '   ' + CHAPTER + '.\n' +
    '   I support the Chapter mission to preserve, research, document, and promote\n' +
    '   the history, traditions, achievements, and legacy of Prince Hall Freemasonry,\n' +
    '   and I agree to participate in its activities to the best of my ability."\n' +
    line_('Signed', f.signature) +
    line_('Date typed on the form', f.date) +
    '\n========================================\n' +
    'END OF RECORD. Nothing below this line is part of the application.\n' +
    'Status: pending presentation and vote at the next stated meeting.\n' +
    'Secretary: assign the membership number and record the dues on approval.\n';

  const subject = '[CERTIFIED] Phylaxis application - ' + f.name.slice(0, 60);

  NOTIFY.forEach(function (addr) {
    MailApp.sendEmail({ to: addr, subject: subject, body: body, replyTo: f.email });
  });

  // Applicant confirmation. Fixed text only. No applicant-supplied value appears here,
  // so this can never carry someone else's message out under our name.
  MailApp.sendEmail({
    to: f.email,
    subject: 'Your application - ' + CHAPTER,
    body:
      'Brother,\n\n' +
      'Your application for membership in the ' + CHAPTER + ' has been received.\n\n' +
      'It will be presented to the Chapter for a vote at the next stated meeting. Chapter dues\n' +
      'of $10.00 a year are payable to the Treasurer once your application is approved, and your\n' +
      'membership number will be assigned at that time.\n\n' +
      'If you did not apply for membership, or if you have any question, write to the Chapter\n' +
      'Secretary at ' + SECRETARY + '.\n\n' +
      'Fraternally,\n' +
      'W. Aaron Dixon-Saunders, Secretary\n' +
      CHAPTER + '\n'
  });

  return receivedPage_(true);
}

// ---------------------------------------------------------------- helpers

// Single-line field: kill control characters, zero-width characters and runs of space, then cap.
function oneLine_(v, max) {
  return (v == null ? '' : v.toString())
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

// Free-text field: keep the line breaks the applicant meant, but quote every line so
// nothing typed inside can imitate a heading in the report above.
function multiLine_(v, maxChars, maxLines) {
  const clean = (v == null ? '' : v.toString())
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, ' ')
    .slice(0, maxChars);
  const lines = clean.split('\n')
    .map(function (l) { return l.replace(/[ \t]+/g, ' ').trim(); })
    .filter(function (l, i, a) { return l || (i > 0 && a[i - 1]); })
    .slice(0, maxLines);
  const out = lines.map(function (l) { return '  | ' + l; }).join('\n');
  return out ? out : '';
}

function line_(label, val) { return val ? label + ': ' + val + '\n' : ''; }

function validEmail_(v) { return /^[^\s@,;:<>"']+@[^\s@,;:<>"'.]+(\.[^\s@,;:<>"'.]+)+$/.test(v); }
function validZip_(v) { return /^\d{5}(-\d{4})?$/.test(v); }
function validPhone_(v) {
  const d = (v || '').replace(/\D/g, '');
  return d.length === 10 || (d.length === 11 && d.charAt(0) === '1');
}

function rateOk_() {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) { return false; }
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    let hits = [];
    try { hits = JSON.parse(props.getProperty('HITS') || '[]'); } catch (err) { hits = []; }
    hits = hits.filter(function (t) { return (now - t) < 86400000; });
    const burst = hits.filter(function (t) { return (now - t) < 600000; }).length;
    if (hits.length >= MAX_PER_DAY || burst >= MAX_PER_10_MIN) {
      props.setProperty('HITS', JSON.stringify(hits));
      return false;
    }
    hits.push(now);
    props.setProperty('HITS', JSON.stringify(hits));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function recentCount_() {
  try {
    const now = Date.now();
    const hits = JSON.parse(PropertiesService.getScriptProperties().getProperty('HITS') || '[]');
    return hits.filter(function (t) { return (now - t) < 86400000; }).length;
  } catch (err) { return 0; }
}

// One warning a day, so the alarm never becomes the flood.
function alertOnce_(key, subject, body) {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  if (props.getProperty(key) === today) { return; }
  props.setProperty(key, today);
  try { MailApp.sendEmail(SECRETARY, subject, body); } catch (err) {}
}

function receivedPage_(real) {
  return page('Application Received',
    'Thank you, Brother. Your application has been recorded and the Secretary and the President ' +
    'have been notified. It will be presented to the Chapter for a vote at the next stated meeting.' +
    (real ? ' A confirmation has been sent to the email address you gave.' : ''));
}

// A plain confirmation page. Readable with or without JavaScript.
// Both arguments are Chapter-authored constants. No applicant text reaches this function.
function page(heading, message) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + heading + '</title></head>' +
    '<body style="margin:0;background:#F4EFE4;color:#1A2438;font-family:Georgia,serif;line-height:1.6">' +
    '<div style="max-width:640px;margin:0 auto;padding:64px 28px">' +
    '<div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.22em;' +
    'text-transform:uppercase;color:#7A6120;font-weight:700">The Phylaxis Society</div>' +
    '<h1 style="font-size:30px;margin:10px 0 6px">' + heading + '</h1>' +
    '<p style="color:#4B5164;font-style:italic;margin:0 0 22px">' + CHAPTER + '</p>' +
    '<p>' + message + '</p>' +
    '<p style="margin-top:26px"><a href="' + FORM_URL + '" style="color:#22436B">' +
    'Return to the Chapter application page</a></p>' +
    '</div></body></html>');
}
