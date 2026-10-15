'use strict';

function createSmsPortalSender(env, fetchImpl = fetch) {
  const clientId = String(env.SMSPORTAL_CLIENT_ID || '').trim();
  const secret = String(env.SMSPORTAL_API_SECRET || '').trim();
  const configured = Boolean(clientId && secret);
  return {
    configured,
    async send(message, recipient) {
      if (!configured) return { sent: false, reason: 'SMSPortal credentials are missing.' };
      if (!/^\+[1-9]\d{7,14}$/.test(String(recipient || ''))) return { sent: false, reason: 'Enter a valid international phone number.' };
      try {
        const response = await fetchImpl('https://rest.smsportal.com/v3/BulkMessages', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ messages: [{ destination: recipient, content: message }] })
        });
        if (!response.ok) {
          console.warn(`SMSPortal request rejected: HTTP ${response.status}`);
          return { sent: false, reason: 'SMSPortal could not accept the SMS. Check API access and account credit.' };
        }
        const result = await response.json();
        if (result.sendResponse?.messages !== 1 || !result.sendResponse.eventId || (result.errors && (!Array.isArray(result.errors) || result.errors.length))) {
          return { sent: false, reason: 'SMSPortal did not accept the SMS for delivery.' };
        }
        // Queue acceptance does not confirm delivery to the handset.
        return { sent: true };
      } catch (_) { return { sent: false, reason: 'Unable to connect to SMSPortal. Please try again.' }; }
    }
  };
}
module.exports = { createSmsPortalSender };
