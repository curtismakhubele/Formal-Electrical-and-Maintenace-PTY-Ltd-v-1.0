const statusNode = document.querySelector('#portal-status');
const userNode = document.querySelector('#portal-user');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function dateLabel(value) {
  if (!value) return 'Date not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function money(value) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(value) || 0);
}

async function api(path) {
  const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
  if (response.status === 401) { location.replace('/login.html?role=assigned'); throw new Error('Sign in to view this workspace.'); }
  if (!response.ok) throw new Error('The workspace could not be loaded.');
  return response.json();
}

function fileLink(file) {
  if (!file?.id) return '';
  return `<a class="portal-file" href="/api/files/${encodeURIComponent(file.id)}">${escapeHtml(file.name || file.label || 'Download document')}</a>`;
}

function renderProjects(projects) {
  const target = document.querySelector('#portal-projects');
  document.querySelector('#project-count').textContent = String(projects.length);
  if (!projects.length) { target.innerHTML = '<div class="portal-empty">No projects have been assigned to your account yet.</div>'; return; }
  target.innerHTML = projects.map((project) => {
    const docs = (project.documents || []).map((file) => `<div>${escapeHtml(file.kind || 'Project document')}${fileLink(file)}</div>`).join('');
    const certs = (project.certificates || []).map((certificate) => `<div class="portal-record"><strong>COC certificate · ${escapeHtml(certificate.status || 'Issued')}</strong><span>${escapeHtml(certificate.number || '')}</span><small>${escapeHtml(dateLabel(certificate.issueDate))}</small><p>${escapeHtml(certificate.notes || '')}</p>${fileLink(certificate.document)}</div>`).join('');
    const work = (project.workLogs || []).map((entry) => `<div class="portal-record"><strong>${escapeHtml(entry.title || 'Work update')}</strong><small>${escapeHtml(dateLabel(entry.date))}${entry.status ? ' · ' + escapeHtml(entry.status) : ''}</small><p>${escapeHtml(entry.description || '')}</p></div>`).join('');
    return `<article class="portal-project"><div class="portal-project-top"><span class="portal-category">${escapeHtml(project.category || 'Project')}</span><span class="portal-state">${escapeHtml(project.status || 'In progress')}</span></div><h3>${escapeHtml(project.title)}</h3><p class="portal-reference">${escapeHtml(project.reference || '')}${project.location ? ' · ' + escapeHtml(project.location) : ''}</p><p>${escapeHtml(project.description || 'Project details will appear here as the team records progress.')}</p>${project.targetDate ? `<small class="portal-updated">Target date ${escapeHtml(dateLabel(project.targetDate))}</small>` : ''}<small class="portal-updated">Updated ${escapeHtml(dateLabel(project.updatedAt || project.createdAt))}</small>${work ? `<section><h4>Work records</h4>${work}</section>` : ''}${certs ? `<section><h4>Certificates</h4>${certs}</section>` : ''}${docs ? `<section><h4>Project documents</h4><div class="portal-files">${docs}</div></section>` : ''}</article>`;
  }).join('');
}

function printInvoice(invoice, company) {
  const rows = (invoice.items || []).map((item) => `<tr><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${money(item.unitPrice)}</td><td>${money(item.lineTotal)}</td></tr>`).join('');
  const logo = company.logoUrl ? `<img src="${escapeHtml(company.logoUrl)}" alt="Company logo" style="max-width:180px;max-height:90px">` : '';
  const popup = window.open('', '_blank');
  if (!popup) { statusNode.textContent = 'Allow pop-ups to print or save the invoice as PDF.'; return; }
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title><style>body{font:14px Arial,sans-serif;color:#17212b;margin:40px}header{display:flex;justify-content:space-between;gap:30px}h1{font-size:30px}table{width:100%;border-collapse:collapse;margin-top:30px}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd}th:last-child,td:last-child{text-align:right}.total{text-align:right;font-size:20px;margin-top:24px}.muted{color:#586675}</style></head><body><header><div>${logo}<h2>${escapeHtml(company.companyName || 'Formal Electrical & Maintenance')}</h2><p class="muted">${escapeHtml(company.email || '')}<br>${escapeHtml(company.phone || '')}<br>${escapeHtml(company.address || '')}${company.vatNumber ? '<br>VAT: ' + escapeHtml(company.vatNumber) : ''}</p></div><div><h1>INVOICE</h1><p>${escapeHtml(invoice.invoiceNumber)}</p><p>Issued: ${escapeHtml(dateLabel(invoice.invoiceDate))}<br>Due: ${escapeHtml(dateLabel(invoice.dueDate))}</p></div></header><p><strong>Bill to:</strong> ${escapeHtml(invoice.clientName || '')} ${escapeHtml(invoice.clientEmail || '')}</p><p>${escapeHtml(invoice.projectReference || '')} · ${escapeHtml(invoice.projectTitle || '')}</p><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><p>Subtotal: ${money(invoice.subtotal)} · Tax (${escapeHtml(invoice.taxRate)}%): ${money(invoice.tax)}</p><p class="total">Total: ${money(invoice.total)}</p>${invoice.notes ? `<p>${escapeHtml(invoice.notes)}</p>` : ''}<script>window.onload=()=>window.print()<\/script></body></html>`);
  popup.document.close();
}

function renderInvoices(invoices, company) {
  const target = document.querySelector('#portal-invoices');
  document.querySelector('#invoice-count').textContent = String(invoices.length);
  if (!invoices.length) { target.innerHTML = '<div class="portal-empty">No invoices are available for your account.</div>'; return; }
  target.innerHTML = invoices.map((invoice, index) => `<article class="portal-invoice"><div class="portal-project-top"><span class="portal-category">${escapeHtml(invoice.invoiceNumber)}</span><span class="portal-state">${escapeHtml(invoice.status || 'Draft')}</span></div><h3>${escapeHtml(invoice.projectTitle || 'Project invoice')}</h3><p>${escapeHtml(invoice.clientName || '')}</p><strong class="portal-total">${money(invoice.total)}</strong><p class="portal-reference">Issued ${escapeHtml(dateLabel(invoice.invoiceDate))}${invoice.dueDate ? ` · Due ${escapeHtml(dateLabel(invoice.dueDate))}` : ''}</p><button class="portal-print" type="button" data-invoice="${index}">Print / save PDF</button>${invoice.file ? fileLink(invoice.file) : ''}</article>`).join('');
  target.querySelectorAll('[data-invoice]').forEach((button) => button.addEventListener('click', () => printInvoice(invoices[Number(button.dataset.invoice)], company)));
}

async function loadPortal() {
  try {
    const { user } = await api('/api/auth/me');
    if (user.role === 'admin') { location.replace('/admin.html'); return; }
    userNode.textContent = user.email;
    const [projectData, invoiceData, companyData] = await Promise.all([
      api('/api/workspace/projects'), api('/api/workspace/invoices'), api('/api/workspace/company')
    ]);
    renderProjects(projectData.projects || []);
    renderInvoices(invoiceData.invoices || [], companyData.company || {});
  } catch (error) {
    statusNode.textContent = error.message || 'The sign-in server could not be reached.';
    userNode.textContent = 'Account unavailable';
  }
}

document.querySelector('#sign-out').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally { location.replace('/login.html'); }
});

loadPortal();
