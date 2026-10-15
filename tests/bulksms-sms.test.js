const test = require('node:test');
const assert = require('node:assert/strict');
const { createBulkSmsSender } = require('../bulksms-sms');
const settings = { BULKSMS_TOKEN_ID: 'test-id', BULKSMS_TOKEN_SECRET: 'test-secret' };

test('BulkSMS authenticates using the API token and sends only to the intended number', async () => {
  const sender = createBulkSmsSender(settings, async (url, request) => {
    assert.equal(url, 'https://api.bulksms.com/v1/messages');
    assert.equal(request.headers.Authorization, `Basic ${Buffer.from('test-id:test-secret').toString('base64')}`);
    assert.equal(request.redirect, 'error');
    assert.deepEqual(JSON.parse(request.body), { to: '+27821234567', body: 'Code: 123456' });
    return { ok: true, json: async () => [{ id: 'message-id', status: { type: 'SENT' } }] };
  });
  assert.deepEqual(await sender.send('Code: 123456', '+27821234567'), { sent: true });
});

test('An accepted message that immediately fails does not count as sent', async () => {
  let submissions = 0;
  const sender = createBulkSmsSender(settings, async (url, request) => {
    if (request.method === 'POST') {
      submissions++;
      return { ok: true, json: async () => [{ id: 'message-id', status: { type: 'ACCEPTED' } }] };
    }
    assert.equal(url, 'https://api.bulksms.com/v1/messages/message-id');
    return { ok: true, json: async () => ({ status: { type: 'FAILED', subtype: 'NOT_SENT' } }) };
  });
  const result = await sender.send('Code: 123456', '+27821234567');
  assert.equal(result.sent, false);
  assert.match(result.reason, /NOT_SENT/);
  assert.equal(submissions, 1);
});

test('BulkSMS does not send with missing tokens or an invalid international number', async () => {
  const unexpected = () => { throw new Error('No request expected'); };
  assert.equal((await createBulkSmsSender({}, unexpected).send('code', '+27821234567')).sent, false);
  assert.equal((await createBulkSmsSender(settings, unexpected).send('code', '0821234567')).sent, false);
});

test('BulkSMS rejection and network errors are failures without exposing provider data', async () => {
  for (const mock of [
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: false, status: 402 }),
    async () => ({ ok: true, json: async () => [{ id: 'message-id', status: { type: 'FAILED' } }] }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => { throw new Error('sensitive provider data'); }
  ]) {
    const result = await createBulkSmsSender(settings, mock).send('code', '+27821234567');
    assert.equal(result.sent, false);
    assert.doesNotMatch(result.reason, /sensitive provider data/);
  }
});
