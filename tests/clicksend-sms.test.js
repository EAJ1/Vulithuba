const test = require('node:test');
const assert = require('node:assert/strict');
const { createClickSendSender } = require('../clicksend-sms');
const settings = { CLICKSEND_USERNAME: 'test-client', CLICKSEND_API_KEY: 'test-secret' };
test('ClickSend sends one verification SMS to the intended recipient', async () => {
  const sender = createClickSendSender(settings, async (url, request) => {
    assert.equal(url, 'https://rest.clicksend.com/v3/sms/send');
    assert.deepEqual(JSON.parse(request.body), { messages: [{ to: '+27821234567', body: 'Code 123456', source: 'Vulithuba' }] });
    assert.equal(request.headers.Authorization, `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
    assert.equal(request.redirect, 'error');
    return { ok: true, json: async () => ({ response_code: 'SUCCESS', data: { messages: [{status:'SUCCESS',message_id:'test-id'}] } }) };
  });
  assert.deepEqual(await sender.send('Code 123456', '+27821234567'), { sent: true });
});
test('ClickSend rejects missing credentials, invalid numbers, provider failures and malformed responses', async () => {
  const unexpected = () => { throw new Error('Unexpected request'); };
  assert.equal((await createClickSendSender({}, unexpected).send('code', '+27821234567')).sent, false);
  assert.equal((await createClickSendSender(settings, unexpected).send('code', '0821234567')).sent, false);
  for (const response of [{ ok: false, status: 401 }, { ok: true, json: async () => ({ sendResponse: { messages: 0 }, errors: [] }) }, { ok: true, json: async () => ({response_code:'SUCCESS',data:{messages:[{status:'COUNTRY_NOT_ENABLED',message_id:'test'}]}}) }]) {
    assert.equal((await createClickSendSender(settings, async () => response).send('code', '+27821234567')).sent, false);
  }
  assert.equal((await createClickSendSender(settings, unexpected).send('code', '+27821234567')).sent, false);
});
