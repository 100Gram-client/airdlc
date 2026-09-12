const crypto = require('crypto');
const https = require('https');

// === CONFIG ===
const BOT_TOKEN = process.env.BOT_TOKEN || '8731564924:AAHmS0LwlmWi8F66oIrrwWkthmugL6jAgSQ';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@dlc_airclient';
const CHANNEL_URL = process.env.CHANNEL_URL || 'https://t.me/dlc_airclient';
const SITE_URL = process.env.RENDER_EXTERNAL_URL || process.env.SITE_URL || 'https://airdlc.onrender.com';
const KEY_TYPE = process.env.BOT_KEY_TYPE || 'Lifetime';
const WEBHOOK_URL = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const USE_WEBHOOK = process.env.USE_WEBHOOK !== '0' && process.env.DISABLE_WEBHOOK !== '1';

// Persistent storage
const storage = require('./storage');
const rd = storage.rd;
const wd = storage.wd;
const rs = storage.rs || (()=>[]);
const ws = storage.ws || (()=>{});
const SUPPORT_ADMIN_ID = process.env.SUPPORT_ADMIN_ID || process.env.ADMIN_TG_ID || '';
const SUPPORT_ADMIN_IDS = (process.env.SUPPORT_ADMIN_IDS || SUPPORT_ADMIN_ID).split(',').map(s=>s.trim()).filter(Boolean);
if(SUPPORT_ADMIN_IDS.length===0) console.warn('[support] WARN: SUPPORT_ADMIN_ID не задан — техподдержка не будет приходить в Telegram. Задай в .env / Render Environment.');
const pendingSupportReply = {}; // adminId -> ticketId

if (!process.env.BOT_TOKEN) {
  console.warn('[bot] WARN: BOT_TOKEN не задан в env, используется хардкод. Задай BOT_TOKEN в Render -> Environment для безопасности!');
  console.warn('[bot] WARN: Токен из сообщения уже утек после публикации. Смени через @BotFather -> /revoke !');
}

function genKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rnd = () => {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[crypto.randomInt(chars.length)];
    return s;
  };
  return `AIR-${rnd()}-${rnd()}-${rnd()}`;
}

function tgApi(method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          resolve(j);
        } catch (e) { reject(new Error(`tgApi ${method} parse error: ${e.message} raw:${buf.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(35000, () => { req.destroy(new Error('tgApi timeout')); });
    req.write(data);
    req.end();
  });
}

async function checkSubscription(userId) {
  if (process.env.SKIP_SUB_CHECK === '1' || process.env.SKIP_SUB_CHECK === 'true') {
    console.log(`[bot] SKIP_SUB_CHECK enabled, auto-pass for ${userId}`);
    return { ok: true, isMember: true, status: 'member' };
  }
  try {
    const r = await tgApi('getChatMember', { chat_id: CHANNEL_USERNAME, user_id: userId });
    if (!r.ok) {
      return { ok: false, error: r.description || 'unknown', raw: r };
    }
    const status = r.result.status;
    const isMember = ['creator', 'administrator', 'member'].includes(status) || (status === 'restricted' && r.result.is_member);
    return { ok: true, isMember, status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function getCommand(text) {
  if (!text) return null;
  const first = text.trim().split(/\s+/)[0];
  return first.split('@')[0].toLowerCase();
}

async function handleUpdate(upd) {
  try {
    const msg = upd.message || upd.edited_message || upd.channel_post;
    const cq = upd.callback_query;
    const from = msg?.from || cq?.from;
    const chatId = msg?.chat?.id || cq?.message?.chat?.id;
    const rawText = msg?.text?.trim() ?? msg?.caption?.trim() ?? null;
    const cmd = getCommand(rawText);
    const data = cq?.data;

    if (!from || !chatId) {
      console.log('[bot] skip update no from/chatId', JSON.stringify(upd).slice(0,300));
      return;
    }

    console.log(`[bot] update from ${from.id} @${from.username||''} chat:${chatId} text:${rawText} cmd:${cmd} data:${data}`);

    if (cmd === '/start' || cmd === '/help') {
      await tgApi('sendMessage', {
        chat_id: chatId,
        text: `👋 Привет, ${from.first_name || ''}!\n\n🎮 *Air DLC* — выдаю лицензионный ключ после подписки на канал.\n\n📢 Канал: ${CHANNEL_URL}\n🌐 Сайт: ${SITE_URL}\n\nНажми кнопку ниже чтобы проверить подписку и получить ключ.`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Подписаться на канал', url: CHANNEL_URL }],
            [{ text: '✅ Проверить подписку', callback_data: 'check_sub' }]
          ]
        }
      });
      return;
    }

    if (cmd === '/mykey') {
      const db = rd();
      const existing = db.telegramIssued && db.telegramIssued[String(from.id)];
      if (existing) {
        await tgApi('sendMessage', { chat_id: chatId, text: `🔑 Твой ключ: \`${existing}\`\n\nИспользуй его при регистрации на ${SITE_URL}`, parse_mode: 'Markdown' });
      } else {
        await tgApi('sendMessage', { chat_id: chatId, text: `У тебя еще нет ключа. Нажми /start и проверь подписку.` });
      }
      return;
    }

    // === Техподдержка ===
    if (cmd === '/support' || cmd === '/tickets' || cmd === '/admin') {
      if (!SUPPORT_ADMIN_IDS.includes(String(from.id))) {
        await tgApi('sendMessage', {chat_id: chatId, text: 'Нет доступа. Эта команда только для поддержки.'});
        return;
      }
      const tickets = rs().filter(t=>t.status==='open').slice(-10);
      if(tickets.length===0){
        await tgApi('sendMessage', {chat_id: chatId, text: '✅ Открытых тикетов нет.'});
        return;
      }
      for(const t of tickets){
        const last = t.messages[t.messages.length-1];
        const preview = last ? last.text.slice(0,80) : '';
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `🆔 \`${t.id}\`\n👤 \`${t.user}\` (${t.messages.length} сообщ.)\n📝 Последнее: ${preview}\nСтатус: ${t.status}`,
          parse_mode: 'Markdown',
          reply_markup: {inline_keyboard: [[{text:'💬 Ответить', callback_data:`support_reply:${t.id}`},{text:'✅ Закрыть', callback_data:`support_close:${t.id}`}]]}
        });
      }
      return;
    }
    if(data && data.startsWith('support_')){
      if(!SUPPORT_ADMIN_IDS.includes(String(from.id))){
        try{ await tgApi('answerCallbackQuery', {callback_query_id: cq.id, text:'Нет доступа'});}catch{}
        return;
      }
      if(data.startsWith('support_reply:')){
        const tid = data.split(':')[1];
        pendingSupportReply[String(from.id)] = tid;
        try{ await tgApi('answerCallbackQuery', {callback_query_id: cq.id}); }catch{}
        const ticket = rs().find(x=>x.id===tid);
        const hint = ticket ? `Пользователь: ${ticket.user}\nПоследнее: ${ticket.messages[ticket.messages.length-1]?.text.slice(0,100)}` : '';
        await tgApi('sendMessage', {chat_id: chatId, text: `💬 Напиши ответ для тикета \`${tid}\`\n${hint}\n\nПросто отправь текст — он уйдет пользователю на сайт.`, parse_mode:'Markdown'});
        return;
      }
      if(data.startsWith('support_close:')){
        const tid = data.split(':')[1];
        let tickets=rs();
        const t=tickets.find(x=>x.id===tid);
        if(t){
          t.status='closed';
          t.updated=Date.now();
          t.messages.push({id: crypto.randomBytes(4).toString('hex'), from:'system', text:`Закрыто админом @${from.username||from.id}`, ts:Date.now()});
          ws(tickets);
          if(storage.upstashEnabled) try{ await storage.backupUpstash('airdlc:support', tickets);}catch{}
          try{ await tgApi('answerCallbackQuery', {callback_query_id: cq.id, text:'Закрыто'});}catch{}
          await tgApi('sendMessage', {chat_id: chatId, text: `✅ Тикет \`${tid}\` закрыт.`, parse_mode:'Markdown'});
        } else {
          try{ await tgApi('answerCallbackQuery', {callback_query_id: cq.id, text:'Не найден'});}catch{}
        }
        return;
      }
      if(data.startsWith('support_user:')){
        const uname=data.split(':')[1];
        const d=rd();
        const u=d.users.find(x=>x.username===uname);
        if(u){
          try{ await tgApi('answerCallbackQuery', {callback_query_id: cq.id});}catch{}
          await tgApi('sendMessage', {chat_id: chatId, text: `👤 *${u.username}*\n📧 ${u.email}\n🔑 ${u.key}\n📦 ${u.subType} | ${u.expiry}\n🆔 HWID: \`${u.hwid||'none'}\`\n📅 ${u.joinDate}`, parse_mode:'Markdown'});
        }
        return;
      }
    }
    // Если админ ждет ответа — следующее сообщение это ответ
    if(pendingSupportReply[String(from.id)] && rawText && !rawText.startsWith('/')){
      const tid = pendingSupportReply[String(from.id)];
      let tickets=rs();
      const t=tickets.find(x=>x.id===tid);
      if(t){
        if(!SUPPORT_ADMIN_IDS.includes(String(from.id))){
          delete pendingSupportReply[String(from.id)];
          return;
        }
        const adminMsg={id: crypto.randomBytes(6).toString('hex'), from:'admin', user:'Support', text: rawText, ts: Date.now(), admin: from.username||String(from.id)};
        t.messages.push(adminMsg);
        t.updated=Date.now();
        t.status='open';
        ws(tickets);
        if(storage.upstashEnabled) try{ await storage.backupUpstash('airdlc:support', tickets);}catch{}
        delete pendingSupportReply[String(from.id)];
        await tgApi('sendMessage', {chat_id: chatId, text: `✅ Ответ отправлен пользователю \`${t.user}\` по тикету \`${tid}\``, parse_mode:'Markdown', reply_markup:{inline_keyboard:[[{text:'✅ Закрыть тикет', callback_data:`support_close:${tid}`}]]}});
        console.log(`[support] admin ${from.id} replied to ${t.user} ticket ${tid}: ${rawText.slice(0,50)}`);
        return;
      } else {
        delete pendingSupportReply[String(from.id)];
        await tgApi('sendMessage', {chat_id: chatId, text: `⚠️ Тикет \`${tid}\` не найден.`});
        return;
      }
    }

    if (cmd === '/getkey' || data === 'check_sub' || data === 'get_key') {
      if (cq) {
        try { await tgApi('answerCallbackQuery', { callback_query_id: cq.id }); } catch {}
      }

      const sub = await checkSubscription(from.id);
      if (!sub.ok) {
        console.error('[bot] checkSub error', sub.error, sub.raw);
        let hint = '';
        if (String(sub.error).toLowerCase().includes('not enough rights') || String(sub.error).toLowerCase().includes('member list is inaccessible')) {
          hint = '\n\n⚠️ Бот должен быть *админом* в канале, иначе проверка не работает. Добавь бота в админы канала и дай право видеть участников.';
        }
        if (String(sub.error).toLowerCase().includes('chat not found')) {
          hint = '\n\n⚠️ Канал не найден. Проверь CHANNEL_USERNAME (сейчас: ' + CHANNEL_USERNAME + ')';
        }
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `⚠️ Не удалось проверить подписку: ${sub.error}${hint}`,
          parse_mode: 'Markdown'
        });
        return;
      }

      if (!sub.isMember) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `❌ Ты *не подписан* на канал ${CHANNEL_URL}\n\nПодпишись и нажми «Проверить снова».`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📢 Подписаться', url: CHANNEL_URL }],
              [{ text: '🔄 Проверить снова', callback_data: 'check_sub' }]
            ]
          }
        });
        return;
      }

      let db = rd();
      if (!db.keys) db.keys = [];
      if (!db.telegramIssued) db.telegramIssued = {};

      const tid = String(from.id);
      if (db.telegramIssued[tid]) {
        const existingKey = db.telegramIssued[tid];
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `✅ Ты уже получал ключ:\n\n\`${existingKey}\`\n\nИспользуй его при регистрации на ${SITE_URL}\nЕсли ключ уже использован — он привязан к твоему аккаунту.`,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🌐 Перейти на сайт', url: SITE_URL }]] }
        });
        return;
      }

      let newKey;
      let tries = 0;
      do {
        newKey = genKey();
        tries++;
        if (tries > 50) throw new Error('key gen failed');
      } while (db.keys.find(k => k.key === newKey));

      const keyObj = {
        key: newKey,
        subType: KEY_TYPE,
        used: false,
        usedBy: null,
        usedDate: null,
        createdBy: 'telegram_bot',
        createdDate: new Date().toISOString(),
        telegramId: from.id,
        telegramUsername: from.username || ''
      };
      db.keys.push(keyObj);
      db.telegramIssued[tid] = newKey;
      wd(db);

      console.log(`[bot] issued ${newKey} (${KEY_TYPE}) to tg:${from.id} @${from.username || ''} name:${from.first_name} -> stored in ${storage.DF}`);

      await tgApi('sendMessage', {
        chat_id: chatId,
        text: `✅ Подписка подтверждена!\n\n🔑 Твой лицензионный ключ:\n\`${newKey}\`\n\n📌 Тип: *${KEY_TYPE}*\n\nИспользуй его при регистрации на сайте:\n${SITE_URL}\n\n⚠️ Не передавай ключ другим! Один Telegram = один ключ.`,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🌐 Перейти на сайт', url: SITE_URL }]] }
      });
      return;
    }

    if (msg && rawText) {
      if (rawText.startsWith('/')) {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `Неизвестная команда. Напиши /start чтобы получить ключ 🔑\nИли /mykey чтобы посмотреть уже выданный.`,
        });
      } else {
        await tgApi('sendMessage', {
          chat_id: chatId,
          text: `Напиши /start чтобы получить ключ 🔑\nИли /mykey чтобы посмотреть уже выданный.`,
        });
      }
    }
  } catch (e) {
    console.error('[bot] handleUpdate error', e.stack || e.message);
    try {
      const chatId = (upd.message?.chat?.id) || (upd.callback_query?.message?.chat?.id);
      if (chatId) await tgApi('sendMessage', { chat_id: chatId, text: `⚠️ Произошла ошибка, попробуй еще раз /start` }).catch(()=>{});
    } catch {}
  }
}

let offset = 0;
let polling = false;
let pollingTimer = null;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const r = await tgApi('getUpdates', { offset, timeout: 30 });
    if (r.ok && r.result && r.result.length) {
      for (const upd of r.result) {
        offset = upd.update_id + 1;
        await handleUpdate(upd);
      }
    } else if (!r.ok) {
      if (r.error_code === 401) {
        console.error('[bot] 401 Unauthorized — проверь BOT_TOKEN! ', r.description);
      } else {
        console.error('[bot] getUpdates not ok', r);
      }
    }
  } catch (e) {
    if (!String(e.message).includes('EAI_AGAIN') && !String(e.message).includes('timeout')) {
      console.error('[bot] poll error', e.message);
    }
  } finally {
    polling = false;
  }
}

async function setupPolling() {
  try {
    const wh = await tgApi('deleteWebhook', { drop_pending_updates: true });
    console.log('[bot] deleteWebhook', wh.ok ? 'ok' : wh.description);
  } catch(e){ console.error('[bot] deleteWebhook error', e.message); }
  try {
    const sc = await tgApi('setMyCommands', {
      commands: [
        { command: 'start', description: 'Получить лицензионный ключ' },
        { command: 'mykey', description: 'Показать мой ключ' },
        { command: 'getkey', description: 'Проверить подписку и выдать ключ' },
        { command: 'support', description: 'Техподдержка (админ)' }
      ]
    });
    console.log('[bot] setMyCommands', sc.ok ? 'ok' : sc.description);
  } catch(e){ console.error('[bot] setMyCommands error', e.message); }
  try {
    const me = await tgApi('getMe', {});
    if (me.ok) console.log(`[bot] connected as @${me.result.username} id:${me.result.id} (polling)`);
    else console.error('[bot] getMe failed', me.description, me);
  } catch(e){ console.error('[bot] getMe error', e.message); }

  if (pollingTimer) clearInterval(pollingTimer);
  pollingTimer = setInterval(poll, 1500);
  poll();
  console.log('[bot] polling started (1.5s) — бот отвечает на /start ✅');
}

async function setupWebhook() {
  const hookUrl = `${WEBHOOK_URL}/api/telegram/webhook`;
  console.log(`[bot] trying webhook mode -> ${hookUrl}`);
  try {
    const me = await tgApi('getMe', {});
    if (!me.ok) throw new Error(me.description);
    console.log(`[bot] connected as @${me.result.username} id:${me.result.id} (webhook)`);

    const wh = await tgApi('setWebhook', {
      url: hookUrl,
      drop_pending_updates: true,
      allowed_updates: ['message', 'callback_query', 'edited_message']
    });
    console.log('[bot] setWebhook', wh.ok ? `ok -> ${hookUrl}` : `failed: ${wh.description}`);

    if (wh.ok) {
      await tgApi('setMyCommands', {
        commands: [
          { command: 'start', description: 'Получить лицензионный ключ' },
          { command: 'mykey', description: 'Показать мой ключ' },
          { command: 'getkey', description: 'Проверить подписку и выдать ключ' },
          { command: 'support', description: 'Техподдержка (админ)' }
        ]
      });
      const info = await tgApi('getWebhookInfo', {});
      console.log('[bot] webhookInfo', JSON.stringify(info.result).slice(0,500));
      console.log('[bot] webhook mode — polling отключен, /start будет приходить через POST /api/telegram/webhook');
      return true;
    }
    return false;
  } catch(e){
    console.error('[bot] webhook setup failed', e.message);
    return false;
  }
}

async function startBot() {
  if (!BOT_TOKEN || BOT_TOKEN.includes('REPLACE')) {
    console.log('[bot] disabled — нет BOT_TOKEN');
    return;
  }
  console.log(`[bot] starting... channel:${CHANNEL_USERNAME} site:${SITE_URL} keyType:${KEY_TYPE}`);
  console.log(`[bot] webhookUrl:${WEBHOOK_URL || '(empty)'} useWebhook:${USE_WEBHOOK} storage:${storage.DF}`);

  // На Render (RENDER_EXTERNAL_URL есть и https) — пробуем webhook, иначе polling
  // Webhook надежнее на free tier: просыпает спящий инстанс при входящем POST от Telegram
  const shouldTryWebhook = USE_WEBHOOK && WEBHOOK_URL && WEBHOOK_URL.startsWith('https://');
  if (shouldTryWebhook) {
    const ok = await setupWebhook();
    if (ok) return;
    console.log('[bot] webhook not set, falling back to polling');
  } else {
    console.log('[bot] webhook not used (local dev или USE_WEBHOOK=0), используем polling');
  }

  await setupPolling();
}

module.exports = { startBot, tgApi, checkSubscription, handleUpdate, setupPolling, setupWebhook };
