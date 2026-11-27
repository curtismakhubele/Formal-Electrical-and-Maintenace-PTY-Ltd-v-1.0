const sessionCheck = document.querySelector('#session-check');
const dashboard = document.querySelector('#dashboard-view');
const dashboardStatus = document.querySelector('#dashboard-status');
const list = document.querySelector('#enquiry-list');
const count = document.querySelector('#enquiry-count');

function setStatus(node, message, error = false) {
  node.textContent = message;
  node.className = `form-status${error ? ' is-error' : ''}`;
}

async function loadEnquiries() {
  setStatus(dashboardStatus, '');
  count.textContent = 'Loading enquiries…';
  try {
    const response = await fetch('/api/admin/enquiries', { cache: 'no-store', credentials: 'same-origin' });
    const data = await response.json();
    if (response.status === 401 || response.status === 403) {
      location.replace('/login.html?role=admin');
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Could not load enquiries.');
    list.replaceChildren();
    count.textContent = `${data.enquiries.length} ${data.enquiries.length === 1 ? 'enquiry' : 'enquiries'}`;
    if (data.enquiries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No enquiries have been received yet.';
      list.append(empty);
      return;
    }
    data.enquiries.forEach((record) => {
      const card = document.createElement('article');
      card.className = 'enquiry-card';
      const head = document.createElement('div');
      head.className = 'enquiry-card-head';
      const identity = document.createElement('div');
      const name = document.createElement('h2');
      name.textContent = record.name;
      const date = document.createElement('time');
      date.dateTime = record.receivedAt;
      date.textContent = new Date(record.receivedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
      identity.append(name, date);
      const badge = document.createElement('span');
      badge.className = 'enquiry-badge';
      badge.textContent = record.service;
      head.append(identity, badge);
      const meta = document.createElement('p');
      meta.className = 'enquiry-contact';
      meta.textContent = [record.email, record.phone, record.location].filter(Boolean).join(' · ');
      const message = document.createElement('p');
      message.className = 'enquiry-message';
      message.textContent = record.message;
      card.append(head, meta, message);
      list.append(card);
    });
  } catch (error) {
    count.textContent = 'Enquiries unavailable';
    setStatus(dashboardStatus, error.message || 'The server could not be reached.', true);
  }
}

async function signOut() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally { location.replace('/login.html'); }
}

document.querySelector('#refresh').addEventListener('click', loadEnquiries);
document.querySelector('#sign-out').addEventListener('click', signOut);

const createUserForm = document.querySelector('#create-user-form');
const createUserStatus = document.querySelector('#create-user-status');
createUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = createUserForm.querySelector('button[type="submit"]');
  button.disabled = true;
  createUserStatus.className = '';
  createUserStatus.textContent = 'Creating assigned-user account…';
  const formData = new FormData(createUserForm);
  try {
    const response = await fetch('/api/admin/users', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') })
    });
    const data = await response.json();
    if (response.status === 401 || response.status === 403) { location.replace('/login.html?role=admin'); return; }
    if (!response.ok) throw new Error(data.error || 'Account could not be created.');
    createUserForm.reset();
    createUserStatus.className = 'success';
    createUserStatus.textContent = `Assigned-user login created for ${data.user.email}. Share the password privately.`;
  } catch (error) {
    createUserStatus.className = 'error';
    createUserStatus.textContent = error instanceof TypeError ? 'The server could not be reached.' : error.message;
  } finally { button.disabled = false; }
});

(async () => {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) { location.replace('/login.html?role=admin'); return; }
    const { user } = await response.json();
    if (user.role !== 'admin') { location.replace('/login.html?role=admin'); return; }
    sessionCheck.hidden = true;
    dashboard.hidden = false;
    await loadEnquiries();
  } catch {
    const note = document.querySelector('#session-status');
    note.textContent = 'The sign-in server could not be reached.';
  }
})();
