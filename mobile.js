'use strict';
const element = (id) => document.getElementById(id);
const plans = {
  'Fibre Lite': '50 Mbps · R399 / month',
  'Family Plus': '200 Mbps · R699 / month',
  'Office Pro': '500 Mbps · R1,299 / month'
};

async function loadDashboard() {
  element('retry').hidden = true;
  element('account-notice').textContent = 'Checking your account…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/me', { credentials: 'include', signal: controller.signal });
    if (response.status === 401) {
      element('greeting').innerHTML = 'Your connection.<br>Your way.';
      element('intro').textContent = 'Welcome to Vulithuba. Find your next plan or manage the connection you already love.';
      element('guest-actions').hidden = false;
      element('customer-action').hidden = true;
      element('customer-overview').hidden = true;
      element('staff-link').hidden = true;
      element('account-notice').textContent = 'Log in to see your plan and billing details.';
      return;
    }
    if (!response.ok) throw new Error('Unable to load your account.');
    const { user } = await response.json();
    if (!user) throw new Error('Unable to load your account.');
    const name = user.fullName || user.username;
    element('greeting').textContent = `Welcome back, ${name}.`;
    element('intro').textContent = 'Your plan, your account, and a little help when you need it. All in one place.';
    element('guest-actions').hidden = true;
    element('customer-action').hidden = false;
    element('customer-overview').hidden = false;
    element('customer-plan').textContent = user.plan || 'No plan selected';
    element('plan-detail').textContent = plans[user.plan] || 'Manage your connection from your account.';
    element('billing-status').textContent = user.billingStatus || 'Not available';
    element('billing-method').textContent = user.billingMethod || 'Not selected';
    element('staff-link').hidden = !user.isAdmin;
    element('account-notice').textContent = 'Your account details are up to date.';
  } catch (_) {
    element('customer-overview').hidden = true;
    element('customer-action').hidden = true;
    element('staff-link').hidden = true;
    element('guest-actions').hidden = false;
    element('greeting').textContent = 'Your connection. Your way.';
    element('intro').textContent = 'Find your next plan or get help from our team.';
    element('account-notice').textContent = 'We could not load your account. Try again when you are connected.';
    element('retry').hidden = false;
  } finally {
    clearTimeout(timeout);
  }
}
element('retry').addEventListener('click', loadDashboard);
window.addEventListener('pageshow', loadDashboard);
