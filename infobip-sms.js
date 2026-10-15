'use strict';

function createInfobipSender(env, fetchImpl = fetch) {
  const configured = Boolean(env.INFOBIP_BASE_URL && env.INFOBIP_API_KEY && env.INFOBIP_SENDER);

  async function send(message, recipient) {
    if (!configured) return { sent: false, reason: 'Add INFOBIP_BASE_URL, INFOBIP_API_KEY and INFOBIP_SENDER to configure SMS.' };
    const phone = String(recipient || '').trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      return { sent: false, reason: 'Use an international phone number, for example +27821234567.' };
    }
    let base;
    try {
      base = new URL(env.INFOBIP_BASE_URL);
      if (base.protocol !== 'https:' || !base.hostname.endsWith('.infobip.com') ||
          base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
          (base.port && base.port !== '443')) throw new Error('Invalid URL');
    } catch (_) {
      return { sent: false, reason: 'INFOBIP_BASE_URL must be your Infobip HTTPS API origin.' };
    }
    try {
      const response = await fetchImpl(new URL('/sms/3/messages', base), {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `App ${String(env.INFOBIP_API_KEY).trim()}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ messages: [{
          sender: env.INFOBIP_SENDER,
          destinations: [{ to: phone.slice(1) }],
          content: { text: message }
        }] }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        return { sent: false, reason: `Infobip SMS request failed (HTTP ${response.status}). Check the API key, permissions and sender configuration.` };
      }
      const result = await response.json();
      const sent = result.messages?.length === 1 && Boolean(result.messages[0].messageId) &&
        [1, 3].includes(result.messages[0].status?.groupId);
      return sent
        ? { sent: true }
        : { sent: false, reason: 'Infobip did not accept the SMS. Check the sender, recipient and account balance.' };
    } catch (_) {
      return { sent: false, reason: 'Unable to connect to Infobip. Please try again.' };
    }
  }

  return { configured, send };
}

module.exports = { createInfobipSender };
