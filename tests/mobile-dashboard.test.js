const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function dashboard(fetch) {
  const elements = new Map();
  const context = vm.createContext({
    fetch, AbortController, setTimeout, clearTimeout,
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { hidden: true, textContent: '', addEventListener() {} });
      return elements.get(id);
    } },
    window: { addEventListener() {} }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../mobile.js'), 'utf8'), context);
  return { load: () => context.loadDashboard(), element: (id) => elements.get(id) };
}

test('Guest Home offers login and signup without invented account data', async () => {
  const page = dashboard(async () => ({ status: 401 }));
  await page.load();
  assert.equal(page.element('guest-actions').hidden, false);
  assert.equal(page.element('customer-overview').hidden, true);
  assert.equal(page.element('staff-link').hidden, true);
});

test('Customer Home uses real plan/billing fields and hides staff access', async () => {
  const page = dashboard(async () => ({ ok: true, status: 200, json: async () => ({ user: {
    fullName: '<img src=x onerror=alert(1)>', plan: 'Family Plus',
    billingStatus: 'pending', billingMethod: 'EFT', isAdmin: false
  } }) }));
  await page.load();
  assert.equal(page.element('customer-plan').textContent, 'Family Plus');
  assert.equal(page.element('billing-status').textContent, 'pending');
  assert.equal(page.element('billing-method').textContent, 'EFT');
  assert.equal(page.element('customer-overview').hidden, false);
  assert.equal(page.element('staff-link').hidden, true);
  assert.equal(page.element('greeting').textContent, 'Welcome back, <img src=x onerror=alert(1)>.');
  assert.equal(page.element('greeting').innerHTML, undefined);
});

test('Staff Home shows its dashboard only after the API grants admin access', async () => {
  const page = dashboard(async () => ({ ok: true, status: 200, json: async () => ({ user: {
    username: 'admin', isAdmin: true
  } }) }));
  await page.load();
  assert.equal(page.element('staff-link').hidden, false);
});

test('A failed account request offers retry and hides stale private data', async () => {
  let offline = false;
  const page = dashboard(async () => {
    if (offline) throw new Error('Offline');
    return { ok: true, status: 200, json: async () => ({ user: { username: 'customer', plan: 'Fibre Lite' } }) };
  });
  await page.load();
  offline = true;
  await page.load();
  assert.equal(page.element('retry').hidden, false);
  assert.equal(page.element('customer-overview').hidden, true);
  assert.equal(page.element('staff-link').hidden, true);
});
