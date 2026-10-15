const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { validate, fields } = require('../registration-validation');

const valid = { fullName: 'Test Customer', phone: '+27663820665', username: 'test-customer', email: 'Customer@example.invalid',
  address: '12 Example Road', password: 'Test-password-123', confirmPassword: 'Test-password-123',
  plan: 'Fibre Lite', billingMethod: 'EFT', verificationMethod: 'sms' };

test('Registration rejects every missing field and malformed input type', () => {
  assert.deepEqual(validate(valid).errors, {});
  for (const field of fields) {
    for (const value of [undefined, '', [], {}, 123]) assert.ok(validate({ ...valid, [field]: value }).errors[field], field);
  }
  assert.equal(Object.keys(validate(null).errors).length, fields.length);
});

test('Registration validates formats, selections, limits and password confirmation', () => {
  for (const [field, value] of [
    ['phone', '+27'], ['phone', '+27letters123'], ['phone', '+270663820665'], ['phone', '+2766'],
    ['email', 'user@example'], ['email', 'user@example..com'], ['username', 'contains spaces'],
    ['fullName', '1234'], ['address', '12345'], ['password', '        '], ['confirmPassword', 'different'],
    ['plan', 'admin'], ['billingMethod', 'free'], ['verificationMethod', 'none']
  ]) assert.ok(validate({ ...valid, [field]: value }).errors[field], `${field}: ${value}`);
  assert.equal(validate(valid).values.email, 'customer@example.invalid');
  for (const password of ['123456', '1234567']) assert.deepEqual(validate({ ...valid, password, confirmPassword: password }).errors, {});
  assert.ok(validate({ ...valid, password: '12345', confirmPassword: '12345' }).errors.password);
});

test('Invalid requests and failed registration never persist; emails are unique ignoring case', { timeout: 20000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'vulithuba-registration-'));
  for (const name of ['server.js', 'infobip-sms.js', 'bulksms-sms.js', 'vonage-verify.js', 'smsportal-sms.js', 'clicksend-sms.js', 'registration-validation.js', 'signup.js', 'signup.html']) {
    await fs.copyFile(path.join(root, name), path.join(fixture, name));
  }
  const preload = path.join(fixture, 'provider.cjs');
  await fs.writeFile(preload, `
    const fs = require('node:fs');
    global.fetch = async () => {
      fs.appendFileSync('requests', 'sent\n');
      await new Promise(resolve => setTimeout(resolve, 20));
      return { ok: !fs.existsSync('reject'), status: 402,
        json: async () => [{id:'test',status:{type:'SENT'}}] };
    };
  `.replace("'sent\n'", "'sent\\n'"));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--require', preload, 'server.js'], { cwd: fixture, stdio: 'ignore', env: {
    PATH: process.env.PATH, NODE_PATH: path.join(root, 'node_modules'), PORT: String(port),
    SMS_PROVIDER: 'bulksms', BULKSMS_TOKEN_ID: 'test', BULKSMS_TOKEN_SECRET: 'test'
  } });
  t.after(async () => {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    await fs.rm(fixture, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { ready = (await fetch(`${base}/api/health`)).ok; if (ready) break; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  const db = new DatabaseSync(path.join(fixture, 'data/vulithuba.db'));
  t.after(() => db.close());
  const count = () => db.prepare("SELECT COUNT(*) AS count FROM users WHERE username != 'admin'").get().count;
  const codes = () => db.prepare('SELECT COUNT(*) AS count FROM verification_codes').get().count;
  const signup = body => fetch(`${base}/api/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`${base}/signup.html`)).status, 200);
  for (const field of fields) {
    const response = await signup({ ...valid, [field]: '' });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).errors[field]);
    assert.equal(count(), 0);
    assert.equal(codes(), 0);
  }
  for (const [field, value] of [['phone', 'incorrect'], ['email', 'incorrect'], ['plan', 'admin'], ['confirmPassword', 'mismatch']]) {
    assert.equal((await signup({ ...valid, [field]: value })).status, 400);
  }
  assert.equal(count(), 0);
  await assert.rejects(fs.stat(path.join(fixture, 'requests')), { code: 'ENOENT' });

  await fs.writeFile(path.join(fixture, 'reject'), '');
  assert.equal((await signup(valid)).status, 503);
  assert.equal(count(), 0); assert.equal(codes(), 0);
  await fs.rm(path.join(fixture, 'reject'));
  const response = await signup(valid);
  assert.equal(response.status, 201); assert.equal((await response.json()).ok, true);
  assert.equal(count(), 1); assert.equal(codes(), 1);
  const duplicate = await signup({ ...valid, username: 'other-user', email: ' CUSTOMER@EXAMPLE.INVALID ' });
  assert.equal(duplicate.status, 409); assert.ok((await duplicate.json()).errors.email);
  assert.equal(count(), 1);
  const concurrent = await Promise.all([
    signup({ ...valid, username: 'concurrent-a', email: 'race@example.invalid' }),
    signup({ ...valid, username: 'concurrent-b', email: 'RACE@example.invalid' })
  ]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
  assert.equal(count(), 2);
  assert.throws(() => db.prepare('UPDATE users SET email = ? WHERE username = ?').run('CUSTOMER@example.invalid', 'admin'), /email conflict/);
  db.exec("CREATE TRIGGER fail_registration_code BEFORE INSERT ON verification_codes BEGIN SELECT RAISE(ABORT, 'Simulated storage failure'); END;");
  const failed = await signup({ ...valid, username: 'storage-failed', email: 'storage@example.invalid' });
  assert.equal(failed.status, 500);
  assert.equal(count(), 2); assert.equal(codes(), 2);
});
