const loginView = document.querySelector('#login-view');
const dashboard = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginStatus = document.querySelector('#login-status');
const dashboardStatus = document.querySelector('#dashboard-status');
const list = document.querySelector('#enquiry-list');
const count = document.querySelector('#enquiry-count');
let accessKey = sessionStorage.getItem('formal-admin-key') || '';

function showDashboard(show) {
  loginView.hidden = show;
  dashboard.hidden = !show;
}

function setStatus(node, message, error = false) {
  node.textContent = message;
  node.className = `form-status${error ? ' is-error' : ''}`;
}

async function loadEnquiries() {
  setStatus(dashboardStatus, '');
  count.textContent = 'Loading enquiries…';
  try {
    const response = await fetch('/api/admin/enquiries', {
      headers: { Authorization: `Bearer ${accessKey}` },
      cache: 'no-store'
    });
    const data = await response.json();
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
    setStatus(dashboardStatus, error.message, true);
    if (error.message.includes('access') || error.message.includes('configured')) {
      sessionStorage.removeItem('formal-admin-key');
      accessKey = '';
      showDashboard(false);
      setStatus(loginStatus, error.message, true);
    }
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = document.querySelector('#access-key').value;
  setStatus(loginStatus, 'Checking access…');
  accessKey = key;
  try {
    const response = await fetch('/api/admin/enquiries', {
      headers: { Authorization: `Bearer ${accessKey}` },
      cache: 'no-store'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Access could not be verified.');
    sessionStorage.setItem('formal-admin-key', accessKey);
    setStatus(loginStatus, '');
    showDashboard(true);
    await loadEnquiries();
  } catch (error) {
    accessKey = '';
    setStatus(loginStatus, error.message, true);
  }
});

document.querySelector('#refresh').addEventListener('click', loadEnquiries);
document.querySelector('#sign-out').addEventListener('click', () => {
  sessionStorage.removeItem('formal-admin-key');
  accessKey = '';
  document.querySelector('#access-key').value = '';
  list.replaceChildren();
  setStatus(loginStatus, '');
  showDashboard(false);
});

if (accessKey) {
  showDashboard(true);
  loadEnquiries();
}

