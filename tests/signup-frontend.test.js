const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const validation = require('../registration-validation');

function page(fetchImpl) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: '', textContent: '', hidden: false, disabled: false, attributes: {}, listeners: {},
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
          toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
        setAttribute(key, value) { this.attributes[key] = value; },
        removeAttribute(key) { delete this.attributes[key]; },
        addEventListener(name, listener) { this.listeners[name] = listener; },
        focus() { this.focused = true; },
        reset() { throw new Error('Registration must preserve the form'); }
      });
    }
    return elements.get(id);
  }
  const requests = [];
  const context = vm.createContext({ RegistrationValidation: validation, URLSearchParams, AbortController,
    document: { getElementById: element }, window: { location: { protocol: 'http:', origin: 'http://test.local', search: '' } },
    setTimeout() { return 1; }, clearTimeout() {},
    fetch: async (...args) => { requests.push(args); return fetchImpl(...args); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../signup.js'), 'utf8'), context);
  const values = { fullName: 'Test Customer', phone: '+27663820665', countryCode: '+27', username: 'test-customer',
    email: 'customer@example.invalid', password: 'Test-password-123', confirmPassword: 'Test-password-123',
    address: '12 Example Road', plan: 'Fibre Lite', billingMethod: 'EFT', verificationMethod: 'sms' };
  return { element, requests, fill() { for (const [id, value] of Object.entries(values)) element(id).value = value; },
    submit: () => element('signupForm').listeners.submit({ preventDefault() {} }) };
}

test('Frontend typing never submits; invalid fields send no request and retain every value', async () => {
  const form = page(() => { throw new Error('Invalid forms must not submit'); });
  form.fill();
  assert.equal(form.requests.length, 0);
  assert.equal(form.element('signupForm').listeners.input, undefined);
  form.element('phone').value = '';
  form.element('confirmPassword').value = 'wrong';
  await form.submit();
  assert.equal(form.requests.length, 0);
  assert.match(form.element('phoneError').textContent, /phone number/);
  assert.match(form.element('confirmPasswordError').textContent, /match/);
  assert.equal(form.element('phone').attributes['aria-invalid'], 'true');
  assert.equal(form.element('email').value, 'customer@example.invalid');
  assert.equal(form.element('confirmPassword').value, 'wrong');
  assert.equal(form.element('successBox').classList.contains('show'), false);
});

test('Backend duplicate errors and network failures retain the form without showing success', async () => {
  for (const failure of [
    async () => ({ ok: false, json: async () => ({ ok: false, error: 'Email already exists.', errors: { email: 'Use another email address.' } }) }),
    async () => { throw new Error('offline'); }
  ]) {
    const form = page(failure); form.fill(); await form.submit();
    assert.equal(form.element('email').value, 'customer@example.invalid');
    assert.equal(form.element('password').value, 'Test-password-123');
    assert.equal(form.element('successBox').classList.contains('show'), false);
    assert.equal(form.element('errorBox').classList.contains('show'), true);
    assert.equal(form.element('signupButton').disabled, false);
  }
});

test('Frontend blocks double submission and shows success only after confirmed creation', async () => {
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const form = page(() => response); form.fill();
  const first = form.submit(); await form.submit();
  assert.equal(form.requests.length, 1);
  assert.equal(form.element('successBox').classList.contains('show'), false);
  assert.equal(JSON.parse(form.requests[0][1].body).phone, '+27663820665');
  resolve({ ok: true, json: async () => ({ ok: true, requiresVerification: true, message: 'Account created successfully.' }) });
  await first;
  assert.equal(form.element('successBox').classList.contains('show'), true);
  assert.equal(form.element('signupButton').disabled, true);
});
