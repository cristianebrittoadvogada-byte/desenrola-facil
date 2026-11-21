import http from 'node:http';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = process.env.DESENROLA_DATA_DIR || join(ROOT, 'data');
const PORT = Number(process.env.DESENROLA_PORT || 4177);
const HOST = '127.0.0.1';
const SESSION_HOURS = 8;
const sessions = new Map();
const attempts = new Map();
mkdirSync(DATA_DIR, { recursive: true });

const authPath = join(DATA_DIR, 'auth.json');
const dataPath = join(DATA_DIR, 'company.json');

const initialData = () => ({
  schemaVersion: 1,
  organization: {
    name: 'Desenrola Fácil®', founder: 'Cristiane Britto Barbosa', methodology: 'PPDD®',
    email: 'desenrolafaciljud@gmail.com',
    instagram: 'https://www.instagram.com/cristianebritto.desenrola/',
    whatsapp: '+55 21 96737-1083',
    website: 'https://desenrolafacil.my.canva.site/cristiane-britto',
    city: 'Rio de Janeiro/RJ', currency: 'BRL'
  },
  products: [
    { id: 'MENTORIA-DESENROLA-FACIL', name: 'Mentoria Desenrola Fácil', priceCents: 300000, currency: 'BRL', format: 'Individual e coletivo', modality: 'Online', duration: '3 meses', active: true, notes: 'Confirmar se o valor se aplica igualmente aos dois formatos.' },
    { id: 'LIVRO', name: 'Livro', priceCents: 6990, currency: 'BRL', format: 'Produto editorial', modality: 'Online e canais digitais', duration: 'Não se aplica', active: true, notes: 'Cadastrar título/edição, estoque ou formato digital, frete e entrega.' },
    { id: 'CONSTELACAO-ONLINE', name: 'Constelação Sistêmica Online', priceCents: 79999, currency: 'BRL', format: 'Atendimento individual', modality: 'Online', duration: 'Sessão; tempo a definir', active: true, notes: 'Definir duração e política de agendamento/cancelamento.' },
    { id: 'CONSTELACAO-PRESENCIAL', name: 'Constelação Sistêmica Presencial', priceCents: 99999, currency: 'BRL', format: 'Atendimento individual', modality: 'Presencial — Rio de Janeiro/RJ', duration: 'Sessão; tempo a definir', active: true, notes: 'Definir duração, local de atendimento e política de agendamento/cancelamento.' }
  ],
  contacts: [], sales: [], transactions: [], mentorships: [],
  appointments: [{ id: 'EVENTO-REFERENCIA-2026-11', title: 'O LUGAR QUE É MEU — edição de referência', type: 'Vivência', start: '2026-11-13T09:00', end: '2026-11-15T18:00', location: 'Barra de Guaratiba, Rio de Janeiro/RJ', status: 'Concluída', contactId: '', notes: 'Edição realizada. Completar retrospectiva com dados reais disponíveis; não reabrir inscrições.' }],
  integrations: [
    { id: 'gmail', name: 'Gmail atual', status: 'Manual', enabled: false, notes: 'E-mail de contato informado; sem sincronização automatizada.' },
    { id: 'whatsapp', name: 'WhatsApp comercial', status: 'Manual', enabled: false, notes: 'Usar o número atual. Nenhuma API ou automação conectada.' },
    { id: 'website', name: 'Canva Sites', status: 'Manual', enabled: false, notes: 'Site institucional; direcionamento para contato é manual até implementar conexão.' },
    { id: 'google-workspace', name: 'Google Workspace', status: 'Não contratado', enabled: false, notes: 'Integração futura opcional; não há conta contratada/configurada para este projeto.' },
    { id: 'kommo', name: 'Kommo CRM', status: 'Não contratado', enabled: false, notes: 'Integração futura opcional; nenhum dado sincronizado.' },
    { id: 'asaas', name: 'Asaas', status: 'Não contratado', enabled: false, notes: 'Integração futura para cobrança/webhooks; nenhuma conta conectada.' },
    { id: 'whatsapp-business-api', name: 'WhatsApp Business API', status: 'Não conectado', enabled: false, notes: 'Avaliar requisitos e impacto no número antes de qualquer conexão.' }
  ],
  updatedAt: new Date().toISOString()
});

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function json(res, status, value, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(value));
}
function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) { reject(new Error('Corpo da requisição muito grande.')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}
function cookieValue(req, key) {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${key}=`));
  return item ? decodeURIComponent(item.slice(key.length + 1)) : '';
}
function currentSession(req) {
  const token = cookieValue(req, 'df_session');
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) { sessions.delete(token); return null; }
  session.expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  return { token, session };
}
function requireAuth(req, res) {
  const found = currentSession(req);
  if (!found) { json(res, 401, { error: 'Faça login para continuar.' }); return null; }
  return found;
}
function tooManyAttempts(req) {
  const ip = req.socket.remoteAddress || 'local';
  const entry = attempts.get(ip) || { count: 0, until: Date.now() + 60_000 };
  if (entry.until < Date.now()) { entry.count = 0; entry.until = Date.now() + 60_000; }
  entry.count += 1;
  attempts.set(ip, entry);
  return entry.count > 12;
}
function setSession(res, token) {
  res.setHeader('Set-Cookie', `df_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 60 * 60}`);
}
function encryptData(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return { encrypted: true, algorithm: 'aes-256-gcm', iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: encrypted.toString('base64') };
}
function decryptData(key) {
  if (!existsSync(dataPath)) return initialData();
  const stored = readJson(dataPath, null);
  if (!stored?.encrypted) return stored || initialData();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}
function saveData(data, key) {
  const tempPath = `${dataPath}.tmp`;
  data.updatedAt = new Date().toISOString();
  writeFileSync(tempPath, JSON.stringify(encryptData(data, key), null, 2), 'utf8');
  renameSync(tempPath, dataPath);
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, host: HOST, externalServices: 'not connected' });
    if (url.pathname === '/api/auth/status' && req.method === 'GET') return json(res, 200, { configured: existsSync(authPath), authenticated: Boolean(currentSession(req)) });
    if (url.pathname === '/api/auth/setup' && req.method === 'POST') {
      if (existsSync(authPath)) return json(res, 409, { error: 'A senha inicial já foi criada.' });
      const body = await readBody(req, 5000);
      if (typeof body.password !== 'string' || body.password.length < 12) return json(res, 400, { error: 'Use uma senha com pelo menos 12 caracteres.' });
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(body.password, salt, 64).toString('hex');
      const dataSalt = randomBytes(16).toString('hex');
      const key = scryptSync(body.password, dataSalt, 32);
      writeFileSync(authPath, JSON.stringify({ algorithm: 'scrypt', salt, hash, dataSalt, createdAt: new Date().toISOString() }, null, 2), 'utf8');
      saveData(initialData(), key);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { expires: Date.now() + SESSION_HOURS * 60 * 60 * 1000, key });
      setSession(res, token);
      return json(res, 201, { authenticated: true });
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (tooManyAttempts(req)) return json(res, 429, { error: 'Muitas tentativas. Aguarde um minuto.' });
      const body = await readBody(req, 5000);
      const saved = readJson(authPath, null);
      if (!saved) return json(res, 409, { error: 'Configure a senha inicial primeiro.' });
      const submitted = scryptSync(String(body.password || ''), saved.salt, 64);
      const expected = Buffer.from(saved.hash, 'hex');
      if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) return json(res, 401, { error: 'Senha incorreta.' });
      const key = scryptSync(String(body.password || ''), saved.dataSalt, 32);
      decryptData(key);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { expires: Date.now() + SESSION_HOURS * 60 * 60 * 1000, key });
      setSession(res, token);
      return json(res, 200, { authenticated: true });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const found = currentSession(req);
      if (found) sessions.delete(found.token);
      res.setHeader('Set-Cookie', 'df_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res, 200, { authenticated: false });
    }
    if (url.pathname === '/api/data' && req.method === 'GET') {
      const found = requireAuth(req, res);
      if (!found) return;
      return json(res, 200, decryptData(found.session.key));
    }
    if (url.pathname === '/api/data' && req.method === 'PUT') {
      const found = requireAuth(req, res);
      if (!found) return;
      const body = await readBody(req);
      const required = ['organization', 'products', 'contacts', 'sales', 'transactions', 'mentorships', 'appointments', 'integrations'];
      if (!body || required.some(key => !(key in body)) || required.slice(1).some(key => !Array.isArray(body[key]))) {
        return json(res, 400, { error: 'Estrutura de dados inválida.' });
      }
      body.schemaVersion = 1;
      saveData(body, found.session.key);
      return json(res, 200, { saved: true, updatedAt: body.updatedAt });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Rota não encontrada.' });

    const relative = url.pathname === '/' ? 'index.html' : normalize(decodeURIComponent(url.pathname).replace(/^[/\\]+/, ''));
    const file = resolve(PUBLIC_DIR, relative);
    if (file !== PUBLIC_DIR && !file.startsWith(`${PUBLIC_DIR}${sep}`)) return json(res, 403, { error: 'Acesso negado.' });
    if (!existsSync(file)) return json(res, 404, { error: 'Arquivo não encontrado.' });
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(file));
  } catch (error) {
    if (!res.headersSent) json(res, 400, { error: error.message || 'Não foi possível processar a solicitação.' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`Desenrola Fácil local: http://${HOST}:${PORT}`));
