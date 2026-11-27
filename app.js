const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.main-nav');
const form = document.querySelector('#enquiry-form');
const status = document.querySelector('#form-status');

const year = document.querySelector('#year');
if (year) year.textContent = new Date().getFullYear();

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  navigation.classList.toggle('is-open', open);
});

navigation?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    navigation.classList.remove('is-open');
  });
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  status.className = 'form-status';
  if (!form.reportValidity()) return;

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.innerHTML = 'Sending… <span aria-hidden="true">↗</span>';

  try {
    const response = await fetch('/api/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'We could not send your enquiry. Please try again.');
    form.reset();
    status.textContent = 'Thank you. Your enquiry has been received and the team will follow up.';
    status.classList.add('is-success');
  } catch (error) {
    status.textContent = error.message === 'Failed to fetch'
      ? 'The enquiry service is unavailable at the moment. Please try again later.'
      : error.message;
    status.classList.add('is-error');
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Send project enquiry <span aria-hidden="true">↗</span>';
  }
});

