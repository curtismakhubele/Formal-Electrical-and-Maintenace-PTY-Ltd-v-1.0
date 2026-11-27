const sessionCheck = document.querySelector('#session-check');
const dashboard = document.querySelector('#dashboard-view');
const dashboardStatus = document.querySelector('#dashboard-status');
const projectList = document.querySelector('#project-list');
const invoiceList = document.querySelector('#invoice-list');
const userList = document.querySelector('#user-list');
const enquiryList = document.querySelector('#enquiry-list');
const projectAssignees = document.querySelector('#project-assignees');
const invoiceProject = document.querySelector('#invoice-project');
const companyLogoPreview = document.querySelector('#company-logo-preview');

let users = [];
let projects = [];
let invoices = [];
let companySettings = {};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
};

const setStatus = (node, message, error = false) => {
  node.textContent = message;
  node.className = error ? 'inline-status is-error' : 'inline-status';
};

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  let data = {};
  try { data = await response.json(); } catch {}
  if (response.status === 401 || response.status === 403) {
    location.replace('/login.html?role=admin');
    throw new Error('Administrator access is required.');
  }
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function formField(labelText, input, className = '') {
  const label = el('label', className);
  label.append(document.createTextNode(labelText), input);
  return label;
}

function inputField(name, type = 'text', placeholder = '', value = '') {
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  if (placeholder) input.placeholder = placeholder;
  if (value !== undefined && value !== null) input.value = value;
  return input;
}

function textareaField(name, value = '', rows = 2, placeholder = '') {
  const input = document.createElement('textarea');
  input.name = name;
  input.rows = rows;
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function selectField(name, choices, selected = '') {
  const select = document.createElement('select');
  select.name = name;
  choices.forEach((choice) => {
    const option = document.createElement('option');
    option.value = choice;
    option.textContent = choice;
    option.selected = choice === selected;
    select.append(option);
  });
  return select;
}

function actionButton(text, className = 'secondary-action', type = 'button') {
  const button = el('button', className, text);
  button.type = type;
  return button;
}

function filePayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected file could not be read.'));
    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
    reader.readAsDataURL(file);
  });
}

function fileLink(file, label) {
  const link = document.createElement('a');
  link.href = '/api/files/' + encodeURIComponent(file.id);
  link.textContent = label || file.name;
  link.rel = 'noopener';
  link.className = 'record-file';
  return link;
}

function emptyMessage(text) {
  return el('div', 'empty-state', text);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString('en-ZA', { dateStyle: 'medium' });
}

function money(value) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(value) || 0);
}

function updateOverview() {
  document.querySelector('#stat-active').textContent = projects.filter((project) => project.status === 'In progress').length;
  document.querySelector('#stat-completed').textContent = projects.filter((project) => project.status === 'Completed').length;
  document.querySelector('#stat-invoices').textContent = invoices.length;
  document.querySelector('#stat-cocs').textContent = projects.reduce((sum, project) => sum + (project.certificates || []).length, 0);
}

function refreshAssigneeOptions() {
  projectAssignees.replaceChildren();
  const assigned = users.filter((user) => user.role === 'assigned');
  if (!assigned.length) {
    const option = el('option', '', 'No assigned-user accounts yet');
    option.disabled = true;
    projectAssignees.append(option);
    return;
  }
  assigned.forEach((user) => {
    const option = el('option', '', user.email);
    option.value = user.email;
    projectAssignees.append(option);
  });
}

function refreshInvoiceProjects() {
  invoiceProject.replaceChildren();
  invoiceProject.append(new Option('Choose a project', ''));
  projects.forEach((project) => invoiceProject.append(new Option(project.reference + ' · ' + project.title, project.id)));
}

function renderWork(project, target) {
  const items = project.workLogs || [];
  if (!items.length) { target.append(emptyMessage('No work has been logged for this project.')); return; }
  items.forEach((work) => {
    const row = el('article', 'record-row');
    const head = el('div', 'record-row-head');
    head.append(el('strong', '', work.title), el('span', 'status-pill ' + (work.status === 'Completed' ? 'is-complete' : ''), work.status));
    row.append(head, el('time', 'record-date', formatDate(work.date)), el('p', 'record-copy', work.description));
    target.append(row);
  });
}

function renderFiles(items, target) {
  if (!items || !items.length) { target.append(emptyMessage('No documents stored yet.')); return; }
  items.forEach((file) => {
    const row = el('div', 'file-row');
    row.append(el('span', 'file-kind', file.kind || 'Document'), fileLink(file, file.name), el('small', '', formatDate(file.createdAt)));
    target.append(row);
  });
}

function renderCertificates(items, target) {
  if (!items || !items.length) { target.append(emptyMessage('No COC certificates have been issued yet.')); return; }
  items.forEach((certificate) => {
    const row = el('article', 'record-row');
    const head = el('div', 'record-row-head');
    head.append(el('strong', '', 'COC ' + certificate.number), el('span', 'status-pill is-complete', certificate.status || 'Issued'));
    row.append(head, el('time', 'record-date', 'Issued ' + formatDate(certificate.issueDate)));
    if (certificate.notes) row.append(el('p', 'record-copy', certificate.notes));
    if (certificate.document) row.append(fileLink(certificate.document, 'Download certificate · ' + certificate.document.name));
    target.append(row);
  });
}

function renderProjects() {
  projectList.replaceChildren();
  refreshAssigneeOptions();
  refreshInvoiceProjects();
  updateOverview();
  if (!projects.length) { projectList.append(emptyMessage('No projects yet. Create a project above to start the register.')); return; }
  projects.forEach((project) => {
    const card = el('article', 'project-card');
    const head = el('div', 'project-card-head');
    const identity = el('div');
    identity.append(el('span', 'project-reference', project.reference), el('h3', '', project.title), el('p', 'project-client', project.clientName + (project.clientEmail ? ' · ' + project.clientEmail : '')));
    const status = el('span', 'status-pill ' + (project.status === 'Completed' ? 'is-complete' : ''), project.status);
    head.append(identity, status);
    const meta = el('div', 'project-meta');
    meta.append(el('span', 'category-pill', project.category), el('span', '', project.location || 'Location not set'), el('span', '', 'Start ' + formatDate(project.startDate)), el('span', '', 'Target ' + formatDate(project.targetDate)));
    card.append(head, meta);
    if (project.description) card.append(el('p', 'record-copy project-description', project.description));

    const details = el('details', 'project-details');
    details.append(el('summary', '', 'Manage project records and assignment'));
    const editForm = el('form', 'project-edit-form');
    const statusSelect = selectField('status', ['In progress', 'Completed'], project.status);
    const categorySelect = selectField('category', ['Construction', 'Electrical', 'General', 'Civil'], project.category);
    const assigneeSelect = document.createElement('select');
    assigneeSelect.name = 'assignedUsers';
    assigneeSelect.multiple = true;
    assigneeSelect.size = Math.min(5, Math.max(2, users.filter((user) => user.role === 'assigned').length));
    users.filter((user) => user.role === 'assigned').forEach((user) => {
      const option = new Option(user.email, user.email);
      option.selected = (project.assignedUsers || []).includes(user.email);
      assigneeSelect.append(option);
    });
    editForm.append(formField('Status', statusSelect), formField('Category', categorySelect), formField('Assigned users', assigneeSelect), actionButton('Save project changes', 'secondary-action', 'submit'));
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/admin/projects/' + project.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          status: statusSelect.value, category: categorySelect.value, assignedUsers: [...assigneeSelect.selectedOptions].map((option) => option.value)
        }) });
        await loadProjects();
        setStatus(dashboardStatus, 'Project changes saved.');
      } catch (error) { setStatus(dashboardStatus, error.message, true); }
    });
    details.append(editForm);

    const workSection = el('div', 'project-record-section');
    workSection.append(el('h4', '', 'Work done and completion'));
    const workList = el('div', 'records-list');
    renderWork(project, workList);
    const workForm = el('form', 'compact-form');
    const workTitle = inputField('title', 'text', 'Work item or milestone');
    workTitle.maxLength = 160; workTitle.required = true;
    const workDate = inputField('date', 'date', '', new Date().toISOString().slice(0, 10)); workDate.required = true;
    const workStatus = selectField('status', ['In progress', 'Completed'], 'Completed');
    const workDescription = textareaField('description', '', 2, 'Describe the work performed or completion details'); workDescription.maxLength = 3000; workDescription.required = true;
    workForm.append(formField('Work item', workTitle), formField('Date', workDate), formField('Status', workStatus), formField('Details', workDescription), actionButton('Add work record', 'secondary-action', 'submit'));
    workForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/admin/projects/' + project.id + '/work', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(workForm))) });
        await loadProjects();
        setStatus(dashboardStatus, 'Work record saved.');
      } catch (error) { setStatus(dashboardStatus, error.message, true); }
    });
    workSection.append(workList, workForm);

    const cocSection = el('div', 'project-record-section');
    cocSection.append(el('h4', '', 'COC certificates'));
    const cocList = el('div', 'records-list');
    renderCertificates(project.certificates, cocList);
    const cocForm = el('form', 'compact-form');
    const cocNumber = inputField('number', 'text', 'Certificate number'); cocNumber.maxLength = 100; cocNumber.required = true;
    const cocDate = inputField('issueDate', 'date', '', new Date().toISOString().slice(0, 10)); cocDate.required = true;
    const cocNotes = textareaField('notes', '', 2, 'Optional certificate note'); cocNotes.maxLength = 2000;
    const cocFile = inputField('file', 'file'); cocFile.accept = 'application/pdf';
    cocForm.append(formField('COC number', cocNumber), formField('Issue date', cocDate), formField('Notes', cocNotes), formField('Certificate PDF', cocFile), actionButton('Record COC issued', 'secondary-action', 'submit'));
    cocForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const payload = { number: cocNumber.value, issueDate: cocDate.value, notes: cocNotes.value };
        if (cocFile.files[0]) payload.file = await filePayload(cocFile.files[0]);
        await api('/api/admin/projects/' + project.id + '/certificates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        await loadProjects();
        setStatus(dashboardStatus, 'COC certificate recorded as issued.');
      } catch (error) { setStatus(dashboardStatus, error.message, true); }
    });
    cocSection.append(cocList, cocForm);

    const documentSection = el('div', 'project-record-section');
    documentSection.append(el('h4', '', 'Contract and project documents'));
    const documentList = el('div', 'records-list');
    renderFiles(project.documents, documentList);
    const documentForm = el('form', 'compact-form');
    const documentKind = selectField('kind', ['Contract', 'Scope of work', 'Completion record', 'Other project document'], 'Contract');
    const documentFile = inputField('file', 'file'); documentFile.accept = 'application/pdf,image/png,image/jpeg,image/webp'; documentFile.required = true;
    documentForm.append(formField('Document type', documentKind), formField('File', documentFile), actionButton('Store project document', 'secondary-action', 'submit'));
    documentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api('/api/admin/projects/' + project.id + '/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: documentKind.value, file: await filePayload(documentFile.files[0]) }) });
        await loadProjects();
        setStatus(dashboardStatus, 'Project document stored.');
      } catch (error) { setStatus(dashboardStatus, error.message, true); }
    });
    documentSection.append(documentList, documentForm);
    details.append(workSection, cocSection, documentSection);
    card.append(details);
    projectList.append(card);
  });
}

function renderUsers() {
  userList.replaceChildren();
  const rows = users.map((user) => {
    const row = el('article', 'register-row');
    row.append(el('strong', '', user.email), el('span', 'category-pill', user.role === 'admin' ? 'Administrator' : 'Assigned user'), el('small', '', 'Created ' + formatDate(user.createdAt)));
    return row;
  });
  if (!rows.length) userList.append(emptyMessage('No user accounts have been created.'));
  else rows.forEach((row) => userList.append(row));
  refreshAssigneeOptions();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function printInvoice(invoice) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) { setStatus(dashboardStatus, 'Allow the invoice window to open, then choose Print or Save as PDF.', true); return; }
  const logo = companySettings.logo?.id ? '<img class="logo" src="/api/files/' + encodeURIComponent(companySettings.logo.id) + '?inline=1" alt="Company logo">' : '';
  const itemRows = invoice.items.map((item) => '<tr><td>' + escapeHtml(item.description) + '</td><td>' + escapeHtml(item.quantity) + '</td><td>' + escapeHtml(money(item.unitPrice)) + '</td><td>' + escapeHtml(money(item.lineTotal)) + '</td></tr>').join('');
  printWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(invoice.invoiceNumber) + '</title><style>body{font:14px Arial,sans-serif;color:#172640;margin:48px}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #102a3a;padding-bottom:20px}h1,h2,p{margin:0 0 10px}h1{font-size:30px}.logo{max-width:150px;max-height:80px;object-fit:contain}.meta{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:28px 0}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{text-align:left;padding:11px;border-bottom:1px solid #d8dfe5}th{background:#f1f4f6}.totals{margin-left:auto;width:280px}.totals p{display:flex;justify-content:space-between}.total{font-weight:bold;font-size:18px;border-top:2px solid #102a3a;padding-top:12px}.notes{margin-top:30px;white-space:pre-wrap}@media print{body{margin:20mm}}</style></head><body><header><div>' + logo + '<h2>' + escapeHtml(companySettings.companyName) + '</h2><p>' + escapeHtml(companySettings.address) + '</p><p>' + escapeHtml(companySettings.email) + ' · ' + escapeHtml(companySettings.phone) + '</p>' + (companySettings.vatNumber ? '<p>VAT: ' + escapeHtml(companySettings.vatNumber) + '</p>' : '') + '</div><div><h1>INVOICE</h1><p><strong>' + escapeHtml(invoice.invoiceNumber) + '</strong></p><p>Status: ' + escapeHtml(invoice.status) + '</p></div></header><div class="meta"><div><h2>Bill to</h2><p>' + escapeHtml(invoice.clientName) + '</p><p>' + escapeHtml(invoice.clientEmail) + '</p></div><div><h2>Project</h2><p>' + escapeHtml(invoice.projectReference) + ' · ' + escapeHtml(invoice.projectTitle) + '</p><p>Invoice date: ' + escapeHtml(formatDate(invoice.invoiceDate)) + '</p><p>Due date: ' + escapeHtml(formatDate(invoice.dueDate)) + '</p></div></div><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>' + itemRows + '</tbody></table><div class="totals"><p><span>Subtotal</span><strong>' + escapeHtml(money(invoice.subtotal)) + '</strong></p><p><span>Tax (' + escapeHtml(invoice.taxRate) + '%)</span><strong>' + escapeHtml(money(invoice.tax)) + '</strong></p><p class="total"><span>Total due</span><strong>' + escapeHtml(money(invoice.total)) + '</strong></p></div>' + (invoice.notes ? '<div class="notes"><strong>Notes</strong><p>' + escapeHtml(invoice.notes) + '</p></div>' : '') + '</body></html>');
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => printWindow.print();
}

function renderInvoices() {
  invoiceList.replaceChildren();
  refreshInvoiceProjects();
  updateOverview();
  if (!invoices.length) { invoiceList.append(emptyMessage('No invoices have been created yet.')); return; }
  invoices.forEach((invoice) => {
    const card = el('article', 'invoice-card');
    const head = el('div', 'project-card-head');
    const identity = el('div');
    identity.append(el('span', 'project-reference', invoice.invoiceNumber), el('h3', '', invoice.clientName), el('p', 'project-client', invoice.projectReference + ' · ' + invoice.projectTitle));
    head.append(identity, el('span', 'status-pill ' + (invoice.status === 'Paid' ? 'is-complete' : ''), invoice.status));
    const footer = el('div', 'invoice-card-footer');
    footer.append(el('strong', '', money(invoice.total)), el('span', '', 'Due ' + formatDate(invoice.dueDate)));
    const controls = el('div', 'invoice-controls');
    const status = selectField('status', ['Draft', 'Issued', 'Paid', 'Overdue', 'Void'], invoice.status);
    const saveStatus = actionButton('Update status', 'secondary-action');
    saveStatus.addEventListener('click', async () => {
      try { await api('/api/admin/invoices/' + invoice.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status.value }) }); await loadInvoices(); }
      catch (error) { setStatus(dashboardStatus, error.message, true); }
    });
    controls.append(formField('Status', status), saveStatus, actionButton('Print / Save PDF', 'secondary-action'));
    controls.lastChild.addEventListener('click', () => printInvoice(invoice));
    card.append(head, footer, controls);
    invoiceList.append(card);
  });
}

function renderEnquiries(enquiries) {
  enquiryList.replaceChildren();
  if (!enquiries.length) { enquiryList.append(emptyMessage('No enquiries have been received yet.')); return; }
  enquiries.forEach((record) => {
    const card = el('article', 'enquiry-card');
    const head = el('div', 'enquiry-card-head');
    const identity = el('div');
    identity.append(el('h3', '', record.name), el('time', '', new Date(record.receivedAt).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })));
    head.append(identity, el('span', 'category-pill', record.service));
    card.append(head, el('p', 'enquiry-contact', [record.email, record.phone, record.location].filter(Boolean).join(' · ')), el('p', 'record-copy', record.message));
    enquiryList.append(card);
  });
}

async function loadUsers() {
  const data = await api('/api/admin/users');
  users = data.users;
  renderUsers();
  renderProjects();
}

async function loadProjects() {
  const data = await api('/api/admin/projects');
  projects = data.projects;
  renderProjects();
}

async function loadInvoices() {
  const data = await api('/api/admin/invoices');
  invoices = data.invoices;
  renderInvoices();
}

async function loadSettings() {
  const data = await api('/api/admin/settings');
  companySettings = data.settings;
  const form = document.querySelector('#settings-form');
  for (const key of ['companyName', 'address', 'email', 'phone', 'vatNumber', 'invoicePrefix']) form.elements[key].value = companySettings[key] || '';
  if (companySettings.logo?.id) {
    companyLogoPreview.src = '/api/files/' + encodeURIComponent(companySettings.logo.id) + '?inline=1';
    companyLogoPreview.hidden = false;
  } else {
    companyLogoPreview.removeAttribute('src');
    companyLogoPreview.hidden = true;
  }
}

async function loadEnquiries() {
  const data = await api('/api/admin/enquiries');
  renderEnquiries(data.enquiries);
}

async function loadWorkspace() {
  try {
    await loadUsers();
    await loadProjects();
    await loadInvoices();
    await loadSettings();
    await loadEnquiries();
  } catch (error) { setStatus(dashboardStatus, error.message || 'Some workspace data could not be loaded.', true); }
  updateOverview();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach((nav) => nav.classList.toggle('active', nav === button));
  document.querySelectorAll('[data-section]').forEach((section) => { section.hidden = section.dataset.section !== button.dataset.view; });
}));
document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => document.querySelector('[data-view="' + button.dataset.goView + '"]').click()));

document.querySelector('#sign-out').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally { location.replace('/login.html'); }
});

document.querySelector('#create-project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#project-create-status');
  const values = Object.fromEntries(new FormData(form));
  values.assignedUsers = [...form.elements.assignedUsers.selectedOptions].map((option) => option.value);
  try {
    await api('/api/admin/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    form.reset();
    await loadProjects();
    setStatus(status, 'Project created and added to the register.');
  } catch (error) { setStatus(status, error.message, true); }
});

document.querySelector('#refresh-projects').addEventListener('click', () => loadProjects().catch((error) => setStatus(dashboardStatus, error.message, true)));
document.querySelector('#refresh-invoices').addEventListener('click', () => loadInvoices().catch((error) => setStatus(dashboardStatus, error.message, true)));
document.querySelector('#refresh-users').addEventListener('click', () => loadUsers().catch((error) => setStatus(dashboardStatus, error.message, true)));
document.querySelector('#refresh-enquiries').addEventListener('click', () => loadEnquiries().catch((error) => setStatus(dashboardStatus, error.message, true)));

function addInvoiceLine(description = '', quantity = '1', unitPrice = '') {
  const row = el('div', 'invoice-line');
  const descriptionInput = inputField('description', 'text', 'Work, materials, or service', description); descriptionInput.required = true; descriptionInput.maxLength = 240;
  const quantityInput = inputField('quantity', 'number', '', quantity); quantityInput.min = '0.01'; quantityInput.step = '0.01'; quantityInput.required = true;
  const priceInput = inputField('unitPrice', 'number', '', unitPrice); priceInput.min = '0'; priceInput.step = '0.01'; priceInput.required = true;
  const remove = actionButton('Remove', 'quiet-action');
  remove.addEventListener('click', () => { if (document.querySelectorAll('.invoice-line').length > 1) row.remove(); });
  row.append(formField('Description', descriptionInput), formField('Quantity', quantityInput), formField('Unit price (ZAR)', priceInput), remove);
  document.querySelector('#invoice-lines').append(row);
}

document.querySelector('#add-invoice-line').addEventListener('click', () => addInvoiceLine());
addInvoiceLine();
invoiceProject.addEventListener('change', () => {
  const project = projects.find((item) => item.id === invoiceProject.value);
  if (!project) return;
  const form = document.querySelector('#create-invoice-form');
  form.elements.clientName.value = project.clientName;
  form.elements.clientEmail.value = project.clientEmail || '';
});
document.querySelector('#create-invoice-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#invoice-create-status');
  const values = Object.fromEntries(new FormData(form));
  values.items = [...document.querySelectorAll('.invoice-line')].map((row) => ({
    description: row.querySelector('[name="description"]').value,
    quantity: row.querySelector('[name="quantity"]').value,
    unitPrice: row.querySelector('[name="unitPrice"]').value
  }));
  try {
    await api('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    form.elements.notes.value = '';
    document.querySelector('#invoice-lines').replaceChildren();
    addInvoiceLine();
    await loadInvoices();
    setStatus(status, 'Draft invoice saved. Open Print / Save PDF to create a printable copy.');
  } catch (error) { setStatus(status, error.message, true); }
});

document.querySelector('#create-user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#create-user-status');
  const values = Object.fromEntries(new FormData(form));
  try {
    const data = await api('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    form.reset();
    setStatus(status, 'Assigned-user login created for ' + data.user.email + '. Share the password privately.');
    await loadUsers();
  } catch (error) { setStatus(status, error.message, true); }
});

document.querySelector('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#settings-status');
  try {
    const data = await api('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    companySettings = data.settings;
    setStatus(status, 'Company settings saved.');
  } catch (error) { setStatus(status, error.message, true); }
});

document.querySelector('#password-change-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#password-change-status');
  if (form.elements.newPassword.value !== form.elements.confirmPassword.value) {
    setStatus(status, 'The new passwords do not match.', true);
    return;
  }
  try {
    await api('/api/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value }) });
    form.reset();
    setStatus(status, 'Administrator password changed. Keep the new password private.');
  } catch (error) { setStatus(status, error.message, true); }
});

document.querySelector('#upload-company-logo').addEventListener('click', async () => {
  const file = document.querySelector('#company-logo-file').files[0];
  const status = document.querySelector('#settings-status');
  if (!file) { setStatus(status, 'Choose a logo file first.', true); return; }
  try {
    const data = await api('/api/admin/settings/logo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: await filePayload(file) }) });
    companySettings = data.settings;
    companyLogoPreview.src = '/api/files/' + encodeURIComponent(data.logo.id) + '?inline=1';
    companyLogoPreview.hidden = false;
    setStatus(status, 'Company logo uploaded.');
  } catch (error) { setStatus(status, error.message, true); }
});

(async () => {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) { location.replace('/login.html?role=admin'); return; }
    const { user } = await response.json();
    if (user.role !== 'admin') { location.replace('/login.html?role=admin'); return; }
    sessionCheck.hidden = true;
    dashboard.hidden = false;
    await loadWorkspace();
  } catch {
    document.querySelector('#session-status').textContent = 'The sign-in server could not be reached.';
  }
})();
