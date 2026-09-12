const fs = require('fs');
const path = require('path');
const https = require('https');

// === Load .env if exists (для локального теста и бесплатного тарифа) ===
(function loadEnv(){
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line=>{
        line=line.trim();
        if(!line || line.startsWith('#')) return;
        const eq=line.indexOf('=');
        if(eq===-1) return;
        const k=line.slice(0,eq).trim();
        let v=line.slice(eq+1).trim();
        if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
        if(!(k in process.env)) process.env[k]=v;
      });
      console.log('[env] loaded .env');
    }
  } catch(e){ console.error('[env] load failed', e.message); }
})();

// === Persistent storage resolution ===
// Приоритет для бесплатного тарифа (без диска):
// 1. Upstash Redis REST (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) — рекомендуется для free tier, 10k запросов/день бесплатно, без карты
// 2. Render Disk (DATA_DIR=/data)
// 3. Локальный файл рядом с server.js (теряется на free tier без Upstash, но keep-alive помогает)

function resolveBaseDir() {
  const candidates = [
    process.env.DATA_DIR,
    '/data',
    path.join(__dirname, 'data'),
    __dirname
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        try { fs.accessSync(dir, fs.constants.W_OK); return dir; } catch {}
      }
    } catch {}
  }
  if (process.env.DATA_DIR) {
    try { fs.mkdirSync(process.env.DATA_DIR, { recursive: true }); return process.env.DATA_DIR; } catch {}
  }
  if (fs.existsSync('/data')) {
    try { fs.accessSync('/data', fs.constants.W_OK); return '/data'; } catch {}
  }
  return __dirname;
}

const BASE_DIR = resolveBaseDir();
const DF = path.join(BASE_DIR, 'data.json');
const TF = path.join(BASE_DIR, 'tokens.json');
const UF = path.join(BASE_DIR, 'updates.json');
const UD = path.join(BASE_DIR, 'updates');
const CF = path.join(BASE_DIR, 'chat.json');
const SF = path.join(BASE_DIR, 'support.json');

console.log(`[storage] BASE_DIR=${BASE_DIR}`);
console.log(`[storage] DF=${DF} TF=${TF} UF=${UF} UD=${UD} CF=${CF} SF=${SF}`);

if (!fs.existsSync(UD)) {
  try { fs.mkdirSync(UD, { recursive: true }); } catch (e) { console.error('[storage] mkdir UD failed', e.message); }
}

function migrateIfNeeded(target, fallback) {
  if (target === fallback) return;
  try {
    if (!fs.existsSync(target) && fs.existsSync(fallback)) {
      fs.copyFileSync(fallback, target);
      console.log(`[storage] migrated ${fallback} -> ${target}`);
      if (target === DF) {
        const srcUD = path.join(__dirname, 'updates');
        if (fs.existsSync(srcUD)) {
          try {
            const files = fs.readdirSync(srcUD);
            for (const f of files) {
              const src = path.join(srcUD, f);
              const dst = path.join(UD, f);
              if (!fs.existsSync(dst) && fs.statSync(src).isFile()) {
                fs.copyFileSync(src, dst);
                console.log(`[storage] migrated update file ${f}`);
              }
            }
          } catch {}
        }
        const srcUF = path.join(__dirname, 'updates.json');
        const dstUF = UF;
        if (fs.existsSync(srcUF) && !fs.existsSync(dstUF)) {
          fs.copyFileSync(srcUF, dstUF);
          console.log(`[storage] migrated updates.json`);
        }
        const srcTF = path.join(__dirname, 'tokens.json');
        const dstTF = TF;
        if (fs.existsSync(srcTF) && !fs.existsSync(dstTF)) {
          fs.copyFileSync(srcTF, dstTF);
          console.log(`[storage] migrated tokens.json`);
        }
      }
    }
  } catch (e) {
    console.error('[storage] migrate failed', e.message);
  }
}

migrateIfNeeded(DF, path.join(__dirname, 'data.json'));
migrateIfNeeded(TF, path.join(__dirname, 'tokens.json'));
migrateIfNeeded(UF, path.join(__dirname, 'updates.json'));
migrateIfNeeded(CF, path.join(__dirname, 'chat.json'));
migrateIfNeeded(SF, path.join(__dirname, 'support.json'));

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
    if (BASE_DIR !== __dirname) {
      const mirror = path.join(__dirname, path.basename(filePath));
      if (filePath.endsWith('.json')) {
        try { fs.writeFileSync(mirror, JSON.stringify(data, null, 2), 'utf8'); } catch {}
      }
    }
  } catch (e) {
    console.error(`[storage] write failed ${filePath}:`, e.message);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8'); } catch (e2) { console.error('[storage] fallback write also failed', e2.message); }
  }
}

function safeRead(filePath, fallbackValue) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw.trim()) return JSON.parse(raw);
    }
  } catch (e) {
    console.error(`[storage] read failed ${filePath}:`, e.message);
  }
  if (BASE_DIR !== __dirname) {
    const mirror = path.join(__dirname, path.basename(filePath));
    try {
      if (fs.existsSync(mirror)) {
        const raw = fs.readFileSync(mirror, 'utf8');
        if (raw.trim()) {
          const data = JSON.parse(raw);
          console.log(`[storage] fallback read from ${mirror}`);
          try { atomicWrite(filePath, data); } catch {}
          return data;
        }
      }
    } catch {}
  }
  return fallbackValue;
}

function rd() {
  const d = safeRead(DF, { users: [], keys: [], seeded: false, telegramIssued: {} });
  if (!Array.isArray(d.users)) d.users = [];
  if (!Array.isArray(d.keys)) d.keys = [];
  if (typeof d.seeded !== 'boolean') d.seeded = false;
  if (!d.telegramIssued || typeof d.telegramIssued !== 'object') d.telegramIssued = {};
  return d;
}
function wd(d) {
  atomicWrite(DF, d);
  // async backup to Upstash if configured (fire and forget, не блокируем)
  if (upstashEnabled) {
    backupUpstash('airdlc:data', d).catch(e=>console.error('[storage] upstash backup data failed', e.message));
  }
  if (gistEnabled) {
    backupGist(d).catch(e=>console.error('[storage] gist backup failed', e.message));
  }
}

function rt() { return safeRead(TF, {}); }
function wt(t) {
  atomicWrite(TF, t);
  if (upstashEnabled) backupUpstash('airdlc:tokens', t).catch(()=>{});
}
function ru() { const u = safeRead(UF, []); return Array.isArray(u) ? u : []; }
function wu(u) {
  atomicWrite(UF, u);
  if (upstashEnabled) backupUpstash('airdlc:updates', u).catch(()=>{});
}

function rc() { const c = safeRead(CF, []); return Array.isArray(c) ? c : []; }
function wc(c) {
  // keep last 500 messages max
  if (c.length > 500) c = c.slice(-500);
  atomicWrite(CF, c);
  if (upstashEnabled) backupUpstash('airdlc:chat', c).catch(()=>{});
}

function rs() { const s = safeRead(SF, []); return Array.isArray(s) ? s : []; }
function ws(s) {
  atomicWrite(SF, s);
  if (upstashEnabled) backupUpstash('airdlc:support', s).catch(()=>{});
}

// === Upstash Redis REST (бесплатный тариф, без диска) ===
let UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
let UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
// Fallback: поддержка redis:// URL (на случай если скопировал Redis URL вместо REST)
if (!UPSTASH_URL && process.env.REDIS_URL) {
  try { const u=new URL(process.env.REDIS_URL); if(u.hostname.includes('upstash')){ UPSTASH_URL=`https://${u.hostname}`; UPSTASH_TOKEN=u.password || UPSTASH_TOKEN; } } catch {}
}
if (!UPSTASH_URL && process.env.UPSTASH_REDIS_URL) {
  try { const u=new URL(process.env.UPSTASH_REDIS_URL); if(u.protocol.startsWith('redis')){ UPSTASH_URL=`https://${u.hostname}`; UPSTASH_TOKEN=u.password || UPSTASH_TOKEN; } else { UPSTASH_URL=u.href.replace(/\/$/,''); } } catch {}
}
// Также поддержка если токен дали отдельно
if (!UPSTASH_TOKEN && process.env.UPSTASH_TOKEN) UPSTASH_TOKEN=process.env.UPSTASH_TOKEN;

const upstashEnabled = !!(UPSTASH_URL && UPSTASH_TOKEN);
if (upstashEnabled) {
  console.log(`[storage] Upstash enabled: ${UPSTASH_URL}`);
} else {
  console.log('[storage] Upstash disabled — для бесплатного тарифа без потери данных создай Upstash Redis (см. инструкцию) и задай UPSTASH_REDIS_REST_URL + TOKEN');
  if (!process.env.DATA_DIR && !fs.existsSync('/data')) {
    console.warn('[storage] WARN: На Render free tier без диска и без Upstash данные пропадут при рестарте! Включи Upstash (бесплатно) или Render Disk.');
  }
}

function upstashRequest(pathPart, method='GET', body=null) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(`${UPSTASH_URL}/${pathPart}`);
      const opts = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': `Bearer ${UPSTASH_TOKEN}`,
        }
      };
      if (body) {
        const buf = Buffer.from(body, 'utf8');
        opts.headers['Content-Type'] = 'application/json';
        opts.headers['Content-Length'] = buf.length;
      }
      const req = https.request(opts, res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            if (res.statusCode >= 400) return reject(new Error(`Upstash ${res.statusCode}: ${buf.slice(0,300)}`));
            resolve(j);
          } catch (e) {
            // Upstash иногда возвращает plain text
            if (res.statusCode >=400) return reject(new Error(`Upstash HTTP ${res.statusCode}: ${buf.slice(0,300)}`));
            resolve({ result: buf });
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, ()=>{ req.destroy(new Error('upstash timeout')); });
      if (body) req.write(body);
      req.end();
    } catch (e) { reject(e); }
  });
}

async function upstashGet(key) {
  const r = await upstashRequest(`get/${encodeURIComponent(key)}`, 'GET');
  // Upstash REST: { result: "json string" } или { result: null }
  if (!r || r.result == null) return null;
  let val = r.result;
  // Upstash может вернуть уже распарсенный объект если хранился как JSON? Проверяем.
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

async function backupUpstash(key, value) {
  if (!upstashEnabled) return;
  const json = JSON.stringify(value);
  // Upstash REST: POST /set/key with body as value. Для JSON используем POST.
  // Чтобы избежать проблем с URL длиной, шлем через POST body.
  await upstashRequest(`set/${encodeURIComponent(key)}`, 'POST', json);
  // console.log(`[storage] Upstash backup ${key} ok`);
}

async function restoreUpstash(key) {
  if (!upstashEnabled) return null;
  try {
    const data = await upstashGet(key);
    if (data) console.log(`[storage] Upstash restore ${key} ok, size=${JSON.stringify(data).length}`);
    return data;
  } catch (e) {
    console.error(`[storage] Upstash restore ${key} failed`, e.message);
    return null;
  }
}

// === GitHub Gist fallback (тоже бесплатно) ===
const GIST_ID = process.env.GIST_ID || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GIST_TOKEN || '';
const gistEnabled = !!(GIST_ID && GITHUB_TOKEN);
if (gistEnabled) console.log(`[storage] Gist backup enabled: ${GIST_ID}`);

function gistRequest(method, path, body=null) {
  return new Promise((resolve, reject)=>{
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'airdlc-storage',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        ...(data ? {'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(data)} : {})
      }
    };
    const req = https.request(opts, res=>{
      let buf=''; res.on('data',c=>buf+=c); res.on('end',()=>{
        try { const j = JSON.parse(buf); if (res.statusCode>=400) return reject(new Error(`Gist ${res.statusCode}: ${buf.slice(0,300)}`)); resolve(j);} catch(e){ reject(new Error(`Gist parse ${buf.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, ()=>req.destroy(new Error('gist timeout')));
    if (data) req.write(data);
    req.end();
  });
}
async function backupGist(data) {
  if (!gistEnabled) return;
  // Gist хранит файлы как { "data.json": {content: "..."} }
  await gistRequest('PATCH', `/gists/${GIST_ID}`, { files: { 'airdlc-data.json': { content: JSON.stringify(data, null, 2) } } });
}
async function restoreGist() {
  if (!gistEnabled) return null;
  try {
    const g = await gistRequest('GET', `/gists/${GIST_ID}`);
    const f = g.files && (g.files['airdlc-data.json'] || g.files['data.json']);
    if (f && f.content) {
      const d = JSON.parse(f.content);
      console.log('[storage] Gist restore ok');
      return d;
    }
  } catch(e){ console.error('[storage] Gist restore failed', e.message); }
  return null;
}

// === Init: восстановление с удаленного хранилища при старте (для free tier) ===
async function init() {
  // Если Upstash настроен — пробуем восстановить оттуда если локальный файл пустой/дефолтный
  if (upstashEnabled) {
    try {
      const remoteData = await restoreUpstash('airdlc:data');
      const remoteTokens = await restoreUpstash('airdlc:tokens');
      const remoteUpdates = await restoreUpstash('airdlc:updates');
      const local = rd();
      let shouldRestore = false;
      // Логика: если remote есть и имеет больше данных чем local — восстанавливаем
      if (remoteData && typeof remoteData === 'object') {
        const localKeys = (local.keys||[]).length;
        const remoteKeys = (remoteData.keys||[]).length;
        const localUsers = (local.users||[]).length;
        const remoteUsers = (remoteData.users||[]).length;
        const remoteIssued = remoteData.telegramIssued ? Object.keys(remoteData.telegramIssued).length : 0;
        const localIssued = local.telegramIssued ? Object.keys(local.telegramIssued).length : 0;
        // Если remote содержит данные, а local — только дефолт (1 admin, 3 keys, 0 issued) — восстанавливаем
        if (remoteKeys > localKeys || remoteUsers > localUsers || remoteIssued > localIssued || (localKeys<=3 && remoteKeys>0)) {
          // но проверяем что remote не пустой дефолт
          shouldRestore = true;
        }
        if (shouldRestore) {
          console.log(`[storage] Restoring data.json from Upstash (remote keys:${remoteKeys} users:${remoteUsers} issued:${remoteIssued} vs local keys:${localKeys} users:${localUsers} issued:${localIssued})`);
          atomicWrite(DF, remoteData);
        } else if (!remoteData || remoteKeys===0) {
          // remote пустой — пушим local
          console.log('[storage] Upstash empty, pushing local data.json');
          await backupUpstash('airdlc:data', local);
        }
      } else {
        console.log('[storage] No remote data.json, pushing local');
        await backupUpstash('airdlc:data', local);
      }

      if (remoteTokens && typeof remoteTokens === 'object' && Object.keys(remoteTokens).length>0) {
        const localTokens = rt();
        if (Object.keys(localTokens).length===0 && Object.keys(remoteTokens).length>0) {
          console.log('[storage] Restoring tokens.json from Upstash');
          atomicWrite(TF, remoteTokens);
        }
      } else if (remoteTokens===null) {
        const lt = rt();
        if (Object.keys(lt).length>0) await backupUpstash('airdlc:tokens', lt);
      }

      if (Array.isArray(remoteUpdates) && remoteUpdates.length>0) {
        const localUpdates = ru();
        if (localUpdates.length===0) {
          console.log('[storage] Restoring updates.json from Upstash');
          atomicWrite(UF, remoteUpdates);
        }
      }

      const remoteChat = await restoreUpstash('airdlc:chat');
      if (Array.isArray(remoteChat) && remoteChat.length>0) {
        const localChat = rc();
        if (localChat.length===0) {
          console.log('[storage] Restoring chat.json from Upstash');
          atomicWrite(CF, remoteChat);
        }
      } else if (remoteChat===null) {
        const lc = rc();
        if (lc.length>0) await backupUpstash('airdlc:chat', lc);
      }

      const remoteSupport = await restoreUpstash('airdlc:support');
      if (Array.isArray(remoteSupport) && remoteSupport.length>0) {
        const localSupport = rs();
        if (localSupport.length===0) {
          console.log('[storage] Restoring support.json from Upstash');
          atomicWrite(SF, remoteSupport);
        }
      } else if (remoteSupport===null) {
        const ls = rs();
        if (ls.length>0) await backupUpstash('airdlc:support', ls);
      }
    } catch(e){ console.error('[storage] Upstash init failed', e.message, e.stack); }
  } else if (gistEnabled) {
    try {
      const remote = await restoreGist();
      if (remote) {
        const local = rd();
        const need = ((remote.keys||[]).length > (local.keys||[]).length) || ((remote.telegramIssued && Object.keys(remote.telegramIssued).length) > Object.keys(local.telegramIssued||{}).length);
        if (need) {
          console.log('[storage] Restoring from Gist');
          atomicWrite(DF, remote);
        }
      }
    } catch(e){ console.error('[storage] Gist init failed', e.message); }
  } else {
    console.log('[storage] No remote persistence configured — using file only');
  }
}

function getDataFile() { return DF; }
function getTokensFile() { return TF; }
function getUpdatesFile() { return UF; }
function getUpdatesDir() { return UD; }
function getBaseDir() { return BASE_DIR; }
const CHAT_FILE = CF;
const SUPPORT_FILE = SF;

module.exports = { BASE_DIR, DF, TF, UF, UD, CF, SF, CHAT_FILE, SUPPORT_FILE, rd, wd, rt, wt, ru, wu, rc, wc, rs, ws, getDataFile, getTokensFile, getUpdatesFile, getUpdatesDir, getBaseDir, atomicWrite, safeRead, init, upstashEnabled, gistEnabled, backupUpstash, restoreUpstash };
