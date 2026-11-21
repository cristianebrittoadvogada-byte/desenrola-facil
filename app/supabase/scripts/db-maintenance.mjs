#!/usr/bin/env node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const MAGIC = Buffer.from('DFB1');
export const RESTORE_DB_NAME = 'desenrola_homolog_restore';
export const RESTORE_CONFIRM_TOKEN = 'RESTORE_TO_HOMOLOG_ONLY';

function getKey() {
  const encoded = process.env.BACKUP_ENCRYPTION_KEY || '';
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY deve conter exatamente 32 bytes em Base64.');
  }
  return key;
}

function databaseEnvironment() {
  const required = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error('Configure as variáveis PostgreSQL exigidas no ambiente local seguro.');
  return { ...process.env, PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '10' };
}

function encryptBytes(plaintext, key, nonce = randomBytes(12)) {
  if (key.length !== 32 || nonce.length !== 12) throw new Error('Chave ou nonce inválido.');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, ciphertext, cipher.getAuthTag()]);
}

function decryptBytes(envelope, key) {
  if (envelope.length < 32 || !envelope.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Formato de backup desconhecido ou incompleto.');
  }
  const nonce = envelope.subarray(4, 16);
  const tag = envelope.subarray(envelope.length - 16);
  const ciphertext = envelope.subarray(16, envelope.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function assertRestoreTarget(env = process.env) {
  const host = String(env.PGHOST || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost','127.0.0.1','::1'].includes(host)) {
    throw new Error('Restauração bloqueada: PGHOST deve ser localhost/loopback.');
  }
  if (env.PGDATABASE !== RESTORE_DB_NAME) {
    throw new Error('Restauração bloqueada: PGDATABASE deve ser exatamente ' + RESTORE_DB_NAME + '.');
  }
  if (env.RESTORE_CONFIRM !== RESTORE_CONFIRM_TOKEN) {
    throw new Error('Restauração bloqueada: defina RESTORE_CONFIRM=' + RESTORE_CONFIRM_TOKEN + '.');
  }
}

async function spawnWithStatus(command, args, env) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-1000); });
  const [code] = await once(child, 'close');
  if (code !== 0) {
    const detail = stderr.toLowerCase().includes('password') ? ' Credenciais foram ocultadas.' : '';
    throw new Error(command + ' terminou com código ' + code + '.' + detail);
  }
}

async function backup() {
  const env = databaseEnvironment();
  const key = getKey();
  const output = resolve(process.env.BACKUP_PATH || '');
  if (!process.env.BACKUP_PATH) throw new Error('Defina BACKUP_PATH para salvar o backup fora do repositório.');
  await mkdir(dirname(output), { recursive: true });
  const payload = output + '.payload.tmp';
  const tempOutput = output + '.tmp';
  const nonce = randomBytes(12);
  let outputCreated = false;
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const args = ['--no-password', '--format=custom', '--no-owner', '--no-privileges',
    '--host', env.PGHOST, '--port', env.PGPORT || '5432', '--username', env.PGUSER, '--dbname', env.PGDATABASE];
  const child = spawn('pg_dump', args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-1000); });
  try {
    const status = once(child, 'close').then(([code]) => {
      if (code !== 0) throw new Error('pg_dump falhou. Verifique a conexão e as permissões.');
    });
    await Promise.all([
      pipeline(child.stdout, cipher, createWriteStream(payload, { flags: 'wx', mode: 0o600 })),
      status
    ]);
    const tag = cipher.getAuthTag();
    async function* envelope() {
      yield Buffer.concat([MAGIC, nonce]);
      for await (const chunk of createReadStream(payload)) yield chunk;
      yield tag;
    }
    await pipeline(Readable.from(envelope()), createWriteStream(tempOutput, { flags: 'wx', mode: 0o600 }));
    const finalStream = createWriteStream(output, { flags: 'wx', mode: 0o600 });
    finalStream.on('open', () => { outputCreated = true; });
    await pipeline(createReadStream(tempOutput), finalStream);
    await rm(tempOutput, { force: true });
    console.log('Backup lógico criptografado salvo em: ' + output);
  } catch (error) {
    child.kill();
    await rm(tempOutput, { force: true });
    if (outputCreated) await rm(output, { force: true });
    throw error;
  } finally {
    await rm(payload, { force: true });
  }
  if (stderr.toLowerCase().includes('warning')) console.warn('pg_dump emitiu um aviso; revise os logs locais.');
}

async function exportSql() {
  if (!process.env.EXPORT_PATH || process.env.EXPORT_CONFIRM !== 'EXPORT_SQL_CONTAINS_DATA') {
    throw new Error('Para exportar SQL, defina EXPORT_PATH e EXPORT_CONFIRM=EXPORT_SQL_CONTAINS_DATA.');
  }
  const env = databaseEnvironment();
  const output = resolve(process.env.EXPORT_PATH);
  await mkdir(dirname(output), { recursive: true });
  const args = ['--no-password', '--format=plain', '--no-owner', '--no-privileges',
    '--host', env.PGHOST, '--port', env.PGPORT || '5432', '--username', env.PGUSER, '--dbname', env.PGDATABASE];
  const child = spawn('pg_dump', args, { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  try {
    const status = once(child, 'close').then(([code]) => {
      if (code !== 0) throw new Error('Exportação SQL falhou.');
    });
    await Promise.all([pipeline(child.stdout, createWriteStream(output, { flags: 'wx', mode: 0o600 })), status]);
  } catch (error) {
    child.kill();
    await rm(output, { force: true });
    throw error;
  }
  console.log('Exportação SQL salva em: ' + output + '. Proteja o arquivo: ele pode conter dados pessoais.');
}

async function restore(fileArg) {
  assertRestoreTarget();
  const env = databaseEnvironment();
  const key = getKey();
  if (!fileArg) throw new Error('Informe o caminho do arquivo .dfb.');
  const file = resolve(fileArg);
  const size = (await stat(file)).size;
  if (size < 32) throw new Error('Arquivo de backup incompleto.');
  const handle = await open(file, 'r');
  const header = Buffer.alloc(16);
  const tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, 16, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, 4).equals(MAGIC)) throw new Error('Formato de backup desconhecido.');
  const nonce = header.subarray(4, 16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const tempDump = file + '.' + randomBytes(8).toString('hex') + '.restore.tmp';
  let tempDumpCreated = false;
  try {
    const dumpStream = createWriteStream(tempDump, { flags: 'wx', mode: 0o600 });
    dumpStream.on('open', () => { tempDumpCreated = true; });
    await pipeline(createReadStream(file, { start: 16, end: size - 17 }), decipher, dumpStream);
    const args = ['--exit-on-error', '--no-owner', '--no-privileges', '--single-transaction',
      '--host', env.PGHOST, '--port', env.PGPORT || '5432', '--username', env.PGUSER,
      '--dbname', RESTORE_DB_NAME, tempDump];
    await spawnWithStatus('pg_restore', args, env);
    console.log('Restauração concluída no banco isolado ' + RESTORE_DB_NAME + '.');
  } finally {
    if (tempDumpCreated) await rm(tempDump, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, file] = process.argv.slice(2);
  try {
    if (command === 'backup') await backup();
    else if (command === 'export') await exportSql();
    else if (command === 'restore') await restore(file);
    else if (command === 'self-test') {
      const key = randomBytes(32);
      const sample = Buffer.from('synthetic postgres dump content');
      const envelope = encryptBytes(sample, key);
      if (!decryptBytes(envelope, key).equals(sample)) throw new Error('Round trip falhou.');
      try { decryptBytes(envelope, randomBytes(32)); throw new Error('Chave incorreta foi aceita.'); }
      catch (error) { if (error.message === 'Chave incorreta foi aceita.') throw error; }
      try { assertRestoreTarget({ PGDATABASE: 'production', RESTORE_CONFIRM: RESTORE_CONFIRM_TOKEN }); throw new Error('Target inválido foi aceito.'); }
      catch (error) { if (error.message === 'Target inválido foi aceito.') throw error; }
      console.log('Envelope AES-256-GCM e bloqueio de destino: OK (dados sintéticos; sem banco).');
    } else {
      console.error('Uso: node scripts/db-maintenance.mjs backup|export|restore <arquivo.dfb>|self-test');
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export { encryptBytes, decryptBytes, assertRestoreTarget };

