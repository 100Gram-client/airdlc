const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

// === CONFIG ===
const BOT_TOKEN = process.env.BOT_TOKEN || '8731564924:AAHmS0LwlmWi8F66oIrrwWkthmugL6jAgSQ';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@dlc_airclient';
const CHANNEL_URL = process.env.CHANNEL_URL || 'https://t.me/dlc_airclient';
const SITE_URL = process.env.RENDER_EXTERNAL_URL || process.env.SITE_URL || 'https://airdlc.onrender.com';
const KEY_TYPE = process.env.BOT_KEY_TYPE || 'Lifetime'; // Lifetime | 1 Month | 3 Months etc
const DF = path.join(__dirname, 'data.json');

// Предупреждение если токен захардкожен
if (!process.env.BOT_TOKEN) {
  console.warn('[bot] WARN: BOT_TOKEN не задан в env, используется хардкод. Задай BOT_TOKEN в Render -> Environment для безопасности!');
  console.warn('[bot] WARN: Токен из сообщения уже утес после публикации. Смени через @BotFather -> /revoke !');
}

const rd = () => { try { return JSON.parse(fs.readFileSync(DF, 'utf8')) } catch (e) { return { users: [], keys: [], seeded: false, telegramIssued: {} } } };
const wd = d => fs.writeFileSync(DF, JSON.stringify(d, null, 2), 'utf8');

function genKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rnd = () => {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[crypto.randomInt(chars.length)];
    return s;
  };
  return `AIR-${rnd()}-${rnd()}-${rnd()}`;
}

// Telegram API helper via https (без внешних зависимостей)
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
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function checkSubscription(userId) {
  try {
    const r = await tgApi('getChatMember', { chat_id: CHANNEL_USERNAME, user_id: userId });
    if (!r.ok) {
      // возможные ошибки: bot not admin, channel not found
      return { ok: false, error: r.description || 'unknown', raw: r };
    }
    const status = r.result.status; // creator, administrator, member, restricted, left, kicked
    const isMember = ['creator', 'administrator', 'member'].includes(status) || (status === 'restricted' && r.result.is_member);
    return { ok: true, isMember, status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleUpdate(upd) {
  const msg = upd.message;
  const cq = upd.callback_query;
  const from = msg?.from || cq?.from;
  const chatId = msg?.chat?.id || cq?.message?.chat?.id;
  const text = msg?.text?.trim();
  const data = cq?.data;

  if (!from || !chatId) return;

  // /start
  if (text === '/start' || text === '/help') {
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

  // /mykey - показать свой ключ если уже выдавали
  if (text === '/mykey') {
    const db = rd();
    const existing = db.telegramIssued && db.telegramIssued[String(from.id)];
    if (existing) {
      await tgApi('sendMessage', { chat_id: chatId, text: `🔑 Твой ключ: \`${existing}\`\n\nИспользуй его при регистрации на ${SITE_URL}`, parse_mode: 'Markdown' });
    } else {
      await tgApi('sendMessage', { chat_id: chatId, text: `У тебя еще нет ключа. Нажми /start и проверь подписку.` });
    }
    return;
  }

  // Проверка подписки и выдача ключа
  if (text === '/getkey' || data === 'check_sub' || data === 'get_key') {
    if (cq) {
      // отвечаем чтобы убрать часики
      tgApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(()=>{});
    }

    // Сначала проверим подписку
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

    // Подписан — выдаем ключ
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

    // Генерим уникальный ключ
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

    console.log(`[bot] issued ${newKey} (${KEY_TYPE}) to tg:${from.id} @${from.username || ''} name:${from.first_name}`);

    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `✅ Подписка подтверждена!\n\n🔑 Твой лицензионный ключ:\n\`${newKey}\`\n\n📌 Тип: *${KEY_TYPE}*\n\nИспользуй его при регистрации на сайте:\n${SITE_URL}\n\n⚠️ Не передавай ключ другим! Один Telegram = один ключ.`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🌐 Перейти на сайт', url: SITE_URL }]] }
    });
    return;
  }

  // Любой другой текст
  if (msg && text && !text.startsWith('/')) {
    await tgApi('sendMessage', {
      chat_id: chatId,
      text: `Напиши /start чтобы получить ключ 🔑\nИли /mykey чтобы посмотреть уже выданный.`,
    });
  }
}

let offset = 0;
let polling = false;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const r = await tgApi('getUpdates', { offset, timeout: 30 });
    if (r.ok && r.result && r.result.length) {
      for (const upd of r.result) {
        offset = upd.update_id + 1;
        handleUpdate(upd).catch(e => console.error('[bot] handle error', e));
      }
    }
  } catch (e) {
    // сеть падает — не спамим
    if (!String(e.message).includes('EAI_AGAIN')) console.error('[bot] poll error', e.message);
  } finally {
    polling = false;
  }
}

async function startBot() {
  if (!BOT_TOKEN || BOT_TOKEN.includes('REPLACE')) {
    console.log('[bot] disabled — нет BOT_TOKEN');
    return;
  }
  console.log(`[bot] starting... channel:${CHANNEL_USERNAME} site:${SITE_URL} keyType:${KEY_TYPE}`);

  // Сброс webhook чтобы работал polling (если раньше стоял webhook)
  try {
    const wh = await tgApi('deleteWebhook', { drop_pending_updates: true });
    console.log('[bot] deleteWebhook', wh.ok ? 'ok' : wh.description);

    // Установим команды
    await tgApi('setMyCommands', {
      commands: [
        { command: 'start', description: 'Получить лицензионный ключ' },
        { command: 'mykey', description: 'Показать мой ключ' },
        { command: 'getkey', description: 'Проверить подписку и выдать ключ' }
      ]
    });

    const me = await tgApi('getMe', {});
    if (me.ok) console.log(`[bot] connected as @${me.result.username} id:${me.result.id}`);
    else console.error('[bot] getMe failed', me.description);
  } catch (e) {
    console.error('[bot] init error', e.message);
  }

  // polling loop — каждые 1.5 сек, но getUpdates сам висит 30сек (long polling)
  setInterval(poll, 1500);
  poll();
  console.log('[bot] polling started (1.5s)');
}

module.exports = { startBot, tgApi, checkSubscription };
