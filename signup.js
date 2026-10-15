'use strict';

if (window.location.protocol === 'file:') {
  window.location.replace(`http://127.0.0.1:3000/signup.html${window.location.search}`);
}
const form = document.getElementById('signupForm');
const errorBox = document.getElementById('errorBox');
const successBox = document.getElementById('successBox');
const signupButton = document.getElementById('signupButton');
const apiBase = window.location.origin;
const selectedPlan = new URLSearchParams(window.location.search).get('plan');
if (RegistrationValidation.plans.includes(selectedPlan)) document.getElementById('plan').value = selectedPlan;
let submitting = false;

function showErrors(errors, message) {
  for (const field of RegistrationValidation.fields) {
    const input = document.getElementById(field);
    const feedback = document.getElementById(`${field}Error`);
    feedback.textContent = errors[field] || '';
    feedback.hidden = !errors[field];
    if (errors[field]) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  errorBox.textContent = message || (Object.keys(errors).length ? 'Please correct the highlighted fields.' : '');
  errorBox.classList.toggle('show', Boolean(errorBox.textContent));
  const first = RegistrationValidation.fields.find(field => errors[field]);
  if (first) document.getElementById(first).focus();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  successBox.classList.remove('show');
  const body = Object.fromEntries(RegistrationValidation.fields.map(field => [field, document.getElementById(field).value]));
  body.phone = RegistrationValidation.phoneNumber(body.phone, document.getElementById('countryCode').value);
  const { values, errors } = RegistrationValidation.validate(body);
  showErrors(errors);
  if (Object.keys(errors).length) return;

  submitting = true;
  signupButton.disabled = true;
  signupButton.textContent = 'Creating account...';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${apiBase}/api/signup`, {
      method: 'POST', credentials: 'include', signal: controller.signal,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      showErrors(result.errors || {}, result.error || 'Registration failed. Your details are still in the form.');
      return;
    }
    successBox.textContent = result.message || 'Account created successfully.';
    successBox.classList.add('show');
    // Keep the entered values even after success until navigation completes.
    setTimeout(() => {
      const destination = result.requiresVerification
        ? `/verify-account.html?username=${encodeURIComponent(values.username)}&channel=${encodeURIComponent(result.channel || values.verificationMethod)}`
        : '/login.html';
      window.location.href = apiBase + destination;
    }, 1200);
  } catch (_) {
    showErrors({}, 'Unable to confirm registration. Your details are still in the form. Check your connection before retrying.');
  } finally {
    clearTimeout(timeout);
    if (!successBox.classList.contains('show')) {
      submitting = false;
      signupButton.disabled = false;
      signupButton.textContent = 'Sign up';
    }
  }
});
