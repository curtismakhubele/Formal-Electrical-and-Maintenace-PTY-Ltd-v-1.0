const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 256 * 1024;
const maxUploadBodyBytes = 10 * 1024 * 1024;
const maxStoredFileBytes = 7 * 1024 * 1024;
const rateWindowMs = 60 * 60 * 1000;
const maxPerWindow = 6;
const submissions = new Map();
const sessions = new Map();
const loginAttempts = new Map();
let accountWriteQueue = Promise.resolve();
let recordWriteQueue = Promise.resolve();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const authUsersPath = path.join(dataDir, 'auth-users.json');
const documentDir = path.join(dataDir, 'documents');
const storePaths = {
  projects: path.join(dataDir, 'projects.json'),
  invoices: path.join(dataDir, 'invoices.json'),
  settings: path.join(dataDir, 'company-settings.json')
};
const projectCategories = new Set(['Construction', 'Electrical', 'General', 'Civil']);
const projectStatuses = new Set(['In progress', 'Completed']);
const defaultCompanySettings = {
  companyName: 'Formal Electrical and Maintenance (Pty) Ltd',
  address: '4 S P Kwakwa St, Saulsville, Pretoria, 0125, South Africa',
  email: 'info@formalelectrical.co.za',
  phone: '+27 12 345 6900',
  vatNumber: '',
  invoicePrefix: 'FEM',
  logo: null
};
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};
const services = new Set([
  'Electrical services', 'Construction & renovations', 'Project coordination',
  'Facilities maintenance', 'Plumbing & water solutions', 'Cleaning & grounds care',
  'Other / multiple services'
]);
const staticFiles = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'], ['/icon.svg', 'icon.svg'], ['/auth-nav.css', 'auth-nav.css'], ['/privacy.html', 'privacy.html'],
  ['/admin.html', 'admin.html'], ['/admin.css', 'admin.css'], ['/admin-users.css', 'admin-users.css'], ['/admin.js', 'admin.js'],
  ['/login.html', 'login.html'], ['/login.css', 'login.css'], ['/login.js', 'login.js'],
  ['/portal.html', 'portal.html'], ['/portal.css', 'portal.css'], ['/portal.js', 'portal.js'],
  ['/setup.html', 'setup.html'], ['/setup.js', 'setup.js'],
  ['/assets/worker-hero.jpg', 'assets/worker-hero.jpg'], ['/assets/company-building.jpg', 'assets/company-building.jpg']
]);

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const divider = part.indexOf('=');
    if (divider < 0) return [part, ''];
    const value = part.slice(divider + 1);
    try { return [part.slice(0, divider), decodeURIComponent(value)]; }
    catch { return [part.slice(0, divider), '']; }
  }));
}

function sessionUser(req) {
  const token = parseCookies(req).formal_session || '';
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { sessions.delete(token); return null; }
  return session.user;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; }
  catch { return false; }
}

function loginKey(req) { return clientKey(req); }

function loginRateLimited(req) {
  const now = Date.now();
  const prior = (loginAttempts.get(loginKey(req)) || []).filter((time) => now - time < 15 * 60 * 1000);
  loginAttempts.set(loginKey(req), prior);
  return prior.length >= 8;
}

function noteLoginAttempt(req, success) {
  const key = loginKey(req);
  if (success) { loginAttempts.delete(key); return; }
  loginAttempts.set(key, [...(loginAttempts.get(key) || []), Date.now()]);
}

async function loadAccounts() {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(authUsersPath, 'utf8'));
    return Array.isArray(parsed.accounts) ? parsed.accounts : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function saveAccounts(accounts) {
  await fs.promises.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${authUsersPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, `${JSON.stringify({ accounts }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.promises.rename(temporaryPath, authUsersPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function provisionConfiguredAdmin(email, password) {
  const configuredEmail = typeof process.env.ADMIN_EMAIL === 'string' ? process.env.ADMIN_EMAIL.trim().toLowerCase() : '';
  const configuredPassword = typeof process.env.ADMIN_PASSWORD === 'string' ? process.env.ADMIN_PASSWORD : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail) || configuredEmail !== email || configuredPassword.length < 14 || configuredPassword.length > 256) return false;
  const provided = Buffer.from(password);
  const expected = Buffer.from(configuredPassword);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return false;
  const operation = accountWriteQueue.then(async () => {
    const accounts = await loadAccounts();
    const configuredAccount = accounts.find((account) => account.email === configuredEmail);
    if (accounts.some((account) => account.role === 'admin' && account.email !== configuredEmail) || configuredAccount?.envBootstrapUsedAt) return false;
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(configuredPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    const now = new Date().toISOString();
    if (configuredAccount) Object.assign(configuredAccount, { role: 'admin', salt: salt.toString('hex'), hash: hash.toString('hex'), envBootstrapUsedAt: now });
    else accounts.push({ email: configuredEmail, role: 'admin', salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: now, envBootstrapUsedAt: now });
    await saveAccounts(accounts);
    return true;
  });
  accountWriteQueue = operation.catch(() => {});
  return operation;
}

async function changeAccountPassword(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Password request was rejected.' });
  const user = sessionUser(req);
  if (!user) return sendJson(res, 401, { error: 'Sign in to continue.' });
  let input;
  try { input = await readJson(req); } catch { return sendJson(res, 400, { error: 'Enter your current and new passwords.' }); }
  if (typeof input?.currentPassword !== 'string' || typeof input.newPassword !== 'string' || input.newPassword.length < 14 || input.newPassword.length > 256) {
    return sendJson(res, 400, { error: 'Enter your current password and choose a new password of at least 14 characters.' });
  }
  const operation = accountWriteQueue.then(async () => {
    const accounts = await loadAccounts();
    const account = accounts.find((item) => item.email === user.email && item.role === user.role);
    if (!account || !verifyPassword(input.currentPassword, account)) return { invalid: true };
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(input.newPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    account.salt = salt.toString('hex');
    account.hash = hash.toString('hex');
    account.updatedAt = new Date().toISOString();
    await saveAccounts(accounts);
    return { changed: true };
  });
  accountWriteQueue = operation.catch(() => {});
  try {
    const result = await operation;
    if (result.invalid) return sendJson(res, 401, { error: 'Your current password is incorrect.' });
    for (const [token, session] of sessions) if (session.user.email === user.email) sessions.delete(token);
    startSession(res, user);
    return sendJson(res, 200, { message: 'Password changed. You are still signed in.' });
  } catch { return sendJson(res, 503, { error: 'The password could not be updated.' }); }
}

async function loadStore(name, fallback) {
  const filePath = storePaths[name];
  if (!filePath) throw new Error('Unknown private data store.');
  try { return JSON.parse(await fs.promises.readFile(filePath, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function saveStore(name, value) {
  const filePath = storePaths[name];
  if (!filePath) throw new Error('Unknown private data store.');
  await fs.promises.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temporaryPath = filePath + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  try {
    await fs.promises.writeFile(temporaryPath, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.promises.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function updateStore(name, fallback, updater) {
  const operation = recordWriteQueue.then(async () => {
    const current = await loadStore(name, fallback);
    const result = await updater(current);
    if (result && result.skipSave) return result.value;
    await saveStore(name, result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result);
    return result;
  });
  recordWriteQueue = operation.catch(() => {});
  return operation;
}

function safeFileName(value) {
  const base = path.basename(typeof value === 'string' ? value : 'document').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100);
  return base && base !== '.' ? base : 'document';
}

function storedExtension(type) {
  return type === 'application/pdf' ? '.pdf' : type === 'image/png' ? '.png' : type === 'image/jpeg' ? '.jpg' : '.webp';
}

function uploadType(file, allowedTypes) {
  if (!file || typeof file !== 'object' || typeof file.data !== 'string' || typeof file.type !== 'string') throw new Error('Choose a supported file.');
  const type = file.type.toLowerCase();
  if (!allowedTypes.includes(type)) throw new Error('Use a PDF, PNG, JPEG, or WebP file as allowed for this field.');
  const encoded = file.data.replace(/^data:[^,]*;base64,/, '');
  if (!encoded || encoded.length > Math.ceil(maxStoredFileBytes * 4 / 3) + 8) throw new Error('The file is too large. The limit is 7 MB.');
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > maxStoredFileBytes) throw new Error('The file is empty or exceeds the 7 MB limit.');
  const valid = type === 'application/pdf' ? buffer.subarray(0, 5).toString() === '%PDF-'
    : type === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : type === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    : type === 'image/webp' ? buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
    : false;
  if (!valid) throw new Error('The selected file does not match its file type.');
  const extension = type === 'application/pdf' ? '.pdf' : type === 'image/png' ? '.png' : type === 'image/jpeg' ? '.jpg' : '.webp';
  return { buffer, type, name: safeFileName(file.name || ('document' + extension)), extension };
}

async function persistUpload(file, allowedTypes) {
  const prepared = uploadType(file, allowedTypes);
  const id = crypto.randomUUID();
  const filePath = path.join(documentDir, id + prepared.extension);
  await fs.promises.mkdir(documentDir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(filePath, prepared.buffer, { flag: 'wx', mode: 0o600 });
  return { id, name: prepared.name, type: prepared.type, size: prepared.buffer.length, createdAt: new Date().toISOString() };
}

function normalizeEmailList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((email) => typeof email === 'string').map((email) => email.trim().toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))].slice(0, 100);
}

function adminSession(req, res) {
  const user = sessionUser(req);
  if (!user) { sendJson(res, 401, { error: 'Sign in to continue.' }); return null; }
  if (user.role !== 'admin') { sendJson(res, 403, { error: 'Administrator access is required.' }); return null; }
  return user;
}

async function findProject(id) {
  const projects = await loadStore('projects', []);
  return projects.find((project) => project.id === id) || null;
}

function projectVisibleTo(project, user) {
  return user.role === 'admin' || (Array.isArray(project.assignedUsers) && project.assignedUsers.includes(user.email));
}

async function createAssignedAccount(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Account request was rejected.' });
  const user = sessionUser(req);
  if (!user) return sendJson(res, 401, { error: 'Sign in to continue.' });
  if (user.role !== 'admin') return sendJson(res, 403, { error: 'Administrator access is required.' });
  let input;
  try { input = await readJson(req); }
  catch (error) { return sendJson(res, error.status || 400, { error: 'Enter a valid email and password.' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return sendJson(res, 400, { error: 'Enter a valid email and password.' });
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = input.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 14 || password.length > 256) {
    return sendJson(res, 400, { error: 'Use a valid email and a password of at least 14 characters.' });
  }
  const operation = accountWriteQueue.then(async () => {
    const accounts = await loadAccounts();
    if (accounts.some((account) => account.email === email)) return { conflict: true };
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    accounts.push({ email, role: 'assigned', salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: new Date().toISOString() });
    await fs.promises.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temporaryPath = `${authUsersPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, `${JSON.stringify({ accounts }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.promises.rename(temporaryPath, authUsersPath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
    return { conflict: false };
  });
  accountWriteQueue = operation.catch(() => {});
  try {
    const result = await operation;
    if (result.conflict) return sendJson(res, 409, { error: 'An account with that email already exists.' });
    return sendJson(res, 201, { user: { email, role: 'assigned' } });
  } catch {
    return sendJson(res, 503, { error: 'The account could not be saved. Check private storage and try again.' });
  }
}

async function createInitialAdmin(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Setup request was rejected.' });
  const expectedToken = process.env.ADMIN_SETUP_TOKEN || '';
  if (!expectedToken) return sendJson(res, 404, { error: 'Initial setup is not enabled.' });
  let input;
  try { input = await readJson(req); }
  catch { return sendJson(res, 400, { error: 'Enter valid setup details.' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return sendJson(res, 400, { error: 'Enter valid setup details.' });
  const provided = typeof input.setupToken === 'string' ? Buffer.from(input.setupToken) : Buffer.alloc(0);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return sendJson(res, 401, { error: 'The setup token is incorrect.' });
  }
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = input.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 14 || password.length > 256) {
    return sendJson(res, 400, { error: 'Use a valid email and a password of at least 14 characters.' });
  }
  const operation = accountWriteQueue.then(async () => {
    const accounts = await loadAccounts();
    if (accounts.length) return { conflict: true };
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    accounts.push({ email, role: 'admin', salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: new Date().toISOString() });
    await fs.promises.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const temporaryPath = `${authUsersPath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.promises.writeFile(temporaryPath, `${JSON.stringify({ accounts }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.promises.rename(temporaryPath, authUsersPath);
    } catch (error) {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
    return { conflict: false };
  });
  accountWriteQueue = operation.catch(() => {});
  try {
    const result = await operation;
    if (result.conflict) return sendJson(res, 409, { error: 'An administrator account already exists.' });
    return sendJson(res, 201, { user: { email, role: 'admin' } });
  } catch {
    return sendJson(res, 503, { error: 'The administrator account could not be saved. Check private storage and try again.' });
  }
}

async function listAdminUsers(req, res) {
  if (!adminSession(req, res)) return;
  try {
    const accounts = await loadAccounts();
    return sendJson(res, 200, { users: accounts.map((account) => ({ email: account.email, role: account.role, createdAt: account.createdAt })) });
  } catch { return sendJson(res, 503, { error: 'User accounts could not be loaded.' }); }
}

async function listWorkspaceProjects(req, res, adminOnly = false) {
  let user;
  if (adminOnly) {
    user = adminSession(req, res);
    if (!user) return;
  } else {
    user = sessionUser(req);
    if (!user) return sendJson(res, 401, { error: 'Sign in to continue.' });
  }
  try {
    const projects = await loadStore('projects', []);
    return sendJson(res, 200, { projects: projects.filter((project) => projectVisibleTo(project, user)).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) });
  } catch { return sendJson(res, 503, { error: 'Project records could not be loaded.' }); }
}

async function createProject(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Project request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req); } catch { return sendJson(res, 400, { error: 'Enter valid project details.' }); }
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const clientName = typeof input?.clientName === 'string' ? input.clientName.trim() : '';
  const clientEmail = typeof input?.clientEmail === 'string' ? input.clientEmail.trim().toLowerCase() : '';
  const category = input?.category;
  const status = input?.status || 'In progress';
  const assignedUsers = normalizeEmailList(input?.assignedUsers);
  if (!title || title.length > 140 || !clientName || clientName.length > 140 || (clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) || !projectCategories.has(category) || !projectStatuses.has(status)) {
    return sendJson(res, 400, { error: 'Add a project name, client, valid category, and project status.' });
  }
  try {
    const accounts = await loadAccounts();
    const knownAssigned = new Set(accounts.filter((account) => account.role === 'assigned').map((account) => account.email));
    if (assignedUsers.some((email) => !knownAssigned.has(email))) return sendJson(res, 400, { error: 'Assign projects only to existing assigned-user accounts.' });
    const created = await updateStore('projects', [], (projects) => {
      const year = new Date().getFullYear();
      const reference = 'FEM-' + year + '-' + String(projects.filter((project) => String(project.reference).startsWith('FEM-' + year + '-')).length + 1).padStart(4, '0');
      const project = {
        id: crypto.randomUUID(), reference, title, clientName, clientEmail, category, status,
        location: typeof input.location === 'string' ? input.location.trim().slice(0, 180) : '',
        description: typeof input.description === 'string' ? input.description.trim().slice(0, 4000) : '',
        startDate: typeof input.startDate === 'string' ? input.startDate.slice(0, 10) : '',
        targetDate: typeof input.targetDate === 'string' ? input.targetDate.slice(0, 10) : '',
        assignedUsers, workLogs: [], certificates: [], documents: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      return projects.concat(project);
    });
    return sendJson(res, 201, { project: created[created.length - 1] });
  } catch { return sendJson(res, 503, { error: 'The project could not be saved.' }); }
}

async function updateProject(req, res, id) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Project request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req); } catch { return sendJson(res, 400, { error: 'Enter valid project details.' }); }
  const changes = {};
  for (const field of ['title', 'clientName', 'clientEmail', 'location', 'description', 'startDate', 'targetDate']) {
    if (typeof input?.[field] === 'string') changes[field] = input[field].trim().slice(0, field === 'description' ? 4000 : 180);
  }
  if (input?.category !== undefined) {
    if (!projectCategories.has(input.category)) return sendJson(res, 400, { error: 'Choose a valid project category.' });
    changes.category = input.category;
  }
  if (input?.status !== undefined) {
    if (!projectStatuses.has(input.status)) return sendJson(res, 400, { error: 'Choose a valid project status.' });
    changes.status = input.status;
  }
  if (input?.clientEmail !== undefined && changes.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.clientEmail)) return sendJson(res, 400, { error: 'Enter a valid client email.' });
  if (input?.assignedUsers !== undefined) {
    changes.assignedUsers = normalizeEmailList(input.assignedUsers);
    try {
      const accounts = await loadAccounts();
      const knownAssigned = new Set(accounts.filter((account) => account.role === 'assigned').map((account) => account.email));
      if (changes.assignedUsers.some((email) => !knownAssigned.has(email))) return sendJson(res, 400, { error: 'Assign projects only to existing assigned-user accounts.' });
    } catch { return sendJson(res, 503, { error: 'User accounts could not be loaded.' }); }
  }
  try {
    const result = await updateStore('projects', [], (projects) => {
      const index = projects.findIndex((project) => project.id === id);
      if (index < 0) return { skipSave: true, value: null };
      projects[index] = { ...projects[index], ...changes, updatedAt: new Date().toISOString() };
      return { value: projects, project: projects[index] };
    });
    if (!result) return sendJson(res, 404, { error: 'Project not found.' });
    return sendJson(res, 200, { project: result.project });
  } catch { return sendJson(res, 503, { error: 'The project could not be updated.' }); }
}

async function addProjectWork(req, res, id) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Work record request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req); } catch { return sendJson(res, 400, { error: 'Enter a valid work record.' }); }
  const title = typeof input?.title === 'string' ? input.title.trim() : '';
  const date = typeof input?.date === 'string' ? input.date.slice(0, 10) : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const status = input?.status === 'Completed' ? 'Completed' : 'In progress';
  if (!title || title.length > 160 || !date || !description || description.length > 3000) return sendJson(res, 400, { error: 'Add the work item, date, and a short description.' });
  try {
    const work = { id: crypto.randomUUID(), title, date, description, status, createdAt: new Date().toISOString() };
    const result = await updateStore('projects', [], (projects) => {
      const project = projects.find((item) => item.id === id);
      if (!project) return { skipSave: true, value: null };
      project.workLogs = Array.isArray(project.workLogs) ? project.workLogs : [];
      project.workLogs.unshift(work);
      project.updatedAt = new Date().toISOString();
      return { value: projects, work };
    });
    if (!result) return sendJson(res, 404, { error: 'Project not found.' });
    return sendJson(res, 201, { work: result.work });
  } catch { return sendJson(res, 503, { error: 'The work record could not be saved.' }); }
}

async function addProjectDocument(req, res, id) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Document request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req, maxUploadBodyBytes); } catch { return sendJson(res, 400, { error: 'Choose a valid document.' }); }
  const kind = typeof input?.kind === 'string' ? input.kind.trim().slice(0, 40) : 'Project document';
  let file;
  try { file = await persistUpload(input?.file, ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']); }
  catch (error) { return sendJson(res, 400, { error: error.message }); }
  const document = { ...file, kind };
  try {
    const result = await updateStore('projects', [], (projects) => {
      const project = projects.find((item) => item.id === id);
      if (!project) return { skipSave: true, value: null };
      project.documents = Array.isArray(project.documents) ? project.documents : [];
      project.documents.unshift(document);
      project.updatedAt = new Date().toISOString();
      return { value: projects, document };
    });
    if (!result) {
      await fs.promises.rm(path.join(documentDir, file.id + storedExtension(file.type)), { force: true }).catch(() => {});
      return sendJson(res, 404, { error: 'Project not found.' });
    }
    return sendJson(res, 201, { document: result.document });
  } catch {
    await fs.promises.rm(path.join(documentDir, file.id + storedExtension(file.type)), { force: true }).catch(() => {});
    return sendJson(res, 503, { error: 'The document could not be saved.' });
  }
}

async function addProjectCertificate(req, res, id) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Certificate request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req, maxUploadBodyBytes); } catch { return sendJson(res, 400, { error: 'Enter valid certificate details.' }); }
  const number = typeof input?.number === 'string' ? input.number.trim().slice(0, 100) : '';
  const issueDate = typeof input?.issueDate === 'string' ? input.issueDate.slice(0, 10) : '';
  const notes = typeof input?.notes === 'string' ? input.notes.trim().slice(0, 2000) : '';
  if (!number || !issueDate) return sendJson(res, 400, { error: 'Add the COC number and issue date.' });
  let document = null;
  if (input.file) {
    try { document = await persistUpload(input.file, ['application/pdf']); }
    catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  const certificate = { id: crypto.randomUUID(), number, issueDate, notes, status: 'Issued', document, createdAt: new Date().toISOString() };
  try {
    const result = await updateStore('projects', [], (projects) => {
      const project = projects.find((item) => item.id === id);
      if (!project) return { skipSave: true, value: null };
      project.certificates = Array.isArray(project.certificates) ? project.certificates : [];
      project.certificates.unshift(certificate);
      project.updatedAt = new Date().toISOString();
      return { value: projects, certificate };
    });
    if (!result) {
      if (document) await fs.promises.rm(path.join(documentDir, document.id + storedExtension(document.type)), { force: true }).catch(() => {});
      return sendJson(res, 404, { error: 'Project not found.' });
    }
    return sendJson(res, 201, { certificate: result.certificate });
  } catch {
    if (document) await fs.promises.rm(path.join(documentDir, document.id + storedExtension(document.type)), { force: true }).catch(() => {});
    return sendJson(res, 503, { error: 'The certificate could not be saved.' });
  }
}

async function listWorkspaceInvoices(req, res, adminOnly) {
  let user;
  if (adminOnly) {
    user = adminSession(req, res);
    if (!user) return;
  } else {
    user = sessionUser(req);
    if (!user) return sendJson(res, 401, { error: 'Sign in to continue.' });
  }
  try {
    const invoices = await loadStore('invoices', []);
    if (user.role === 'admin') return sendJson(res, 200, { invoices: invoices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
    const projects = await loadStore('projects', []);
    const visibleIds = new Set(projects.filter((project) => projectVisibleTo(project, user)).map((project) => project.id));
    return sendJson(res, 200, { invoices: invoices.filter((invoice) => visibleIds.has(invoice.projectId) && !['Draft', 'Void'].includes(invoice.status)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
  } catch { return sendJson(res, 503, { error: 'Invoice records could not be loaded.' }); }
}

async function createInvoice(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Invoice request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req); } catch { return sendJson(res, 400, { error: 'Enter valid invoice details.' }); }
  const projectId = typeof input?.projectId === 'string' ? input.projectId : '';
  const clientName = typeof input?.clientName === 'string' ? input.clientName.trim().slice(0, 140) : '';
  const clientEmail = typeof input?.clientEmail === 'string' ? input.clientEmail.trim().toLowerCase().slice(0, 254) : '';
  const invoiceDate = typeof input?.invoiceDate === 'string' ? input.invoiceDate.slice(0, 10) : '';
  const dueDate = typeof input?.dueDate === 'string' ? input.dueDate.slice(0, 10) : '';
  const notes = typeof input?.notes === 'string' ? input.notes.trim().slice(0, 2000) : '';
  if (!projectId || !clientName || !invoiceDate || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50 || (clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail))) return sendJson(res, 400, { error: 'Choose a project, client, invoice date, and at least one line item.' });
  const items = [];
  for (const item of input.items) {
    const description = typeof item?.description === 'string' ? item.description.trim().slice(0, 240) : '';
    const quantity = Number(item?.quantity);
    const unitPrice = Number(item?.unitPrice);
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000 || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 100000000) return sendJson(res, 400, { error: 'Check each invoice line item and amount.' });
    const lineCents = Math.round(quantity * Math.round(unitPrice * 100));
    if (!Number.isSafeInteger(lineCents)) return sendJson(res, 400, { error: 'The invoice amount is too large.' });
    items.push({ description, quantity, unitPrice: Math.round(unitPrice * 100) / 100, lineTotal: lineCents / 100 });
  }
  const subtotalCents = items.reduce((sum, item) => sum + Math.round(item.lineTotal * 100), 0);
  if (!Number.isSafeInteger(subtotalCents)) return sendJson(res, 400, { error: 'The invoice amount is too large.' });
  const taxRate = Number(input.taxRate || 0);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return sendJson(res, 400, { error: 'Tax rate must be between 0 and 100.' });
  const taxCents = Math.round(subtotalCents * taxRate / 100);
  try {
    const project = await findProject(projectId);
    if (!project) return sendJson(res, 404, { error: 'Project not found.' });
    const settings = { ...defaultCompanySettings, ...(await loadStore('settings', defaultCompanySettings)) };
    const invoice = await updateStore('invoices', [], (invoices) => {
      const year = new Date(invoiceDate).getFullYear() || new Date().getFullYear();
      const prefix = String(settings.invoicePrefix || 'FEM').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12) || 'FEM';
      const sequence = invoices.filter((item) => item.invoiceNumber.startsWith(prefix + '-' + year + '-')).length + 1;
      const created = {
        id: crypto.randomUUID(), invoiceNumber: prefix + '-' + year + '-' + String(sequence).padStart(4, '0'),
        projectId, projectReference: project.reference, projectTitle: project.title,
        clientName, clientEmail, invoiceDate, dueDate, notes, items, taxRate,
        subtotal: subtotalCents / 100, tax: taxCents / 100, total: (subtotalCents + taxCents) / 100,
        status: 'Draft', createdAt: new Date().toISOString()
      };
      return invoices.concat(created);
    });
    return sendJson(res, 201, { invoice: invoice[invoice.length - 1] });
  } catch { return sendJson(res, 503, { error: 'The invoice could not be saved.' }); }
}

async function updateInvoiceStatus(req, res, id) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Invoice request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req); } catch { return sendJson(res, 400, { error: 'Enter a valid invoice status.' }); }
  if (!['Draft', 'Issued', 'Paid', 'Overdue', 'Void'].includes(input?.status)) return sendJson(res, 400, { error: 'Choose a valid invoice status.' });
  try {
    const result = await updateStore('invoices', [], (invoices) => {
      const invoice = invoices.find((item) => item.id === id);
      if (!invoice) return { skipSave: true, value: null };
      invoice.status = input.status;
      invoice.updatedAt = new Date().toISOString();
      return { value: invoices, invoice };
    });
    if (!result) return sendJson(res, 404, { error: 'Invoice not found.' });
    return sendJson(res, 200, { invoice: result.invoice });
  } catch { return sendJson(res, 503, { error: 'The invoice status could not be updated.' }); }
}

async function getCompanySettings(req, res) {
  if (!adminSession(req, res)) return;
  try { return sendJson(res, 200, { settings: { ...defaultCompanySettings, ...(await loadStore('settings', defaultCompanySettings)) } }); }
  catch { return sendJson(res, 503, { error: 'Company settings could not be loaded.' }); }
}

async function getWorkspaceCompany(req, res) {
  const user = sessionUser(req);
  if (!user) return sendJson(res, 401, { error: 'Sign in to continue.' });
  try {
    const settings = { ...defaultCompanySettings, ...(await loadStore('settings', defaultCompanySettings)) };
    return sendJson(res, 200, { company: {
      companyName: settings.companyName, address: settings.address, email: settings.email,
      phone: settings.phone, vatNumber: settings.vatNumber,
      logoUrl: settings.logo?.id ? '/api/files/' + settings.logo.id + '?inline=1' : ''
    } });
  } catch { return sendJson(res, 503, { error: 'Company details could not be loaded.' }); }
}

async function saveCompanySettings(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Settings request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req); } catch { return sendJson(res, 400, { error: 'Enter valid company settings.' }); }
  let settings;
  try { settings = { ...defaultCompanySettings, ...(await loadStore('settings', defaultCompanySettings)) }; }
  catch { return sendJson(res, 503, { error: 'Company settings could not be loaded.' }); }
  for (const key of ['companyName', 'address', 'email', 'phone', 'vatNumber', 'invoicePrefix']) {
    if (typeof input?.[key] === 'string') settings[key] = input[key].trim().slice(0, key === 'address' ? 300 : 180);
  }
  if (!settings.companyName || !settings.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.email)) return sendJson(res, 400, { error: 'Enter a company name and a valid company email.' });
  if (!settings.invoicePrefix) settings.invoicePrefix = 'FEM';
  try { await updateStore('settings', defaultCompanySettings, () => settings); return sendJson(res, 200, { settings }); }
  catch { return sendJson(res, 503, { error: 'Company settings could not be saved.' }); }
}

async function uploadCompanyLogo(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Logo request was rejected.' });
  if (!adminSession(req, res)) return;
  let input;
  try { input = await readJson(req, maxUploadBodyBytes); } catch { return sendJson(res, 400, { error: 'Choose a valid company logo.' }); }
  let logo;
  try { logo = await persistUpload(input?.file, ['image/png', 'image/jpeg', 'image/webp']); }
  catch (error) { return sendJson(res, 400, { error: error.message }); }
  try {
    const settings = await updateStore('settings', defaultCompanySettings, (current) => ({ ...defaultCompanySettings, ...current, logo }));
    return sendJson(res, 201, { logo, settings });
  } catch {
    await fs.promises.rm(path.join(documentDir, logo.id + storedExtension(logo.type)), { force: true }).catch(() => {});
    return sendJson(res, 503, { error: 'The company logo could not be saved.' });
  }
}

async function servePrivateFile(req, res, id, inline) {
  const user = sessionUser(req);
  if (!user) return sendJson(res, 401, { error: 'Sign in to continue.' });
  const safeId = /^[0-9a-f-]{36}$/i.test(id) ? id : '';
  if (!safeId) return sendJson(res, 404, { error: 'File not found.' });
  try {
    const projects = await loadStore('projects', []);
    let file = null;
    for (const project of projects) {
      const candidate = [...(project.documents || []), ...(project.certificates || []).map((item) => item.document).filter(Boolean)].find((item) => item.id === safeId);
      if (candidate && projectVisibleTo(project, user)) { file = candidate; break; }
    }
    if (!file) {
      const settings = { ...defaultCompanySettings, ...(await loadStore('settings', defaultCompanySettings)) };
      if (settings.logo?.id === safeId) file = settings.logo;
    }
    if (!file) return sendJson(res, 404, { error: 'File not found.' });
    const content = await fs.promises.readFile(path.join(documentDir, safeId + storedExtension(file.type)));
    res.writeHead(200, {
      'Content-Type': file.type, 'Content-Length': content.length, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': (inline && file.type.startsWith('image/')) ? 'inline' : 'attachment; filename="' + safeFileName(file.name) + '"'
    });
    return res.end(content);
  } catch { return sendJson(res, 404, { error: 'File not found.' }); }
}

function verifyPassword(password, account) {
  if (typeof password !== 'string' || password.length > 256 || typeof account?.salt !== 'string' || typeof account?.hash !== 'string') return false;
  const salt = Buffer.from(account.salt, 'hex');
  const expected = Buffer.from(account.hash, 'hex');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = crypto.scryptSync(password, salt, expected.length, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return crypto.timingSafeEqual(actual, expected);
}

function startSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { user, expiresAt: Date.now() + sessionLifetimeMs });
  const secure = process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
  res.setHeader('Set-Cookie', `formal_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeMs / 1000}${secure ? '; Secure' : ''}`);
}

function clearSession(req, res) {
  const token = parseCookies(req).formal_session || '';
  sessions.delete(token);
  const secure = process.env.COOKIE_SECURE === 'true' || (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production');
  res.setHeader('Set-Cookie', `formal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
}

async function login(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Sign-in request was rejected.' });
  if (loginRateLimited(req)) return sendJson(res, 429, { error: 'Too many sign-in attempts. Try again later.' });
  let input;
  try { input = await readJson(req); }
  catch (error) { return sendJson(res, error.status || 400, { error: 'Enter a valid email and password.' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return sendJson(res, 400, { error: 'Enter a valid email and password.' });
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = input.password;
  const requestedRole = input.role;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !['admin', 'assigned'].includes(requestedRole) || typeof password !== 'string') {
    noteLoginAttempt(req, false);
    return sendJson(res, 401, { error: 'Email, password or account type is incorrect.' });
  }
  let account;
  try { account = (await loadAccounts()).find((item) => item.email === email); }
  catch { return sendJson(res, 503, { error: 'Sign-in is temporarily unavailable.' }); }
  let verified = account && account.role === requestedRole && verifyPassword(password, account);
  if (!verified && requestedRole === 'admin') {
    try {
      await provisionConfiguredAdmin(email, password);
      account = (await loadAccounts()).find((item) => item.email === email);
      verified = account && account.role === 'admin' && verifyPassword(password, account);
    } catch { return sendJson(res, 503, { error: 'Sign-in is temporarily unavailable.' }); }
  }
  if (!verified) {
    noteLoginAttempt(req, false);
    return sendJson(res, 401, { error: 'Email, password or account type is incorrect.' });
  }
  noteLoginAttempt(req, true);
  const user = { email: account.email, role: account.role };
  startSession(res, user);
  return sendJson(res, 200, { user });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}

function setHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
}

function clientKey(req) {
  const trustedHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  const forwarded = req.headers['x-forwarded-for'];
  if (trustedHops > 0 && typeof forwarded === 'string') {
    const addresses = forwarded.split(',').map((value) => value.trim()).filter(Boolean);
    const clientIndex = Math.max(0, addresses.length - trustedHops);
    if (addresses[clientIndex]) return addresses[clientIndex];
  }
  return req.socket.remoteAddress || 'unknown';
}

function validString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

function readJson(req, bodyLimit = maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > bodyLimit) {
        tooLarge = true;
        body = '';
      }
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
      try { resolve(JSON.parse(body)); }
      catch { reject(Object.assign(new Error('Please submit a valid enquiry.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function saveEnquiry(req, res) {
  const key = clientKey(req);
  const now = Date.now();
  const existing = (submissions.get(key) || []).filter((time) => now - time < rateWindowMs);
  if (existing.length >= maxPerWindow) return sendJson(res, 429, { error: 'Too many enquiries were sent from this connection. Please try again later.' });

  let input;
  try { input = await readJson(req); }
  catch (error) { return sendJson(res, error.status || 400, { error: error.message || 'Please submit a valid enquiry.' }); }

  if (input.website) return sendJson(res, 200, { message: 'Thank you. Your enquiry has been received.' });
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const service = typeof input.service === 'string' ? input.service.trim() : '';
  const location = typeof input.location === 'string' ? input.location.trim() : '';
  const message = typeof input.message === 'string' ? input.message.trim() : '';

  if (!validString(name, 100) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !services.has(service) || !validString(message, 3000) || phone.length > 40 || location.length > 160) {
    return sendJson(res, 400, { error: 'Please check your name, email, service and message, then try again.' });
  }

  const record = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    name, email, phone, service, location, message
  };
  try {
    await fs.promises.mkdir(dataDir, { recursive: true, mode: 0o700 });
    await fs.promises.appendFile(path.join(dataDir, 'enquiries.jsonl'), `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    existing.push(now);
    submissions.set(key, existing);
    return sendJson(res, 201, { message: 'Thank you. Your enquiry has been received.' });
  } catch {
    return sendJson(res, 503, { error: 'The enquiry service is temporarily unavailable. Please try again later.' });
  }
}

function serveStatic(req, res, pathname) {
  const publicName = staticFiles.get(pathname);
  if (!publicName) { res.writeHead(404); return res.end('Not found'); }
  const filePath = path.join(root, publicName);
  fs.stat(filePath, (error, info) => {
    if (error || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  setHeaders(res);
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { return sendJson(res, 400, { error: 'Invalid request.' }); }

  if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { status: 'ok' });
  if (req.method === 'GET' && pathname === '/api/workspace/projects') return void listWorkspaceProjects(req, res);
  if (req.method === 'GET' && pathname === '/api/workspace/invoices') return void listWorkspaceInvoices(req, res, false);
  if (req.method === 'GET' && pathname === '/api/workspace/company') return void getWorkspaceCompany(req, res);
  const fileMatch = pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
  if (req.method === 'GET' && fileMatch) return void servePrivateFile(req, res, fileMatch[1], new URL(req.url, 'http://localhost').searchParams.get('inline') === '1');
  if (req.method === 'POST' && pathname === '/api/auth/setup') return void createInitialAdmin(req, res);
  if (req.method === 'POST' && pathname === '/api/auth/login') return void login(req, res);
  if (req.method === 'POST' && pathname === '/api/auth/password') return void changeAccountPassword(req, res);
  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const user = sessionUser(req);
    return user ? sendJson(res, 200, { user }) : sendJson(res, 401, { error: 'Sign in to continue.' });
  }
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Sign-out request was rejected.' });
    clearSession(req, res);
    return sendJson(res, 200, { message: 'Signed out.' });
  }
  if (req.method === 'POST' && pathname === '/api/enquiries') return void saveEnquiry(req, res);
  if (req.method === 'POST' && pathname === '/api/admin/users') return void createAssignedAccount(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/users') return void listAdminUsers(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/projects') return void listWorkspaceProjects(req, res, true);
  if (req.method === 'POST' && pathname === '/api/admin/projects') return void createProject(req, res);
  const projectWorkMatch = pathname.match(/^\/api\/admin\/projects\/([0-9a-f-]{36})\/work$/i);
  if (req.method === 'POST' && projectWorkMatch) return void addProjectWork(req, res, projectWorkMatch[1]);
  const projectDocumentMatch = pathname.match(/^\/api\/admin\/projects\/([0-9a-f-]{36})\/documents$/i);
  if (req.method === 'POST' && projectDocumentMatch) return void addProjectDocument(req, res, projectDocumentMatch[1]);
  const projectCertificateMatch = pathname.match(/^\/api\/admin\/projects\/([0-9a-f-]{36})\/certificates$/i);
  if (req.method === 'POST' && projectCertificateMatch) return void addProjectCertificate(req, res, projectCertificateMatch[1]);
  const projectMatch = pathname.match(/^\/api\/admin\/projects\/([0-9a-f-]{36})$/i);
  if (req.method === 'PATCH' && projectMatch) return void updateProject(req, res, projectMatch[1]);
  if (req.method === 'GET' && pathname === '/api/admin/invoices') return void listWorkspaceInvoices(req, res, true);
  if (req.method === 'POST' && pathname === '/api/admin/invoices') return void createInvoice(req, res);
  const invoiceMatch = pathname.match(/^\/api\/admin\/invoices\/([0-9a-f-]{36})$/i);
  if (req.method === 'PATCH' && invoiceMatch) return void updateInvoiceStatus(req, res, invoiceMatch[1]);
  if (req.method === 'GET' && pathname === '/api/admin/settings') return void getCompanySettings(req, res);
  if (req.method === 'PUT' && pathname === '/api/admin/settings') return void saveCompanySettings(req, res);
  if (req.method === 'POST' && pathname === '/api/admin/settings/logo') return void uploadCompanyLogo(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/enquiries') {
    const user = sessionUser(req);
    if (!user) return sendJson(res, 401, { error: 'Sign in to continue.' });
    if (user.role !== 'admin') return sendJson(res, 403, { error: 'Administrator access is required.' });
    return fs.promises.readFile(path.join(dataDir, 'enquiries.jsonl'), 'utf8').catch((error) => error.code === 'ENOENT' ? '' : Promise.reject(error))
      .then((content) => {
        const enquiries = content.split('\n').filter(Boolean).slice(-500).reverse().map((line) => JSON.parse(line));
        sendJson(res, 200, { enquiries });
      })
      .catch(() => sendJson(res, 503, { error: 'The enquiry records could not be read.' }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
  return serveStatic(req, res, pathname);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Formal Electrical & Maintenance is running on port ${port}.`);
});

server.on('error', (error) => {
  console.error(`Could not start the web server: ${error.message}`);
  process.exitCode = 1;
});

