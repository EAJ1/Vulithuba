'use strict';

function createBulkSmsSender(env, fetchImpl = fetch) {
  const tokenId = String(env.BULKSMS_TOKEN_ID || '').trim();
  const tokenSecret = String(env.BULKSMS_TOKEN_SECRET || '').trim();
  const configured = Boolean(tokenId && tokenSecret);

  async function send(message, recipient) {
    if (!configured) return { sent: false, reason: 'Add BULKSMS_TOKEN_ID and BULKSMS_TOKEN_SECRET to configure SMS.' };
    const phone = String(recipient || '').trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      return { sent: false, reason: 'Use an international phone number, for example +27821234567.' };
    }
    try {
      const response = await fetchImpl('https://api.bulksms.com/v1/messages', {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ to: phone, body: message }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        return { sent: false, reason: `BulkSMS request failed (HTTP ${response.status}). Check the API token, account credit and recipient.` };
      }
      const messages = await response.json();
      const sent = Array.isArray(messages) && messages.length === 1 && Boolean(messages[0].id) &&
        ['ACCEPTED', 'SENT', 'DELIVERED'].includes(messages[0].status?.type);
      if (sent && messages[0].status.type === 'ACCEPTED') {
        // Queue acceptance can be followed immediately by a NOT_SENT failure.
        // Check briefly so registration can fall back to email on rejection.
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) await new Promise(resolve => setTimeout(resolve, 300));
          try {
            const statusResponse = await fetchImpl(`https://api.bulksms.com/v1/messages/${encodeURIComponent(messages[0].id)}`, {
              headers: { Authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`, Accept: 'application/json' },
              redirect: 'error', signal: AbortSignal.timeout(3000)
            });
            if (!statusResponse.ok) break;
            const current = await statusResponse.json();
            if (current.status?.type === 'FAILED') {
              return { sent: false, reason: current.status.subtype === 'NOT_SENT'
                ? 'BulkSMS did not send the verification message (NOT_SENT). Contact BulkSMS support to check the route and account messaging restrictions.'
                : 'BulkSMS reported that the SMS failed. Please try email verification.' };
            }
            if (['SENT', 'DELIVERED'].includes(current.status?.type)) break;
          } catch (_) {
            // Do not retry submission when delivery lookup is unavailable.
            break;
          }
        }
      }
      return sent
        ? { sent: true }
        : { sent: false, reason: 'BulkSMS did not accept the SMS. Check the recipient and account configuration.' };
    } catch (_) {
      return { sent: false, reason: 'Unable to connect to BulkSMS. Please try again.' };
    }
  }

  return { configured, send };
}

module.exports = { createBulkSmsSender };
