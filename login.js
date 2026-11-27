const form = document.querySelector('#login-form');
const statusNode = document.querySelector('#login-status');
const submitButton = form.querySelector('button[type="submit"]');

async function continueIfSignedIn() {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return;
    const { user } = await response.json();
    location.replace(user.role === 'admin' ? '/admin.html' : '/portal.html');
  } catch { /* The form remains available when the server is offline. */ }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusNode.className = 'status';
  statusNode.textContent = 'Checking your account…';
  submitButton.disabled = true;
  const formData = new FormData(form);
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password'),
        role: formData.get('role')
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to sign in. Check your details and try again.');
    form.elements.password.value = '';
    statusNode.className = 'status ok';
    statusNode.textContent = 'Signed in. Opening your workspace…';
    location.replace(data.user.role === 'admin' ? '/admin.html' : '/portal.html');
  } catch (error) {
    statusNode.textContent = error instanceof TypeError ? 'The sign-in server could not be reached.' : error.message;
  } finally {
    submitButton.disabled = false;
  }
});

continueIfSignedIn();
