const apiBase = window.location.protocol === 'file:' ? 'http://127.0.0.1:3000' : window.location.origin;
const fallbackApiBase = 'http://127.0.0.1:3000';
const navToggle = document.querySelector('.nav-toggle');
const mainNav = document.querySelector('.main-nav');
const yearEl = document.getElementById('year');
const contactForm = document.querySelector('.contact-form');

if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}

if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => {
    mainNav.classList.toggle('is-open');
  });

  mainNav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => mainNav.classList.remove('is-open'));
  });
}

if (contactForm) {
  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const nameInput = contactForm.querySelector('#name');
    const emailInput = contactForm.querySelector('#email');
    const phoneInput = contactForm.querySelector('#phone');
    const countryCode = contactForm.querySelector('#countryCode');
    const honeypot = contactForm.querySelector('#company');
    const button = contactForm.querySelector('button');

    if (honeypot && honeypot.value.trim() !== '') {
      return;
    }

    if (!nameInput || !emailInput || !phoneInput || !button) {
      return;
    }

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const phone = `${countryCode ? countryCode.value : ''}${phoneInput.value.trim().replace(/^0+/, '')}`;
    const company = contactForm.querySelector('#company')?.value.trim() || '';

    if (name.length < 2 || phone.length < 7 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nameInput.setCustomValidity(name.length < 2 ? 'Please enter your full name.' : '');
      emailInput.setCustomValidity(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Please enter a valid email.' : '');
      nameInput.reportValidity();
      emailInput.reportValidity();
      return;
    }

    nameInput.setCustomValidity('');
    emailInput.setCustomValidity('');

    const originalText = button.textContent;
    button.textContent = 'Sending...';
    button.disabled = true;

    try {
      if (window.location.protocol === 'file:') {
        let pendingLeads = [];
        try {
          pendingLeads = JSON.parse(localStorage.getItem('vulithuba_pending_leads') || '[]');
          if (!Array.isArray(pendingLeads)) pendingLeads = [];
          pendingLeads.push({ name, email, phone, company, createdAt: new Date().toISOString() });
          localStorage.setItem('vulithuba_pending_leads', JSON.stringify(pendingLeads));
        } catch (storageError) {
          throw new Error('This browser blocks local storage. Open the site through the local server.');
        }
        button.textContent = 'Request saved';
        contactForm.reset();
        return;
      }

      let requestBase = apiBase;
      let response = await fetch(`${requestBase}/api/contact`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name,
          email,
          phone,
          company
        })
      });
      if (response.status === 404 && requestBase !== fallbackApiBase) {
        requestBase = fallbackApiBase;
        response = await fetch(`${requestBase}/api/contact`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name,
            email,
            phone,
            company
          })
        });
      }

      const text = await response.text();
      let result = {};
      try { result = text ? JSON.parse(text) : {}; } catch (error) { result = { error: 'Could not send request.' }; }

      if (!response.ok || result.ok === false) {
        throw new Error(result.error || 'Could not send request.');
      }

      button.textContent = 'Request sent';
      contactForm.reset();
    } catch (error) {
      if (error instanceof TypeError || error.message === 'Failed to fetch') {
        let pendingLeads = [];
        try {
          pendingLeads = JSON.parse(localStorage.getItem('vulithuba_pending_leads') || '[]');
          if (!Array.isArray(pendingLeads)) pendingLeads = [];
          pendingLeads.push({ name, email, phone, company, createdAt: new Date().toISOString() });
          localStorage.setItem('vulithuba_pending_leads', JSON.stringify(pendingLeads));
        } catch (storageError) {
          button.textContent = 'Try again';
          alert('The request could not be saved in this browser. Please open the site through the local server.');
          return;
        }
        button.textContent = 'Request saved';
        contactForm.reset();
        return;
      }
      button.textContent = 'Try again';
      alert(error.message || 'Something went wrong.');
    } finally {
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 2200);
    }
  });
}
