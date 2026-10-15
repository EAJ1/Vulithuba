'use strict';

function createClickSendSender(env, fetchImpl = fetch) {
  const clientId = String(env.CLICKSEND_USERNAME || '').trim();
  const secret = String(env.CLICKSEND_API_KEY || '').trim();
  const configured = Boolean(clientId && secret);
  return {
    configured,
    async send(message, recipient) {
      if (!configured) return { sent: false, reason: 'ClickSend credentials are missing.' };
      if (!/^\+[1-9]\d{7,14}$/.test(String(recipient || ''))) return { sent: false, reason: 'Enter a valid international phone number.' };
      try {
        const response = await fetchImpl('https://rest.clicksend.com/v3/sms/send', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ messages: [{ to: recipient, body: message, source: 'Vulithuba' }] })
        });
        if (!response.ok) {
          console.warn(`ClickSend request rejected: HTTP ${response.status}`);
          return { sent: false, reason: 'ClickSend could not accept the SMS. Check API access and account credit.' };
        }
        const result = await response.json();
        if (result.response_code !== 'SUCCESS' || !Array.isArray(result.data?.messages) || result.data.messages.length !== 1 || result.data.messages[0].status !== 'SUCCESS' || !result.data.messages[0].message_id) {
          return { sent: false, reason: 'ClickSend did not accept the SMS for delivery.' };
        }
        // Queue acceptance does not confirm delivery to the handset.
        return { sent: true };
      } catch (_) { return { sent: false, reason: 'Unable to connect to ClickSend. Please try again.' }; }
    }
  };
}
module.exports = { createClickSendSender };
