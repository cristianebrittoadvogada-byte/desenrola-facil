import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

test('local app: setup, auth, encrypted persistence and integration boundaries', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'desenrola-smoke-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(APP_DIR, 'server.mjs')], {
    cwd: APP_DIR,
    env: { ...process.env, DESENROLA_PORT: String(port), DESENROLA_DATA_DIR: tempDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.on('error', error => { output += `spawn error: ${error.message}`; });
  try {
    let ready = false;
    for (let i = 0; i < 300; i += 1) {
      if (child.exitCode !== null) throw new Error(`Server saiu antes de iniciar: ${output}`);
      try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    assert.equal(ready, true, `Server não iniciou: ${output}`);
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.externalServices, 'not connected');
    assert.equal((await fetch(`${base}/api/data`)).status, 401);

    const password = 'Senha-Forte-Local-2026!';
    const setup = await fetch(`${base}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    assert.equal(setup.status, 201);
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const initial = await (await fetch(`${base}/api/data`, { headers: { cookie } })).json();
    assert.equal(initial.products.length, 4);
    assert.equal(initial.appointments[0].status, 'Concluída');
    assert.equal(initial.integrations.every(item => item.enabled === false), true);

    initial.contacts.push({ id: 'TEST-PERSON', name: 'Pessoa Teste', email: 'smoke-test@example.invalid', profile: 'Lead', source: 'Site', stage: 'Novo' });
    initial.transactions.push({ id: 'TEST-FIN', kind: 'Receita', description: 'Teste', amountCents: 10000, date: '2026-11-19', status: 'Pendente', paymentMethod: 'PIX' });
    const saved = await fetch(`${base}/api/data`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(initial) });
    assert.equal(saved.status, 200);
    const storedText = readFileSync(join(tempDir, 'company.json'), 'utf8');
    const stored = JSON.parse(storedText);
    assert.equal(stored.encrypted, true);
    assert.equal(stored.algorithm, 'aes-256-gcm');
    assert.equal(storedText.includes('smoke-test@example.invalid'), false);

    await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    assert.equal((await fetch(`${base}/api/data`, { headers: { cookie } })).status, 401);
    const wrong = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'senha-errada-xyz' }) });
    assert.equal(wrong.status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    assert.equal(login.status, 200);
    const freshCookie = login.headers.get('set-cookie').split(';')[0];
    const persisted = await (await fetch(`${base}/api/data`, { headers: { cookie: freshCookie } })).json();
    assert.equal(persisted.contacts[0].email, 'smoke-test@example.invalid');
    assert.equal(persisted.transactions[0].status, 'Pendente');
    assert.equal((await fetch(`${base}/styles.css`)).status, 200);
    const traversal = await fetch(`${base}/%2e%2e%5cserver.mjs`);
    assert.equal(traversal.status, 403);
  } finally {
    child.kill();
    await new Promise(resolveWait => {
      if (child.exitCode !== null) return resolveWait();
      child.once('exit', resolveWait); setTimeout(resolveWait, 1500);
    });
    const resolvedTemp = resolve(tempDir);
    const resolvedTmpRoot = resolve(tmpdir());
    if (resolvedTemp.startsWith(resolvedTmpRoot) && resolvedTemp.includes('desenrola-smoke-')) rmSync(resolvedTemp, { recursive: true, force: true });
  }
});
