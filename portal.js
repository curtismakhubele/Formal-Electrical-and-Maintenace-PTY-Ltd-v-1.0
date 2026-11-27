const statusNode = document.querySelector('#portal-status');
const userNode = document.querySelector('#portal-user');

async function loadPortal() {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) { location.replace('/login.html?role=assigned'); return; }
    const { user } = await response.json();
    if (user.role === 'admin') { location.replace('/admin.html'); return; }
    userNode.textContent = user.email;
  } catch {
    statusNode.textContent = 'The sign-in server could not be reached.';
    userNode.textContent = 'Account unavailable';
  }
}

document.querySelector('#sign-out').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally { location.replace('/login.html'); }
});

loadPortal();
