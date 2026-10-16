const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { DatabaseSync } = require('node:sqlite');
const nodemailer = require('nodemailer');
const registration = require('./registration-validation');

const ROOT = __dirname;
if (typeof process.loadEnvFile === 'function' && fs.existsSync(path.join(ROOT, '.env'))) {
  process.loadEnvFile(path.join(ROOT, '.env'));
}
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_PATH = path.join(DATA_DIR, 'vulithuba.db');
const ADMIN_USERNAME = 'admin';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || (IS_PRODUCTION ? '' : 'Admin123!');
const SMTP_CONFIGURED = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_TO);
const infobip = require('./infobip-sms').createInfobipSender(process.env);
const bulksms = require('./bulksms-sms').createBulkSmsSender(process.env);
const vonage = require('./vonage-verify').createVonageVerify(process.env);
const smsportal = require('./smsportal-sms').createSmsPortalSender(process.env);
const clicksend = require('./clicksend-sms').createClickSendSender(process.env);
const SMS_PROVIDER = String(process.env.SMS_PROVIDER || (clicksend.configured ? 'clicksend' : smsportal.configured ? 'smsportal' : vonage.configured ? 'vonage' : bulksms.configured ? 'bulksms' : infobip.configured ? 'infobip' : 'twilio')).trim().toLowerCase();
if (!['clicksend', 'smsportal', 'vonage', 'bulksms', 'infobip', 'twilio'].includes(SMS_PROVIDER)) throw new Error('SMS_PROVIDER must be clicksend, smsportal, vonage, bulksms, infobip or twilio.');
const SMS_CONFIGURED = SMS_PROVIDER === 'clicksend' ? clicksend.configured : SMS_PROVIDER === 'smsportal' ? smsportal.configured : SMS_PROVIDER === 'vonage' ? vonage.configured : SMS_PROVIDER === 'bulksms' ? bulksms.configured : SMS_PROVIDER === 'infobip' ? infobip.configured : Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
const TWILIO_VERIFY_CONFIGURED = SMS_PROVIDER === 'twilio' && Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_VERIFY_SERVICE_SID
);
const PAYFAST_CONFIGURED = Boolean(
  process.env.PAYFAST_MERCHANT_ID &&
  process.env.PAYFAST_MERCHANT_KEY &&
  process.env.PAYFAST_PASSPHRASE
);
const PAYFAST_URL = String(process.env.PAYFAST_URL || 'https://sandbox.payfast.co.za/eng/process').replace(/\/$/, '');
const APP_URL = String(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/$/, '');
if (IS_PRODUCTION && (!(process.env.APP_URL || process.env.RENDER_EXTERNAL_URL) || new URL(APP_URL).protocol !== 'https:')) {
  throw new Error('Production requires APP_URL or RENDER_EXTERNAL_URL set to the public HTTPS website address.');
}
const mailer = SMTP_CONFIGURED
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: String(process.env.SMTP_PASS || '').replace(/\s/g, '')
      }
    })
  : null;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    company TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT,
    full_name TEXT,
    phone TEXT,
    address TEXT,
    plan TEXT,
    billing_method TEXT,
    billing_status TEXT NOT NULL DEFAULT 'pending',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code_hash TEXT NOT NULL,
    channel TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    payment_id TEXT NOT NULL UNIQUE,
    amount TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    provider TEXT NOT NULL DEFAULT 'payfast',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

for (const [name, definition] of [['provider', "TEXT NOT NULL DEFAULT 'local'"], ['provider_request_id', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(verification_codes)').all().some(column => column.name === name)) db.exec(`ALTER TABLE verification_codes ADD COLUMN ${name} ${definition}`);
}

db.exec(`CREATE TABLE IF NOT EXISTS login_challenges (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, code_hash TEXT NOT NULL,
  provider TEXT NOT NULL, request_id TEXT, expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, used_at TEXT
)`);

if (!db.prepare('PRAGMA table_info(leads)').all().some((column) => column.name === 'phone')) {
  db.exec('ALTER TABLE leads ADD COLUMN phone TEXT;');
}

const userColumns = db.prepare('PRAGMA table_info(users)').all();
const userColumnNames = new Set(userColumns.map((column) => column.name));
const missingColumns = [
  ['email', 'TEXT'],
  ['full_name', 'TEXT'],
  ['phone', 'TEXT'],
  ['address', 'TEXT'],
  ['plan', 'TEXT'],
  ['billing_method', 'TEXT'],
  ['billing_status', "TEXT NOT NULL DEFAULT 'pending'"],
  ['verified', 'INTEGER NOT NULL DEFAULT 1']
];
for (const [name, type] of missingColumns) {
  if (!userColumnNames.has(name)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type};`);
  }
}

const existingAdmin = db.prepare('SELECT * FROM users WHERE username = ?').get(ADMIN_USERNAME);
if (!existingAdmin) {
  if (!ADMIN_PASSWORD || (IS_PRODUCTION && (ADMIN_PASSWORD === 'Admin123!' || ADMIN_PASSWORD.length < 16))) {
    throw new Error('Set ADMIN_INITIAL_PASSWORD to a unique password of at least 16 characters for a new production database.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(ADMIN_PASSWORD, salt, 100000, 64, 'sha512').toString('hex');
  db.prepare('INSERT INTO users (username, email, full_name, plan, billing_method, billing_status, verified, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(ADMIN_USERNAME, 'admin@vulithuba.co.za', 'Vulithuba Administrator', 'admin', 'internal', 'active', 1, hash, salt);
}

// Guards reject duplicate addresses even when concurrent requests reach insertion.
db.exec(`
  CREATE INDEX IF NOT EXISTS users_email_normalized ON users(lower(trim(email)));
  CREATE TRIGGER IF NOT EXISTS users_registration_duplicate_insert BEFORE INSERT ON users BEGIN
    SELECT RAISE(ABORT, 'Registration email conflict') WHERE NEW.email IS NOT NULL AND EXISTS
      (SELECT 1 FROM users WHERE lower(trim(email)) = lower(trim(NEW.email)));
    SELECT RAISE(ABORT, 'Registration username conflict') WHERE EXISTS
      (SELECT 1 FROM users WHERE lower(username) = lower(NEW.username));
  END;
  CREATE TRIGGER IF NOT EXISTS users_registration_duplicate_email_update BEFORE UPDATE OF email ON users BEGIN
    SELECT RAISE(ABORT, 'Registration email conflict') WHERE NEW.email IS NOT NULL AND EXISTS
      (SELECT 1 FROM users WHERE id != OLD.id AND lower(trim(email)) = lower(trim(NEW.email)));
  END;
`);

function registrationConflicts(values) {
  const errors = {};
  if (db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)').get(values.username)) errors.username = 'This username is already in use.';
  if (db.prepare('SELECT id FROM users WHERE lower(trim(email)) = ?').get(values.email)) errors.email = 'An account with this email address already exists.';
  return errors;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const requestOrigin = res.req && res.req.headers.origin;
  const corsHeaders = requestOrigin === 'null' || requestOrigin === `http://localhost:${PORT || 3000}`
    ? {
        'Access-Control-Allow-Origin': requestOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        Vary: 'Origin'
      }
    : {};

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders,
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function readFileSafe(filePath) {
  return fs.readFileSync(filePath);
}

function serveStaticFile(res, requestPath) {
  // Only public website files may be downloaded; never serve the project root.
  const publicFiles = new Set([
    'index.html', 'login.html', 'signup.html', 'account.html', 'admin.html',
    'forgot-password.html', 'reset-password.html', 'verify-account.html', 'mobile.html',
    'Vulithuba-test-v6.apk', 'Vulithuba-test-v7.apk', 'styles.css', 'mobile.css', 'script.js', 'script-v2.js', 'script-v3.js', 'mobile.js', 'registration-validation.js', 'signup.js'
  ]);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\//, '');
  if (!publicFiles.has(relativePath)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const filePath = path.join(ROOT, relativePath);

  try {
    const data = readFileSafe(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    });
    res.end(data);
  } catch (error) {
    if (requestPath === '/' || requestPath === '/index.html') {
      try {
        const indexData = readFileSafe(path.join(ROOT, 'index.html'));
        sendHtml(res, indexData);
        return;
      } catch (innerError) {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          resolve(JSON.parse(body));
          return;
        }

        const params = new URLSearchParams(body);
        const result = {};
        for (const [key, value] of params.entries()) {
          result[key] = value;
        }
        resolve(result);
      } catch (error) {
        reject(new Error('Invalid request body'));
      }
    });

    req.on('error', reject);
  });
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

const PLAN_PRICES = {
  'Fibre Lite': '399.00',
  'Family Plus': '699.00',
  'Office Pro': '1299.00'
};

function payFastEncode(value) {
  return encodeURIComponent(String(value).trim()).replace(/%20/g, '+');
}

function payFastSignature(fields) {
  const payload = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${payFastEncode(value)}`)
    .join('&');
  const withPassphrase = `${payload}&passphrase=${payFastEncode(process.env.PAYFAST_PASSPHRASE)}`;
  return crypto.createHash('md5').update(withPassphrase).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getCookieValue(headerCookie, name) {
  if (!headerCookie) return null;
  const cookies = headerCookie.split(';').map((part) => part.trim());
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split('=');
    if (key === name) {
      return valueParts.join('=');
    }
  }
  return null;
}

function getSessionUser(req) {
  const sessionToken = getCookieValue(req.headers.cookie, 'vulithuba_session');
  if (!sessionToken) return null;

  const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(sessionToken);
  if (!session) return null;

  const expiresAt = new Date(session.expires_at).getTime();
  if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(sessionToken);
    return null;
  }

  return db.prepare('SELECT id, username, email, full_name, phone, address, plan, billing_method, billing_status FROM users WHERE id = ?').get(session.user_id);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'vulithuba_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' + (IS_PRODUCTION ? '; Secure' : ''));
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `vulithuba_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${IS_PRODUCTION ? '; Secure' : ''}`);
}

function createLead(payload) {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const company = String(payload.company || '').trim();

  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Valid name and email are required.');
  }

  const phone = String(payload.phone || '').trim();
  const stmt = db.prepare('INSERT INTO leads (name, email, phone, company) VALUES (?, ?, ?, ?)');
  stmt.run(name, email, phone || null, company || null);

  return { name, email, phone, company };
}

async function sendLeadEmail(lead) {
  if (!mailer) {
    return { sent: false, reason: 'Email is not configured. Add SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_TO.' };
  }

  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO,
    replyTo: lead.email,
    subject: `New Vulithuba callback request from ${lead.name}`,
    text: [
      'New callback request',
      '',
      `Name: ${lead.name}`,
      `Email: ${lead.email}`,
      `Company: ${lead.company || 'Not provided'}`,
      '',
      'This message was sent from the Vulithuba website.'
    ].join('\n')
  });

  return { sent: true };
}

async function sendVerificationEmail(email, code) {
  if (!mailer) return { sent: false, reason: 'Email verification is not configured.' };
  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Your Vulithuba verification code',
    text: `Your Vulithuba verification code is ${code}. It expires in 10 minutes.`
  });
  return { sent: true };
}

async function sendPasswordResetEmail(email, resetLink) {
  if (!mailer) return { sent: false, reason: 'Password reset email is not configured.' };
  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Reset your Vulithuba password',
    text: [
      'We received a request to reset your Vulithuba password.',
      '',
      `Use this secure one-time link within one hour: ${resetLink}`,
      '',
      'If you did not request this, you can safely ignore this email.'
    ].join('\n')
  });
  return { sent: true };
}

function getAppUrl(req) {
  if (IS_PRODUCTION) return APP_URL;
  const host = String(req.headers.host || '');
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) {
    return `http://${host}`;
  }
  return APP_URL;
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function createVerificationCode(userId, channel) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 600000).toISOString();
  db.prepare('DELETE FROM verification_codes WHERE user_id = ?').run(userId);
  db.prepare('INSERT INTO verification_codes (user_id, code_hash, channel, expires_at) VALUES (?, ?, ?, ?)')
    .run(userId, hashVerificationCode(code), channel, expiresAt);
  return code;
}

function twilioRequest(pathname, params) {
  return new Promise((resolve) => {
    const body = new URLSearchParams(params).toString();
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const request = https.request({
      hostname: 'api.twilio.com',
      path: pathname,
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      let responseBody = '';
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        let details = {};
        try { details = responseBody ? JSON.parse(responseBody) : {}; } catch (error) {}
        if (response.statusCode < 200 || response.statusCode >= 300) {
          resolve({
            ok: false,
            error: details.message || details.error_message || `Twilio request failed (${response.statusCode}).`
          });
          return;
        }
        resolve({ ok: true, details });
      });
    });
    request.on('error', (error) => resolve({ ok: false, error: error.message }));
    request.write(body);
    request.end();
  });
}

async function sendSmsVerification(recipient) {
  if (!TWILIO_VERIFY_CONFIGURED) {
    return { sent: false, reason: 'Twilio Verify is not configured. Add TWILIO_VERIFY_SERVICE_SID.' };
  }
  const result = await twilioRequest(
    `/v2/Services/${encodeURIComponent(process.env.TWILIO_VERIFY_SERVICE_SID)}/Verifications`,
    { To: recipient, Channel: 'sms' }
  );
  return result.ok ? { sent: true } : { sent: false, reason: `SMS OTP delivery failed: ${result.error}` };
}

async function checkSmsVerification(recipient, code) {
  if (!TWILIO_VERIFY_CONFIGURED) {
    return { approved: false, reason: 'Twilio Verify is not configured.' };
  }
  const result = await twilioRequest(
    `/v2/Services/${encodeURIComponent(process.env.TWILIO_VERIFY_SERVICE_SID)}/VerificationCheck`,
    { To: recipient, Code: code }
  );
  return { approved: Boolean(result.ok && result.details.status === 'approved'), reason: result.ok ? 'Incorrect verification code.' : result.error };
}

function sendSms(message, recipient = process.env.SMS_TO) {
  if (SMS_PROVIDER === 'clicksend') return clicksend.send(message, recipient);
  if (SMS_PROVIDER === 'smsportal') return smsportal.send(message, recipient);
  if (SMS_PROVIDER === 'vonage') return Promise.resolve({ sent: false, reason: 'Vonage Verify supports verification codes only.' });
  if (SMS_PROVIDER === 'bulksms') return bulksms.send(message, recipient);
  if (SMS_PROVIDER === 'infobip') return infobip.send(message, recipient);
  if (!SMS_CONFIGURED) {
    return Promise.resolve({ sent: false, reason: 'SMS is not configured. Add Twilio credentials and SMS_TO.' });
  }

  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      To: recipient,
      From: process.env.TWILIO_FROM,
      Body: message
    }).toString();
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const request = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${encodeURIComponent(process.env.TWILIO_ACCOUNT_SID)}/Messages.json`,
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      let responseBody = '';
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          let providerMessage = '';
          try {
            const details = JSON.parse(responseBody);
            providerMessage = details.message || details.error_message || '';
          } catch (error) {
            providerMessage = '';
          }
          resolve({
            sent: false,
            reason: `SMS delivery failed (${response.statusCode})${providerMessage ? `: ${providerMessage}` : '.'}`
          });
          return;
        }
        resolve({ sent: true });
      });
    });
    request.on('error', (error) => resolve({ sent: false, reason: `SMS delivery failed: ${error.message}` }));
    request.write(body);
    request.end();
  });
}

function requireAuth(req, res) {
  const user = getSessionUser(req);
  if (!user) {
    sendJson(res, 401, { ok: false, error: 'Authentication required.' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.username !== ADMIN_USERNAME) {
    sendJson(res, 403, { ok: false, error: 'Administrator access required.' });
    return null;
  }
  return user;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      status: 'healthy',
      emailConfigured: SMTP_CONFIGURED,
      smsConfigured: SMS_CONFIGURED,
      smsProvider: SMS_PROVIDER,
      smsOtpConfigured: TWILIO_VERIFY_CONFIGURED || (SMS_PROVIDER === 'vonage' && vonage.configured)
      ,payfastConfigured: PAYFAST_CONFIGURED
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/me') {
    const user = getSessionUser(req);
    if (!user) {
      sendJson(res, 401, { ok: false, error: 'Authentication required.' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      user: {
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        address: user.address,
        plan: user.plan,
        billingMethod: user.billing_method,
        billingStatus: user.billing_status,
        isAdmin: user.username === ADMIN_USERNAME
      }
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/signup') {
    let transaction = false;
    try {
      const { values, errors } = registration.validate(await parseBody(req));
      if (Object.keys(errors).length) {
        sendJson(res, 400, { ok: false, error: 'Please correct the highlighted fields.', errors });
        return;
      }
      const conflicts = registrationConflicts(values);
      if (Object.keys(conflicts).length) {
        sendJson(res, 409, { ok: false, error: 'An account with these details already exists.', errors: conflicts });
        return;
      }
      const { username, email, fullName, phone, address, plan, billingMethod, verificationMethod, password } = values;
      const code = String(crypto.randomInt(100000, 1000000));
      const expiresAt = new Date(Date.now() + 600000).toISOString();
      const localOnly = !IS_PRODUCTION && !SMS_CONFIGURED && !TWILIO_VERIFY_CONFIGURED && !SMTP_CONFIGURED;
      let deliveredChannel = verificationMethod;
      let delivery = { sent: localOnly };
      if (!localOnly) {
        try {
          delivery = verificationMethod === 'sms'
            ? SMS_PROVIDER === 'vonage' ? await vonage.start(phone) : TWILIO_VERIFY_CONFIGURED ? await sendSmsVerification(phone)
              : await sendSms(`Vulithuba verification code: ${code}. Expires in 10 minutes.`, phone)
            : await sendVerificationEmail(email, code);
        } catch (_) {
          delivery = { sent: false, reason: 'Verification could not be delivered.' };
        }
        if (!delivery.sent && verificationMethod === 'sms' && mailer) {
          try {
            delivery = await sendVerificationEmail(email, code);
            deliveredChannel = 'email';
          } catch (_) {
            delivery = { sent: false, reason: 'Verification could not be delivered by SMS or email.' };
          }
        }
      }
      if (!delivery.sent) {
        sendJson(res, 503, { ok: false, error: delivery.reason || 'Verification could not be delivered. Please try again.', errors: {
          [deliveredChannel === 'sms' ? 'phone' : 'email']: 'Unable to send your verification code. Check this contact detail and try again.'
        } });
        return;
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      db.exec('BEGIN IMMEDIATE'); transaction = true;
      const concurrentConflicts = registrationConflicts(values);
      if (Object.keys(concurrentConflicts).length) {
        db.exec('ROLLBACK'); transaction = false;
        sendJson(res, 409, { ok: false, error: 'An account with these details already exists.', errors: concurrentConflicts });
        return;
      }
      const result = db.prepare('INSERT INTO users (username, email, full_name, phone, address, plan, billing_method, billing_status, verified, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(username, email, fullName, phone, address, plan, billingMethod, 'pending', localOnly ? 1 : 0, passwordHash, salt);
      if (!localOnly) {
        db.prepare('INSERT INTO verification_codes (user_id, code_hash, channel, expires_at, provider, provider_request_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(Number(result.lastInsertRowid), hashVerificationCode(code), deliveredChannel, expiresAt, deliveredChannel === 'sms' ? delivery.provider || (TWILIO_VERIFY_CONFIGURED ? 'twilio' : 'local') : 'local', deliveredChannel === 'sms' ? delivery.requestId || null : null);
      }
      db.exec('COMMIT'); transaction = false;
      sendJson(res, 201, {
        ok: true, requiresVerification: !localOnly, channel: deliveredChannel,
        message: localOnly ? 'Account created successfully. You can now log in.'
          : deliveredChannel === 'email' && verificationMethod === 'sms'
            ? 'Account created successfully. SMS was unavailable, so check your email for the verification code.'
            : 'Account created successfully. Check your verification code.'
      });
    } catch (error) {
      if (transaction) db.exec('ROLLBACK');
      if (error.message === 'Invalid request body') {
        sendJson(res, 400, { ok: false, error: 'Invalid registration request.' });
      } else if (/Registration email conflict/.test(error.message)) {
        sendJson(res, 409, { ok: false, error: 'This email is already registered.', errors: { email: 'An account with this email address already exists.' } });
      } else {
        sendJson(res, 500, { ok: false, error: 'Account could not be created. Your details have not been saved; please try again.' });
      }
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/verify-account') {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const code = String(body.code || '').trim();
      const user = db.prepare('SELECT id, phone, verified FROM users WHERE username = ?').get(username);
      const verification = user
        ? db.prepare('SELECT id, code_hash, channel, expires_at, attempts, used_at, provider, provider_request_id FROM verification_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user.id)
        : null;

      if (!user || user.verified || !verification || verification.used_at || verification.attempts >= (verification.provider === 'vonage' ? 3 : 5) || new Date(verification.expires_at).getTime() < Date.now()) {
        throw new Error('This verification code is invalid or expired.');
      }
      db.prepare('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?').run(verification.id);
      const verified = verification.provider === 'vonage'
        ? await vonage.check(verification.provider_request_id, code)
        : verification.channel === 'sms' && verification.provider === 'twilio'
        ? await checkSmsVerification(user.phone, code)
        : { approved: hashVerificationCode(code) === verification.code_hash, reason: 'Incorrect verification code.' };
      if (!verified.approved) {
        throw new Error('Incorrect verification code.');
      }
      db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(user.id);
      db.prepare('UPDATE verification_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(verification.id);
      sendJson(res, 200, { ok: true, message: 'Account verified successfully.' });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to verify account.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/resend-verification') {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const requestedChannel = body.channel === 'sms' ? 'sms' : 'email';
      const user = db.prepare('SELECT id, email, phone, verified FROM users WHERE username = ?').get(username);
      if (!user || user.verified) throw new Error('Account not found or already verified.');
      const previous = db.prepare('SELECT * FROM verification_codes WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user.id);
      if (requestedChannel === 'sms' && previous?.provider === 'vonage' && !previous.used_at && new Date(previous.expires_at).getTime() > Date.now()) {
        throw new Error('Please use the SMS code already sent, or select email. You can request another SMS after the current code expires.');
      }
      const code = String(crypto.randomInt(100000, 1000000));
      let deliveredChannel = requestedChannel;
      let delivery = requestedChannel === 'sms'
        ? SMS_PROVIDER === 'vonage' ? await vonage.start(user.phone) : TWILIO_VERIFY_CONFIGURED
          ? await sendSmsVerification(user.phone)
          : await sendSms(`Vulithuba verification code: ${code}. Expires in 10 minutes.`, user.phone)
        : await sendVerificationEmail(user.email, code);

      if (!delivery.sent && requestedChannel === 'sms' && mailer) {
        delivery = await sendVerificationEmail(user.email, code);
        deliveredChannel = 'email';
      }

      if (delivery.sent) {
        db.prepare('INSERT INTO verification_codes (user_id, code_hash, channel, expires_at, provider, provider_request_id) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, hashVerificationCode(code), deliveredChannel, new Date(Date.now() + 600000).toISOString(), deliveredChannel === 'sms' ? delivery.provider || (TWILIO_VERIFY_CONFIGURED ? 'twilio' : 'local') : 'local', deliveredChannel === 'sms' ? delivery.requestId || null : null);
      }
      sendJson(res, delivery.sent ? 200 : 503, {
        ok: delivery.sent,
        channel: deliveredChannel,
        message: delivery.sent
          ? deliveredChannel === 'email' && requestedChannel === 'sms'
            ? 'SMS delivery was unavailable, so a new verification code was sent by email.'
            : 'A new verification code was sent.'
          : 'The verification message could not be delivered.',
        error: delivery.sent ? undefined : delivery.reason
      });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to resend verification code.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/login') {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');

      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user || hashPassword(password, user.password_salt) !== user.password_hash) {
        sendJson(res, 401, { ok: false, error: 'Invalid username or password.' });
        return;
      }

      if (!user.verified) {
        sendJson(res, 403, { ok: false, requiresVerification: true, error: 'Verify your account before logging in.' });
        return;
      }

      const channel = user.username === ADMIN_USERNAME || body.channel === 'email' ? 'email' : 'sms';
      const emailDestination = user.username === ADMIN_USERNAME && user.email === 'admin@vulithuba.co.za' ? process.env.ADMIN_VERIFICATION_EMAIL || process.env.SMTP_USER : user.email;
      const destination = channel === 'sms' ? user.phone : emailDestination;
      if (!destination) {
        sendJson(res, 400, { ok: false, error: `No ${channel === 'sms' ? 'phone number' : 'email address'} is saved for this account. Choose the other method or contact support.` });
        return;
      }
      const recent = db.prepare('SELECT * FROM login_challenges WHERE user_id = ? AND used_at IS NULL ORDER BY expires_at DESC LIMIT 1').get(user.id);
      if (recent && new Date(recent.expires_at).getTime() > Date.now() && recent.attempts < (recent.provider === 'vonage' ? 3 : 5)) {
        const challenge = crypto.randomBytes(32).toString('hex');
        db.prepare('UPDATE login_challenges SET token_hash = ? WHERE token_hash = ?').run(hashVerificationCode(challenge), recent.token_hash);
        sendJson(res, 200, { ok: true, requiresLoginVerification: true, challenge, channel, message: 'Enter the login code already sent to you. It remains valid for 10 minutes from the original request.' }); return;
      }
      const code = String(crypto.randomInt(100000, 1000000));
      const delivery = channel === 'email' ? await sendVerificationEmail(emailDestination, code)
        : SMS_PROVIDER === 'vonage' ? await vonage.start(user.phone)
        : TWILIO_VERIFY_CONFIGURED ? await sendSmsVerification(user.phone)
        : await sendSms(`Vulithuba login code: ${code}. Expires in 10 minutes.`, user.phone);
      if (!delivery.sent) {
        sendJson(res, 503, { ok: false, error: delivery.reason || 'Unable to send the SMS login code. Please wait a minute and try Login again.' }); return;
      }
      const challenge = crypto.randomBytes(32).toString('hex');
      db.prepare('DELETE FROM login_challenges WHERE user_id = ? OR expires_at < ?').run(user.id, new Date().toISOString());
      db.prepare('INSERT INTO login_challenges (token_hash, user_id, code_hash, provider, request_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(hashVerificationCode(challenge), user.id, hashVerificationCode(code), channel === 'sms' ? delivery.provider || (TWILIO_VERIFY_CONFIGURED ? 'twilio' : 'local') : 'local', delivery.requestId || null, new Date(Date.now() + 600000).toISOString());
      sendJson(res, 200, { ok: true, requiresLoginVerification: true, challenge, channel, message: `Enter the login code sent by ${channel}.` });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to login.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/verify-login') {
    try {
      const body = await parseBody(req);
      const challenge = String(body.challenge || '');
      const code = String(body.code || '').trim();
      const row = db.prepare('SELECT c.*, u.phone, u.username, u.verified FROM login_challenges c JOIN users u ON u.id = c.user_id WHERE c.token_hash = ?').get(hashVerificationCode(challenge));
      if (!row || !row.verified || row.used_at || new Date(row.expires_at).getTime() <= Date.now() || row.attempts >= (row.provider === 'vonage' ? 3 : 5)) {
        sendJson(res, 400, { ok: false, error: 'Login code expired or unavailable. Start login again.' }); return;
      }
      db.prepare('UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?').run(row.token_hash);
      const result = /^\d{6}$/.test(code) ? row.provider === 'vonage' ? await vonage.check(row.request_id, code)
        : row.provider === 'twilio' ? await checkSmsVerification(row.phone, code)
        : { approved: hashVerificationCode(code) === row.code_hash } : { approved: false };
      if (!result.approved) { sendJson(res, 400, { ok: false, error: 'Incorrect login code.' }); return; }
      // Claim once after the provider response; concurrent checks cannot create two sessions.
      db.exec('BEGIN IMMEDIATE');
      try {
        const claimed = db.prepare('UPDATE login_challenges SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').run(row.token_hash, new Date().toISOString());
        if (!claimed.changes) throw new Error('Login code already used or expired.');
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, row.user_id, new Date(Date.now() + 86400000).toISOString());
        db.exec('COMMIT');
        setSessionCookie(res, token);
        sendJson(res, 200, { ok: true, message: 'Login successful.', user: { username: row.username } });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } catch (_) { sendJson(res, 400, { ok: false, error: 'Unable to verify login. Please try again.' }); }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/logout') {
    const token = getCookieValue(req.headers.cookie, 'vulithuba_session');
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true, message: 'Logged out.' });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/update-profile') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      const body = await parseBody(req);
      const fullName = String(body.fullName || '').trim();
      const phone = String(body.phone || '').trim();
      const address = String(body.address || '').trim();
      const plan = String(body.plan || '').trim();
      const billingMethod = String(body.billingMethod || '').trim();

      if (fullName.length < 2) throw new Error('Please enter your full name.');
      if (phone.length < 7) throw new Error('Please enter a valid phone number.');
      if (address.length < 5) throw new Error('Please enter your address.');
      if (!['Fibre Lite', 'Family Plus', 'Office Pro'].includes(plan)) throw new Error('Please select a valid plan.');
      if (!['EFT', 'Debit order', 'Card'].includes(billingMethod)) throw new Error('Please select a valid payment method.');

      db.prepare('UPDATE users SET full_name = ?, phone = ?, address = ?, plan = ?, billing_method = ? WHERE id = ?')
        .run(fullName, phone, address, plan, billingMethod, user.id);
      sendJson(res, 200, { ok: true, message: 'Account details updated successfully.' });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to update account details.' });
    }

    return;
  }

  if (method === 'POST' && url.pathname === '/api/payfast/checkout') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!PAYFAST_CONFIGURED) {
      sendJson(res, 503, { ok: false, error: 'PayFast is not configured. Add PayFast merchant credentials and APP_URL.' });
      return;
    }

    try {
      const body = await parseBody(req);
      const plan = String(body.plan || user.plan || '').trim();
      const amount = PLAN_PRICES[plan];
      if (!amount) throw new Error('Please select a valid plan.');

      const paymentId = `VUL-${Date.now()}-${user.id}`;
      db.prepare('INSERT INTO payments (user_id, payment_id, amount, plan) VALUES (?, ?, ?, ?)')
        .run(user.id, paymentId, amount, plan);

      const nameParts = String(user.full_name || user.username).trim().split(/\s+/);
      const fields = {
        merchant_id: process.env.PAYFAST_MERCHANT_ID,
        merchant_key: process.env.PAYFAST_MERCHANT_KEY,
        return_url: `${APP_URL}/account.html?payment=success`,
        cancel_url: `${APP_URL}/account.html?payment=cancelled`,
        notify_url: `${APP_URL}/api/payfast/notify`,
        name_first: nameParts[0],
        name_last: nameParts.slice(1).join(' ') || nameParts[0],
        email_address: user.email,
        m_payment_id: paymentId,
        amount,
        item_name: `Vulithuba ${plan}`
      };
      sendJson(res, 200, { ok: true, action: PAYFAST_URL, fields: { ...fields, signature: payFastSignature(fields) } });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to create payment.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/payfast/notify') {
    try {
      const body = await parseBody(req);
      const receivedSignature = String(body.signature || '');
      const fields = { ...body };
      delete fields.signature;
      if (!receivedSignature || receivedSignature !== payFastSignature(fields)) {
        sendJson(res, 400, { ok: false, error: 'Invalid payment signature.' });
        return;
      }

      const payment = db.prepare('SELECT id, user_id FROM payments WHERE payment_id = ?').get(String(body.m_payment_id || ''));
      if (!payment) {
        sendJson(res, 404, { ok: false, error: 'Payment not found.' });
        return;
      }

      const status = String(body.payment_status || 'unknown').toLowerCase();
      db.prepare('UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, payment.id);
      if (status === 'complete') {
        db.prepare("UPDATE users SET billing_status = 'paid' WHERE id = ?").run(payment.user_id);
      }
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to process payment notification.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/change-password') {
    const user = requireAuth(req, res);
    if (!user) return;

    try {
      const body = await parseBody(req);
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      const confirmPassword = String(body.confirmPassword || '');
      const storedUser = db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(user.id);

      if (!storedUser || !safeEqual(hashPassword(currentPassword, storedUser.password_salt), storedUser.password_hash)) {
        throw new Error('Current password is incorrect.');
      }
      if (newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters long.');
      }
      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match.');
      }

      const salt = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
        .run(hashPassword(newPassword, salt), salt, user.id);
      db.prepare('DELETE FROM login_challenges WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      sendJson(res, 200, { ok: true, message: 'Password changed. Please log in again.' });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to change password.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/delete-account') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.username === ADMIN_USERNAME) {
      sendJson(res, 403, { ok: false, error: 'The administrator account cannot be deleted here.' });
      return;
    }

    try {
      db.prepare('DELETE FROM verification_codes WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM login_challenges WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
      const result = db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      if (Number(result.changes) !== 1) {
        throw new Error('The account could not be found.');
      }
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true, message: 'Account deleted.' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || 'Unable to delete account.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/forgot-password') {
    try {
      const body = await parseBody(req);
      const email = String(body.email || '').trim();
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      const response = { ok: true, message: 'If the email exists, reset instructions have been prepared.' };

      if (user) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 3600000).toISOString();
        db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
        db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(user.id, tokenHash, expiresAt);
        const appUrl = getAppUrl(req).replace(/\/$/, '');
        const resetLink = `${appUrl}/reset-password.html?token=${rawToken}`;
        const delivery = await sendPasswordResetEmail(email, resetLink);
        if (!delivery.sent) {
          db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
          throw new Error(delivery.reason);
        }
      }

      sendJson(res, 200, response);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to prepare password reset.' });
    }
    return;
  }

  if (method === 'POST' && url.pathname === '/api/reset-password') {
    try {
      const body = await parseBody(req);
      const token = String(body.token || '');
      const password = String(body.password || '');
      const confirmPassword = String(body.confirmPassword || '');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const reset = db.prepare('SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?').get(tokenHash);

      if (!reset || reset.used_at || new Date(reset.expires_at).getTime() < Date.now()) {
        throw new Error('This password reset link is invalid or expired.');
      }
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long.');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(passwordHash, salt, reset.user_id);
      db.prepare('UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(reset.id);
      db.prepare('DELETE FROM login_challenges WHERE user_id = ?').run(reset.user_id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
      sendJson(res, 200, { ok: true, message: 'Password changed successfully.' });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || 'Unable to reset password.' });
    }
    return;
  }

  if (method === 'GET' && url.pathname === '/api/leads') {
    const user = requireAdmin(req, res);
    if (!user) return;

    const rows = db.prepare('SELECT id, name, email, phone, company, created_at FROM leads ORDER BY id DESC LIMIT 20').all();
    sendJson(res, 200, { rows });
    return;
  }

  if (method === 'GET' && url.pathname === '/api/payments') {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.username !== ADMIN_USERNAME) {
      sendJson(res, 403, { ok: false, error: 'Administrator access required.' });
      return;
    }
    const rows = db.prepare(`
      SELECT payments.payment_id, payments.amount, payments.plan, payments.status,
             payments.created_at, payments.updated_at, users.username, users.email
      FROM payments
      JOIN users ON users.id = payments.user_id
      ORDER BY payments.id DESC
      LIMIT 100
    `).all();
    sendJson(res, 200, { rows });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/contact') {
    try {
      const body = await parseBody(req);
      const lead = createLead(body);
      const emailResult = await sendLeadEmail(lead);
      const smsResult = await sendSms(
        `Vulithuba callback: ${lead.name}, ${lead.phone || 'no phone'}, ${lead.email}.`
      );

      const notices = [];
      if (!emailResult.sent) notices.push(emailResult.reason);
      if (!smsResult.sent) notices.push(smsResult.reason);

      sendJson(res, 200, {
        ok: true,
        saved: true,
        message: !emailResult.sent
          ? 'Request saved, but email notification could not be sent.'
          : !smsResult.sent
            ? 'Request saved and email sent successfully. SMS notification is currently unavailable.'
            : 'Request saved and notifications sent successfully.',
        notice: notices.length ? notices.join(' ') : undefined
      });
    } catch (error) {
      sendJson(res, 502, { ok: false, error: error.message || 'Unable to save your request.' });
    }
    return;
  }

  if (method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin.html')) {
    const user = getSessionUser(req);
    if (!user) {
      serveStaticFile(res, '/login.html');
      return;
    }
    if (!requireAdmin(req, res)) return;
    serveStaticFile(res, '/admin.html');
    return;
  }

  if (method === 'GET' && (url.pathname === '/login' || url.pathname === '/login.html')) {
    serveStaticFile(res, '/login.html');
    return;
  }

  if (method === 'GET' && (url.pathname === '/signup' || url.pathname === '/signup.html')) {
    serveStaticFile(res, '/signup.html');
    return;
  }

  if (method === 'GET' && (url.pathname === '/account' || url.pathname === '/account.html')) {
    const user = getSessionUser(req);
    if (!user) {
      serveStaticFile(res, '/login.html');
      return;
    }
    serveStaticFile(res, '/account.html');
    return;
  }

  if (method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    serveStaticFile(res, '/index.html');
    return;
  }

  if (method === 'GET') {
    serveStaticFile(res, url.pathname);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Vulithuba website running at http://localhost:${PORT}`);
  console.log(`Database ready at ${DB_PATH}`);
  console.log('Admin account ready; existing passwords are preserved.');
});
