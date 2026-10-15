const test = require('node:test');
const assert = require('node:assert/strict');
const { createInfobipSender } = require('../infobip-sms');

const settings = {
  INFOBIP_BASE_URL: 'https://example.api.infobip.com',
  INFOBIP_API_KEY: 'disposable-test-key',
  INFOBIP_SENDER: 'ServiceSMS'
};

test('Infobip sends the code to the intended international recipient', async () => {
  const sender = createInfobipSender(settings, async (url, request) => {
    assert.equal(url.toString(), 'https://example.api.infobip.com/sms/3/messages');
    assert.equal(request.headers.Authorization, 'App disposable-test-key');
    assert.equal(request.redirect, 'error');
    assert.deepEqual(JSON.parse(request.body).messages, [{
      sender: 'ServiceSMS', destinations: [{ to: '27821234567' }],
      content: { text: 'Verification code: 123456' }
    }]);
    return { ok: true, json: async () => ({ messages: [{ messageId: 'test-id', status: { groupId: 1 } }] }) };
  });
  assert.deepEqual(await sender.send('Verification code: 123456', '+27821234567'), { sent: true });
});

test('Missing settings, invalid API origins and local phone numbers do not send requests', async () => {
  const unexpected = () => { throw new Error('A request must not be sent'); };
  assert.equal((await createInfobipSender({}, unexpected).send('code', '+27821234567')).sent, false);
  for (const base of ['http://example.api.infobip.com', 'https://other.example', 'https://example.api.infobip.com/path']) {
    const result = await createInfobipSender({ ...settings, INFOBIP_BASE_URL: base }, unexpected).send('code', '+27821234567');
    assert.match(result.reason, /HTTPS API origin/);
  }
  assert.match((await createInfobipSender(settings, unexpected).send('code', '0821234567')).reason, /international/);
});

test('Provider rejection, invalid responses and network failures never count as a sent code', async () => {
  const responses = [
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: true, json: async () => ({ messages: [{ messageId: 'test-id', status: { groupId: 5 } }] }) }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => { throw new Error('network error containing sensitive data'); }
  ];
  for (const mock of responses) {
    const result = await createInfobipSender(settings, mock).send('code', '+27821234567');
    assert.equal(result.sent, false);
    assert.doesNotMatch(result.reason, /sensitive data/);
  }
});
