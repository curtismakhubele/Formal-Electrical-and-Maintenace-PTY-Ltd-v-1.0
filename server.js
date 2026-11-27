const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 16 * 1024;
const rateWindowMs = 60 * 60 * 1000;
const maxPerWindow = 6;
const submissions = new Map();
const sessions = new Map();
const loginAttempts = new Map();
let accountWriteQueue = Promise.resolve();
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const authUsersPath = path.join(dataDir, 'auth-users.json');
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
  const verified = account && account.role === requestedRole && verifyPassword(password, account);
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBodyBytes) {
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
  if (req.method === 'POST' && pathname === '/api/auth/setup') return void createInitialAdmin(req, res);
  if (req.method === 'POST' && pathname === '/api/auth/login') return void login(req, res);
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

