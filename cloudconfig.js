/**
 * Cloud Config — модуль облачных конфигов для Air DLC.
 *
 * Роуты:
 *   POST   /api/auth/register          — регистрация в облачной системе
 *   POST   /api/auth/login             — вход (site-аккаунт или cloud-аккаунт)
 *   POST   /api/auth/device            — запрос device-кода
 *   GET    /api/auth/device/poll?code= — опрос статуса
 *   POST   /api/auth/device/approve    — подтверждение с сайта (Bearer auth)
 *   POST   /api/auth/refresh           — обновление access-токена
 *   GET    /api/configs                — список конфигов юзера
 *   GET    /api/configs/:id            — получить конфиг
 *   POST   /api/configs                — создать/обновить конфиг
 *   DELETE /api/configs/:id            — удалить конфиг
 *
 * Авторизация: JWT HS256 (access 15 мин + refresh 30 дней).
 * Хранение: JSON-файлы через storage.js (atomicWrite / safeRead).
 * Пароли: scrypt (соль + хэш).
 */
const crypto = require('crypto');
const path = require('path');
const storage = require('./storage');

const BASE_DIR = storage.BASE_DIR;
const USERS_FILE = path.join(BASE_DIR, 'cloud_users.json');
const CONFIGS_FILE = path.join(BASE_DIR, 'cloud_configs.json');
const DEVICES_FILE = path.join(BASE_DIR, 'cloud_devices.json');

const JWT_SECRET = process.env.JWT_SECRET
  || crypto.createHash('sha256').update(process.env.SITE_URL || 'airdlc-cloud').digest('hex');
const ACCESS_TTL = 15 * 60;
const REFRESH_TTL = 30 * 24 * 60 * 60;
const DEVICE_TTL = 5 * 60;

// === Хранилище ===

function readUsers() {
  const d = storage.safeRead(USERS_FILE, { users: [] });
  if (!Array.isArray(d.users)) d.users = [];
  return d.users;
}

function writeUsers(users) {
  storage.atomicWrite(USERS_FILE, { users });
}

function readConfigs() {
  const d = storage.safeRead(CONFIGS_FILE, { configs: [] });
  if (!Array.isArray(d.configs)) d.configs = [];
  return d.configs;
}

function writeConfigs(configs) {
  storage.atomicWrite(CONFIGS_FILE, { configs });
}

function readDevices() {
  const d = storage.safeRead(DEVICES_FILE, { devices: {} });
  if (!d.devices || typeof d.devices !== 'object') d.devices = {};
  return d.devices;
}

function writeDevices(devices) {
  storage.atomicWrite(DEVICES_FILE, { devices });
}

// === Пароли (scrypt) ===

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  }
  return false;
}

// === JWT ===

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + (payload.ttl || ACCESS_TTL) };
  const headerB64 = base64url(JSON.stringify(header));
  const bodyB64 = base64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${bodyB64}`).digest();
  return `${headerB64}.${bodyB64}.${base64url(sig)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest();
  const actual = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueTokens(user) {
  const access = signToken({ sub: user.id, username: user.username, typ: 'access', ttl: ACCESS_TTL });
  const refresh = signToken({ sub: user.id, username: user.username, typ: 'refresh', ttl: REFRESH_TTL });
  return { access, refresh };
}

// === Аутентификация Bearer ===

function authUser(req) {
  const header = req.headers['authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  // 1. Cloud JWT
  const payload = verifyToken(token);
  if (payload && payload.typ === 'access') {
    const users = readUsers();
    const user = users.find(u => u.id === payload.sub);
    if (user) return { user, source: 'cloud' };
  }

  // 2. Site session token (tokens.json)
  const siteTokens = storage.rt();
  const siteToken = siteTokens[token];
  if (siteToken && siteToken.username) {
    const d = storage.rd();
    const siteUser = d.users.find(u => u.username.toLowerCase() === siteToken.username.toLowerCase());
    if (siteUser) {
      const cloudUser = ensureCloudUser(siteUser.username, siteUser.email, null);
      return { user: cloudUser, source: 'site' };
    }
  }

  return null;
}

function ensureCloudUser(username, email, password) {
  const users = readUsers();
  let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      username,
      email: email || `${username}@airdlc.local`,
      password_hash: password ? hashPassword(password) : null,
      created_at: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);
  } else if (password && !user.password_hash) {
    user.password_hash = hashPassword(password);
    writeUsers(users);
  }
  return user;
}

function authenticateLogin(username, password) {
  // 1. Cloud users
  const users = readUsers();
  let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (user && user.password_hash && verifyPassword(password, user.password_hash)) {
    return user;
  }

  // 2. Site users (legacy plaintext, миграция при первом входе)
  const d = storage.rd();
  const siteUser = d.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (siteUser && siteUser.password === password) {
    return ensureCloudUser(siteUser.username, siteUser.email, password);
  }

  return null;
}

// === Rate limiting ===

const rateBuckets = {};

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  if (!rateBuckets[key]) rateBuckets[key] = [];
  rateBuckets[key] = rateBuckets[key].filter(t => now - t < windowMs);
  if (rateBuckets[key].length >= max) return false;
  rateBuckets[key].push(now);
  return true;
}

// === HTTP helpers ===

function sendJson(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(resolve => {
    let buf = '';
    req.on('data', chunk => {
      buf += chunk;
      if (buf.length > 65536) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(buf || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) code += chars[bytes[i] % chars.length];
  return code;
}

function genId() {
  return crypto.randomUUID();
}

function shortId(id) {
  return (id || '').slice(0, 8);
}

// === Роуты ===

async function handleAuthRegister(req, res, body) {
  const username = (body.username || '').trim();
  const email = (body.email || '').trim();
  const password = body.password || '';

  if (!username || username.length < 3 || username.length > 32) {
    return sendJson(res, 400, { error: 'Имя пользователя: 3–32 символа' });
  }
  if (!/^[\w.\-]+$/.test(username)) {
    return sendJson(res, 400, { error: 'Только буквы, цифры, точка, дефис, подчёркивание' });
  }
  if (password.length < 6) {
    return sendJson(res, 400, { error: 'Пароль: минимум 6 символов' });
  }

  const users = readUsers();
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return sendJson(res, 409, { error: 'Имя уже занято' });
  }
  const d = storage.rd();
  if (d.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return sendJson(res, 409, { error: 'Имя уже занято' });
  }

  const user = {
    id: genId(),
    username,
    email: email || `${username}@airdlc.local`,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);

  const tokens = issueTokens(user);
  sendJson(res, 200, {
    user: { id: user.id, username: user.username, email: user.email },
    token: tokens.access,
    refresh_token: tokens.refresh,
  });
}

async function handleAuthLogin(req, res, body) {
  const username = (body.username || '').trim();
  const password = body.password || '';

  if (!username || !password) {
    return sendJson(res, 400, { error: 'Укажи имя пользователя и пароль' });
  }

  const user = authenticateLogin(username, password);
  if (!user) {
    return sendJson(res, 401, { error: 'Неверное имя пользователя или пароль' });
  }

  const tokens = issueTokens(user);
  sendJson(res, 200, {
    user: { id: user.id, username: user.username, email: user.email },
    token: tokens.access,
    refresh_token: tokens.refresh,
  });
}

async function handleDevice(req, res, body) {
  const hwid = (body.hwid || '').slice(0, 256);
  const username = (body.username || '').slice(0, 64);

  const code = genCode();
  const deviceCode = genId();

  const devices = readDevices();
  devices[code] = {
    code,
    device_code: deviceCode,
    hwid,
    username,
    status: 'pending',
    user_id: null,
    tokens: null,
    created_at: Date.now(),
    expires_at: Date.now() + DEVICE_TTL * 1000,
  };
  writeDevices(devices);

  sendJson(res, 200, {
    code,
    device_code: deviceCode,
    expires_in: DEVICE_TTL,
    interval: 3,
  });
}

async function handleDevicePoll(req, res, code) {
  if (!code || typeof code !== 'string') {
    return sendJson(res, 400, { error: 'code required' });
  }

  const devices = readDevices();
  const device = devices[code];

  if (!device) {
    return sendJson(res, 404, { error: 'Код не найден', status: 'invalid' });
  }

  if (Date.now() > device.expires_at) {
    delete devices[code];
    writeDevices(devices);
    return sendJson(res, 410, { error: 'Код истёк', status: 'expired' });
  }

  if (device.status === 'approved' && device.tokens) {
    const { tokens, username } = device;
    return sendJson(res, 200, {
      status: 'approved',
      token: tokens.access,
      refresh_token: tokens.refresh,
      username,
    });
  }

  sendJson(res, 200, { status: device.status });
}

async function handleDeviceApprove(req, res, body) {
  const code = (body.code || '').trim().toUpperCase();
  if (!code) return sendJson(res, 400, { error: 'code required' });

  const auth = authUser(req);
  if (!auth) return sendJson(res, 401, { error: 'Требуется авторизация на сайте' });

  const devices = readDevices();
  const device = devices[code];

  if (!device) return sendJson(res, 404, { error: 'Код не найден' });
  if (Date.now() > device.expires_at) {
    delete devices[code];
    writeDevices(devices);
    return sendJson(res, 410, { error: 'Код истёк' });
  }
  if (device.status === 'approved') {
    return sendJson(res, 409, { error: 'Код уже использован' });
  }

  const tokens = issueTokens(auth.user);
  device.status = 'approved';
  device.user_id = auth.user.id;
  device.tokens = tokens;
  device.username = auth.user.username;
  writeDevices(devices);

  sendJson(res, 200, {
    ok: true,
    message: `Устройство привязано к ${auth.user.username}`,
    username: auth.user.username,
  });
}

async function handleRefresh(req, res, body) {
  const refreshToken = body.refresh_token || '';
  if (!refreshToken) return sendJson(res, 400, { error: 'refresh_token required' });

  const payload = verifyToken(refreshToken);
  if (!payload || payload.typ !== 'refresh') {
    return sendJson(res, 401, { error: 'Недействительный refresh-токен' });
  }

  const users = readUsers();
  const user = users.find(u => u.id === payload.sub);
  if (!user) return sendJson(res, 401, { error: 'Пользователь не найден' });

  const tokens = issueTokens(user);
  sendJson(res, 200, { token: tokens.access, refresh_token: tokens.refresh });
}

// === Конфиги ===

function filterConfigsForUser(configs, userId) {
  return configs
    .filter(c => c.user_id === userId)
    .map(({ data, ...meta }) => meta)
    .sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
}

async function handleConfigsList(req, res) {
  const auth = authUser(req);
  if (!auth) return sendJson(res, 401, { error: 'Требуется авторизация' });

  if (!rateLimit(`list:${auth.user.id}`, 60, 60000)) {
    return sendJson(res, 429, { error: 'Слишком много запросов' });
  }

  const configs = readConfigs();
  sendJson(res, 200, { configs: filterConfigsForUser(configs, auth.user.id) });
}

async function handleConfigGet(req, res, id) {
  const auth = authUser(req);
  if (!auth) return sendJson(res, 401, { error: 'Требуется авторизация' });

  const configs = readConfigs();
  const config = configs.find(c => c.id === id && c.user_id === auth.user.id);
  if (!config) return sendJson(res, 404, { error: 'Конфиг не найден' });

  const { data, ...meta } = config;
  sendJson(res, 200, { ...meta, data });
}

async function handleConfigCreate(req, res, body) {
  const auth = authUser(req);
  if (!auth) return sendJson(res, 401, { error: 'Требуется авторизация' });

  if (!rateLimit(`create:${auth.user.id}`, 30, 60000)) {
    return sendJson(res, 429, { error: 'Слишком много запросов' });
  }

  const name = (body.name || '').trim();
  if (!name || name.length > 128) {
    return sendJson(res, 400, { error: 'Название обязательно (до 128 символов)' });
  }
  if (!body.data || typeof body.data !== 'object') {
    return sendJson(res, 400, { error: 'Поле data обязательно' });
  }

  const configs = readConfigs();
  const now = new Date().toISOString();

  // Если передан id — обновляем существующий
  if (body.id) {
    const existing = configs.find(c => c.id === body.id && c.user_id === auth.user.id);
    if (!existing) return sendJson(res, 404, { error: 'Конфиг не найден' });
    existing.name = name;
    existing.data = body.data;
    existing.author = auth.user.username;
    existing.updated_at = now;
    writeConfigs(configs);
    const { data, ...meta } = existing;
    return sendJson(res, 200, { ...meta, data });
  }

  const config = {
    id: genId(),
    user_id: auth.user.id,
    name,
    author: auth.user.username,
    data: body.data,
    created_at: now,
    updated_at: now,
  };
  configs.push(config);
  writeConfigs(configs);

  const { data, ...meta } = config;
  sendJson(res, 200, { ...meta, data });
}

async function handleConfigDelete(req, res, id) {
  const auth = authUser(req);
  if (!auth) return sendJson(res, 401, { error: 'Требуется авторизация' });

  const configs = readConfigs();
  const idx = configs.findIndex(c => c.id === id && c.user_id === auth.user.id);
  if (idx === -1) return sendJson(res, 404, { error: 'Конфиг не найден' });

  configs.splice(idx, 1);
  writeConfigs(configs);
  sendJson(res, 200, { ok: true });
}

// === Главный обработчик ===

async function handle(req, res, url, params) {
  const method = req.method;

  if (url === '/api/auth/register' && method === 'POST') {
    const body = await readBody(req);
    if (!body) return sendJson(res, 400, { error: 'Некорректный JSON' });
    await handleAuthRegister(req, res, body);
    return true;
  }

  if (url === '/api/auth/login' && method === 'POST') {
    if (!rateLimit('login', 10, 60000)) return sendJson(res, 429, { error: 'Подожди минуту' });
    const body = await readBody(req);
    if (!body) return sendJson(res, 400, { error: 'Некорректный JSON' });
    await handleAuthLogin(req, res, body);
    return true;
  }

  if (url === '/api/auth/device' && method === 'POST') {
    if (!rateLimit('device', 10, 60000)) return sendJson(res, 429, { error: 'Подожди' });
    const body = await readBody(req);
    if (!body) return sendJson(res, 400, { error: 'Некорректный JSON' });
    await handleDevice(req, res, body);
    return true;
  }

  if (url === '/api/auth/device/poll' && method === 'GET') {
    await handleDevicePoll(req, res, params.code);
    return true;
  }

  if (url === '/api/auth/device/approve' && method === 'POST') {
    const body = await readBody(req);
    if (!body) return sendJson(res, 400, { error: 'Некорректный JSON' });
    await handleDeviceApprove(req, res, body);
    return true;
  }

  if (url === '/api/auth/refresh' && method === 'POST') {
    const body = await readBody(req);
    if (!body) return sendJson(res, 400, { error: 'Некорректный JSON' });
    await handleRefresh(req, res, body);
    return true;
  }

  if (url === '/api/configs' && method === 'GET') {
    await handleConfigsList(req, res);
    return true;
  }

  if (url === '/api/configs' && method === 'POST') {
    const body = await readBody(req);
    if (!body) return sendJson(res, 400, { error: 'Некорректный JSON' });
    await handleConfigCreate(req, res, body);
    return true;
  }

  const configMatch = url.match(/^\/api\/configs\/([\w-]+)$/);
  if (configMatch && method === 'GET') {
    await handleConfigGet(req, res, configMatch[1]);
    return true;
  }
  if (configMatch && method === 'DELETE') {
    await handleConfigDelete(req, res, configMatch[1]);
    return true;
  }

  return false;
}

module.exports = { handle };
