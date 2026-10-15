function createVonageVerify(env, fetchImpl = fetch) {
  const configured = Boolean(env.VONAGE_API_KEY && env.VONAGE_API_SECRET);
  async function request(path, body) {
    if (!configured) return null;
    try {
      const response = await fetchImpl(`https://api.nexmo.com/v2/verify/${path}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Basic ${Buffer.from(`${env.VONAGE_API_KEY}:${env.VONAGE_API_SECRET}`).toString('base64')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (response.ok) return data;
      const type = String(data.type || '').split('/').pop();
      const safeType = ['concurrent', 'unauthorized', 'forbidden', 'insufficient-credit', 'rate-limit'].includes(type) ? type : 'provider-rejected';
      console.warn(`Vonage Verify request rejected: HTTP ${response.status}, ${safeType}`);
      return { failed: true, errorType: safeType };
    } catch (_) { return null; }
  }
  return {
    configured,
    async start(phone) {
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { sent: false, reason: 'Enter a valid international phone number.' };
      const result = await request('', { brand: 'Vulithuba', code_length: 6, channel_timeout: 600, workflow: [{ channel: 'sms', to: phone.slice(1) }] });
      return result && /^[a-f0-9-]{36}$/i.test(result.request_id || '')
        ? { sent: true, provider: 'vonage', requestId: result.request_id }
        : { sent: false, reason: result?.errorType === 'concurrent' ? 'An SMS verification is already in progress for this number. Wait for the existing code to expire, then try Login again.' : 'Unable to send the SMS login code. Please wait a minute and try Login again.' };
    },
    async check(requestId, code) {
      if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || !/^\d{6}$/.test(code)) return { approved: false };
      const result = await request(encodeURIComponent(requestId), { code });
      return { approved: result?.status === 'completed' && result.request_id === requestId };
    }
  };
}
module.exports = { createVonageVerify };
