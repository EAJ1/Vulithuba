const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

for (const provider of ['infobip', 'bulksms', 'smsportal', 'clicksend']) {
test(`${provider} signup requires a valid code; failed delivery never activates an account`, { timeout: 20000 }, async (t) => {
  const root = path.resolve(__dirname, '..');
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'vulithuba-sms-'));
  for (const name of ['server.js', 'infobip-sms.js', 'bulksms-sms.js', 'vonage-verify.js', 'smsportal-sms.js', 'clicksend-sms.js', 'registration-validation.js']) await fs.copyFile(path.join(root, name), path.join(fixture, name));
  const preload = path.join(fixture, 'mock-provider.cjs');
  await fs.writeFile(preload, `
    const fs = require('node:fs');
    global.fetch = async (url, request) => {
      if (String(url) !== '${provider === 'clicksend' ? 'https://rest.clicksend.com/v3/sms/send' : provider === 'smsportal' ? 'https://rest.smsportal.com/v3/BulkMessages' : provider === 'infobip' ? 'https://example.api.infobip.com/sms/3/messages' : 'https://api.bulksms.com/v1/messages'}') throw new Error('Unexpected provider');
      fs.writeFileSync('outbox.json', request.body);
      return { ok: true, json: async () => '${provider}' === 'clicksend' ? ({response_code:'SUCCESS',data:{messages:[{status:fs.existsSync('reject')?'COUNTRY_NOT_ENABLED':'SUCCESS',message_id:'test'}]}}) : '${provider}' === 'smsportal' ? ({statusCode:200,sendResponse:{eventId:123,messages:fs.existsSync('reject')?0:1},errors:[]}) : '${provider}' === 'infobip' ? ({ messages: [{messageId:'test', status:{groupId: fs.existsSync('reject') ? 5 : 1}}] }) : [{id:'test',status:{type:fs.existsSync('reject') ? 'FAILED' : 'SENT'}}] };
    };
  `);
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--require', preload, 'server.js'], {
    cwd: fixture, stdio: 'ignore',
    env: { PATH: process.env.PATH, NODE_PATH: path.join(root, 'node_modules'), PORT: String(port),
      SMS_PROVIDER: provider, CLICKSEND_USERNAME:'test', CLICKSEND_API_KEY:'test', SMSPORTAL_CLIENT_ID:'test', SMSPORTAL_API_SECRET:'test', BULKSMS_TOKEN_ID: 'test', BULKSMS_TOKEN_SECRET: 'test', INFOBIP_BASE_URL: 'https://example.api.infobip.com', INFOBIP_API_KEY: 'test', INFOBIP_SENDER: 'ServiceSMS',
      TWILIO_ACCOUNT_SID: 'test', TWILIO_AUTH_TOKEN: 'test', TWILIO_VERIFY_SERVICE_SID: 'test' }
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await exited;
    }
    await fs.rm(fixture, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.smsProvider, provider);
  assert.equal(health.smsConfigured, true);
  assert.equal(health.smsOtpConfigured, false);
  const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const signup = username => post('/api/signup', { username, email: `${username}@example.invalid`, fullName: 'Test Customer',
    phone: '+27821234567', address: 'Test address', password: 'Test-password-123', confirmPassword: 'Test-password-123', verificationMethod: 'sms', plan: 'Fibre Lite', billingMethod: 'EFT' });
  const code = async () => {
    const request = JSON.parse(await fs.readFile(path.join(fixture, 'outbox.json'), 'utf8'));
    return (provider === 'clicksend' ? request.messages[0].body : provider === 'smsportal' ? request.messages[0].content : provider === 'infobip' ? request.messages[0].content.text : request.body).match(/\b\d{6}\b/)[0];
  };
  const login = username => post('/api/login', { username, password: 'Test-password-123' });
  const verify = (username, pin) => post('/api/verify-account', { username, code: pin });
  const response = await signup('sms-customer');
  assert.equal(response.status, 201);
  assert.equal((await response.json()).requiresVerification, true);
  assert.equal((await login('sms-customer')).status, 403);
  const pin = await code();
  assert.equal((await verify('sms-customer', '000000')).status, 400);
  assert.equal((await verify('sms-customer', pin)).status, 200);
  assert.equal((await verify('sms-customer', pin)).status, 400);
  const started = await login('sms-customer');
  assert.equal(started.status, 200);
  assert.equal(started.headers.get('set-cookie'), null);
  const challenge = (await started.json()).challenge;
  const loginPin = await code();
  const checkLogin = pin => post('/api/verify-login', { challenge, code: pin });
  assert.equal((await checkLogin('000000')).status, 400);
  const loggedIn = await checkLogin(loginPin);
  assert.equal(loggedIn.status, 200);
  assert.ok(loggedIn.headers.get('set-cookie'));
  assert.equal((await checkLogin(loginPin)).status, 400);

  await fs.writeFile(path.join(fixture, 'reject'), '');
  assert.equal((await signup('delivery-failed')).status, 503);
  assert.equal((await login('delivery-failed')).status, 401);
  await fs.rm(path.join(fixture, 'reject'));
  assert.equal((await signup('delivery-failed')).status, 201);
  const pendingPin = await code();
  for (let attempt = 0; attempt < 5; attempt++) assert.equal((await verify('delivery-failed', '000000')).status, 400);
  assert.equal((await verify('delivery-failed', pendingPin)).status, 400);
  await post('/api/resend-verification', { username: 'delivery-failed', channel: 'sms' });
  const db = new DatabaseSync(path.join(fixture, 'data/vulithuba.db'));
  db.prepare("UPDATE verification_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = (SELECT id FROM users WHERE username = ?)").run('delivery-failed');
  db.close();
  assert.equal((await verify('delivery-failed', await code())).status, 400);
});

}
