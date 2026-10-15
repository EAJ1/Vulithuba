const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

test('Only administrators can read leads, payments, or the staff page', { timeout: 20000 }, async (t) => {
  const root = path.resolve(__dirname, '..');
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'vulithuba-access-'));
  await fs.copyFile(path.join(root, 'smsportal-sms.js'), path.join(fixture, 'smsportal-sms.js'));
  await fs.copyFile(path.join(root, 'clicksend-sms.js'), path.join(fixture, 'clicksend-sms.js'));
  await fs.copyFile(path.join(root, 'server.js'), path.join(fixture, 'server.js'));
  await fs.copyFile(path.join(root, 'infobip-sms.js'), path.join(fixture, 'infobip-sms.js'));
  await fs.copyFile(path.join(root, 'bulksms-sms.js'), path.join(fixture, 'bulksms-sms.js'));
  await fs.copyFile(path.join(root, 'vonage-verify.js'), path.join(fixture, 'vonage-verify.js'));
  await fs.copyFile(path.join(root, 'registration-validation.js'), path.join(fixture, 'registration-validation.js'));
  await fs.writeFile(path.join(fixture, '.env'), '');
  await fs.writeFile(path.join(fixture, 'admin.html'), '<h1>Staff dashboard</h1>');
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const preload = path.join(fixture, 'mail-mock.cjs');
  await fs.writeFile(preload, `const fs = require('node:fs'); require('nodemailer').createTransport = () => ({sendMail: async mail => {fs.writeFileSync('email.json', JSON.stringify(mail));}});`);
  const readCode = async () => JSON.parse(await fs.readFile(path.join(fixture, 'email.json'), 'utf8')).text.match(/\b\d{6}\b/)[0];
  const startServer = (extraEnv = {}) => spawn(process.execPath, ['--require', preload, 'server.js'], {
    cwd: fixture,
    env: { PATH: process.env.PATH, PORT: String(port), NODE_PATH: path.join(root, 'node_modules'), SMTP_HOST: 'mock', SMTP_USER: 'admin@example.invalid', SMTP_PASS: 'mock', MAIL_TO: 'admin@example.invalid', ...extraEnv },
    stdio: 'ignore'
  });
  let child = startServer();
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    await fs.rm(fixture, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const post = (route, body) => fetch(`${base}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const get = (route, cookie) => fetch(`${base}${route}`, { headers: cookie ? { Cookie: cookie } : {} });
  for (const route of ['/api/me', '/api/leads', '/api/payments']) {
    assert.equal((await get(route)).status, 401);
  }
  const signup = await post('/api/signup', {
    username: 'test-customer', email: 'customer@example.invalid', fullName: 'Test Customer',
    phone: '+27821234567', address: 'Test address', password: 'Test-password-123',
    confirmPassword: 'Test-password-123', plan: 'Fibre Lite', billingMethod: 'EFT', verificationMethod: 'email'
  });
  assert.equal(signup.status, 201);
  assert.equal((await post('/api/verify-account', { username: 'test-customer', code: await readCode() })).status, 200);
  async function login(username, password) {
    const response = await post('/api/login', { username, password, channel: username === 'admin' ? 'sms' : 'email' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
    const result = await response.json();
    assert.equal(result.requiresLoginVerification, true);
    if (username === 'admin') assert.equal(result.channel, 'email');
    const pin = await readCode();
    assert.equal((await post('/api/verify-login', { challenge: result.challenge, code: '000000' })).status, 400);
    const verified = await post('/api/verify-login', { challenge: result.challenge, code: pin });
    assert.equal(verified.status, 200);
    assert.equal((await post('/api/verify-login', { challenge: result.challenge, code: pin })).status, 400);
    return verified.headers.get('set-cookie').split(';')[0];
  }
  const customerCookie = await login('test-customer', 'Test-password-123');
  const customer = await (await get('/api/me', customerCookie)).json();
  assert.equal(customer.user.isAdmin, false);
  assert.equal(customer.user.plan, 'Fibre Lite');
  assert.equal(customer.user.billingStatus, 'pending');
  for (const route of ['/api/leads', '/api/payments', '/admin.html']) {
    assert.equal((await get(route, customerCookie)).status, 403);
  }
  // This password belongs only to the disposable, empty fixture database.
  for (const route of ['/.env', '/server.js', '/data/vulithuba.db', '/package.json', '/tests/backend-access.test.js']) {
    assert.equal((await get(route)).status, 404);
  }
  const adminCookie = await login('admin', 'Admin123!');
  const admin = await (await get('/api/me', adminCookie)).json();
  assert.equal(admin.user.isAdmin, true);
  for (const route of ['/api/leads', '/api/payments', '/admin.html']) {
    assert.equal((await get(route, adminCookie)).status, 200);
  }
  const changed = await fetch(`${base}/api/change-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ currentPassword: 'Admin123!', newPassword: 'Fixture-admin-updated-123', confirmPassword: 'Fixture-admin-updated-123' })
  });
  assert.equal(changed.status, 200);
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  await exited;
  await fs.rm(path.join(fixture, '.env'));
  child = startServer({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://fixture.example.invalid' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await login('admin', 'Fixture-admin-updated-123');

  assert.equal((await post('/api/login', { username: 'admin', password: 'Admin123!' })).status, 401);

});
