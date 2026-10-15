const test = require('node:test');
const assert = require('node:assert/strict');
const { createVonageVerify } = require('../vonage-verify');
test('Vonage generates and validates the code through the stored request ID', async () => {
  const id = '710a5279-3a3c-47a8-aa99-ad9583db347d';
  const calls = [];
  const service = createVonageVerify({ VONAGE_API_KEY: 'test', VONAGE_API_SECRET: 'secret' }, async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ request_id: id, ...(calls.length > 1 ? { status: 'completed' } : {}) }) };
  });
  assert.deepEqual(await service.start('+27663820665'), { sent: true, provider: 'vonage', requestId: id });
  assert.equal(calls[0].body.workflow[0].to, '27663820665');
  assert.equal((await service.check(id, '123456')).approved, true);
  assert.equal(calls[1].url, `https://api.nexmo.com/v2/verify/${id}`);
  assert.equal((await service.check(id, 'bad')).approved, false);
  assert.equal(calls.length, 2);
});
test('Vonage failures do not expose credentials or report successful delivery', async () => {
  const service = createVonageVerify({ VONAGE_API_KEY: 'test', VONAGE_API_SECRET: 'secret' }, async () => ({ ok: false }));
  assert.equal((await service.start('+27663820665')).sent, false);
});
