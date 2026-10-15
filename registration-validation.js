(function (root) {
  'use strict';
  const fields = ['fullName', 'phone', 'username', 'email', 'password', 'confirmPassword', 'address', 'plan', 'billingMethod', 'verificationMethod'];
  const plans = ['Fibre Lite', 'Family Plus', 'Office Pro'];
  const billingMethods = ['EFT', 'Debit order', 'Card'];

  function phoneNumber(raw, countryCode = '') {
    const value = typeof raw === 'string' ? raw.trim().replace(/[\s().-]/g, '') : '';
    if (!value) return '';
    if (value.startsWith('+') || !countryCode) return value;
    return countryCode + value.replace(/^0/, '');
  }

  function validate(body) {
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const values = {};
    const errors = {};
    for (const field of fields) {
      values[field] = typeof input[field] === 'string' ? input[field] : '';
      if (!['password', 'confirmPassword'].includes(field)) values[field] = values[field].trim();
    }
    values.email = values.email.toLowerCase();
    values.phone = phoneNumber(values.phone);
    if (values.fullName.length < 2 || values.fullName.length > 100 || !/\p{L}/u.test(values.fullName) || /[\x00-\x1f]/.test(values.fullName)) {
      errors.fullName = 'Enter your full name (2–100 characters).';
    }
    if (!/^\+[1-9]\d{7,14}$/.test(values.phone) || (values.phone.startsWith('+27') && !/^\+27[1-8]\d{8}$/.test(values.phone))) {
      errors.phone = 'Enter a valid international phone number, for example +27663820665.';
    }
    if (!/^[A-Za-z0-9_.-]{3,50}$/.test(values.username)) {
      errors.username = 'Use 3–50 letters, numbers, dots, hyphens or underscores for your username.';
    }
    if (values.email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(values.email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (values.password.length < 6 || values.password.length > 128 || !values.password.trim()) {
      errors.password = 'Use a password containing 6–128 characters.';
    }
    if (!values.confirmPassword) errors.confirmPassword = 'Confirm your password.';
    else if (values.password !== values.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    if (values.address.length < 5 || values.address.length > 300 || !/\p{L}/u.test(values.address) || /[\x00-\x1f]/.test(values.address)) {
      errors.address = 'Enter your installation address (5–300 characters).';
    }
    if (!plans.includes(values.plan)) errors.plan = 'Choose a valid plan.';
    if (!billingMethods.includes(values.billingMethod)) errors.billingMethod = 'Choose a payment method.';
    if (!['email', 'sms'].includes(values.verificationMethod)) errors.verificationMethod = 'Choose email or SMS verification.';
    return { values, errors };
  }

  const api = { fields, plans, billingMethods, phoneNumber, validate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegistrationValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
