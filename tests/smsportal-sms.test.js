const test = require('node:test');
const assert = require('node:assert/strict');
const { createSmsPortalSender } = require('../smsportal-sms');
const settings = { SMSPORTAL_CLIENT_ID: 'test-client', SMSPORTAL_API_SECRET: 'test-secret' };
test('SMSPortal sends one verification SMS to the intended recipient', async () => {
  const sender = createSmsPortalSender(settings, async (url, request) => {
    assert.equal(url, 'https://rest.smsportal.com/v3/BulkMessages');
    assert.deepEqual(JSON.parse(request.body), { messages: [{ destination: '+27821234567', content: 'Code 123456' }] });
    assert.equal(request.headers.Authorization, `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
    assert.equal(request.redirect, 'error');
    return { ok: true, json: async () => ({ statusCode: 200, sendResponse: { eventId: 123, messages: 1 }, errors: [] }) };
  });
  assert.deepEqual(await sender.send('Code 123456', '+27821234567'), { sent: true });
});
test('SMSPortal rejects missing credentials, invalid numbers, provider failures and malformed responses', async () => {
  const unexpected = () => { throw new Error('Unexpected request'); };
  assert.equal((await createSmsPortalSender({}, unexpected).send('code', '+27821234567')).sent, false);
  assert.equal((await createSmsPortalSender(settings, unexpected).send('code', '0821234567')).sent, false);
  for (const response of [{ ok: false, status: 401 }, { ok: true, json: async () => ({ sendResponse: { messages: 0 }, errors: [] }) }, { ok: true, json: async () => ({ sendResponse: { messages: 1, eventId: 1 }, errors: [{}] }) }]) {
    assert.equal((await createSmsPortalSender(settings, async () => response).send('code', '+27821234567')).sent, false);
  }
  assert.equal((await createSmsPortalSender(settings, unexpected).send('code', '+27821234567')).sent, false);
});
