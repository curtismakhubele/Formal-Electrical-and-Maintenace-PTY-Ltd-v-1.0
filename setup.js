const form = document.querySelector('#setup-form');
const statusNode = document.querySelector('#setup-status');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  button.disabled = true;
  statusNode.textContent = 'Creating the administrator account…';
  try {
    const response = await fetch('/api/auth/setup', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken: data.get('setupToken'), email: data.get('email'), password: data.get('password') })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Setup could not be completed.');
    form.reset();
    statusNode.textContent = 'Admin account created. Remove ADMIN_SETUP_TOKEN from Azure settings, then sign in.';
  } catch (error) {
    statusNode.textContent = error instanceof TypeError ? 'The server could not be reached.' : error.message;
  } finally { button.disabled = false; }
});
