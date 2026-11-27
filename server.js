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
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};
const services = new Set([
  'Electrical services', 'Construction & renovations', 'Project coordination',
  'Facilities maintenance', 'Plumbing & water solutions', 'Cleaning & grounds care',
  'Other / multiple services'
]);
const staticFiles = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'], ['/icon.svg', 'icon.svg'], ['/privacy.html', 'privacy.html'],
  ['/admin.html', 'admin.html'], ['/admin.css', 'admin.css'], ['/admin.js', 'admin.js']
]);

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

function tokenMatches(candidate) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (expected.length < 32 || typeof candidate !== 'string') return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readBearer(req) {
  const authorization = req.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
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
  if (req.method === 'POST' && pathname === '/api/enquiries') return void saveEnquiry(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/enquiries') {
    if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 32) return sendJson(res, 503, { error: 'Private enquiry access has not been configured.' });
    if (!tokenMatches(readBearer(req))) return sendJson(res, 401, { error: 'The access key is not valid.' });
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

