const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const accountsPath = path.join(dataDir, 'auth-users.json');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(question).finally(() => rl.close());
}

function askHidden(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive terminal so the password can be entered without echo.'));
  }
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') return finish(new Error('Cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') {
          if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (char >= ' ' && char !== '\u007f') { value += char; process.stdout.write('*'); }
      }
    };
    process.stdin.on('data', onData);
    process.stdin.on('error', finish);
  });
}

async function readAccounts() {
  try {
    const parsed = JSON.parse(await fs.readFile(accountsPath, 'utf8'));
    if (!Array.isArray(parsed.accounts)) throw new Error('The account file has an invalid format.');
    return parsed.accounts;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function main() {
  const email = (await ask('Account email: ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  const roleChoice = (await ask('Account type (admin/assigned): ')).trim().toLowerCase();
  if (!['admin', 'assigned'].includes(roleChoice)) throw new Error('Account type must be admin or assigned.');
  const password = await askHidden('Password (minimum 14 characters): ');
  if (password.length < 14 || password.length > 256) throw new Error('Password must be between 14 and 256 characters.');
  const confirmation = await askHidden('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');

  const accounts = await readAccounts();
  if (accounts.some((item) => item.email === email)) throw new Error('An account with that email already exists.');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  accounts.push({ email, role: roleChoice, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: new Date().toISOString() });
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(accountsPath, `${JSON.stringify({ accounts }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Created ${roleChoice} account for ${email}. Password saved only as a salted scrypt hash.\n`);
  if (roleChoice === 'assigned') process.stdout.write('Assign project access in the application before sharing the login.\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
