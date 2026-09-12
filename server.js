const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const storage=require('./storage');
const PORT=process.env.PORT||8080,__dir=__dirname;
const DF=storage.DF, TF=storage.TF, UF=storage.UF, UD=storage.UD, CF=storage.CF, SF=storage.SF;
const rd=storage.rd, wd=storage.wd, rt=storage.rt, wt=storage.wt, ru=storage.ru, wu=storage.wu, rc=storage.rc, wc=storage.wc, rs=storage.rs, ws=storage.ws;
const SUPPORT_ADMIN_ID = process.env.SUPPORT_ADMIN_ID || process.env.ADMIN_TG_ID || '';
const SUPPORT_ADMIN_USERNAME = process.env.SUPPORT_ADMIN_USERNAME || '';
const BOT_TOKEN_SRV = process.env.BOT_TOKEN || '8731564924:AAHmS0LwlmWi8F66oIrrwWkthmugL6jAgSQ';
const SITE_URL = process.env.RENDER_EXTERNAL_URL || process.env.SITE_URL || 'https://airdlc.onrender.com';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.YANDEX_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
if(!SUPPORT_ADMIN_ID) console.warn('[support] SUPPORT_ADMIN_ID не задан — сообщения не уйдут в Telegram');
if(GEMINI_API_KEY) console.log(`[support] Gemini auto-reply enabled model=${GEMINI_MODEL}`); else console.log('[support] Gemini disabled — задай GEMINI_API_KEY для автоответчика');

// === Gemini auto-reply (самая легкая и быстрая модель) ===
function callGemini(prompt){
  return new Promise((resolve,reject)=>{
    const isYandex = GEMINI_API_KEY.startsWith('AQ.');
    if(isYandex){
      // Yandex GPT lite — требует FOLDER_ID, если нет — сразу fallback на правила
      const folderId = process.env.YANDEX_FOLDER_ID || process.env.FOLDER_ID || '';
      if(!folderId){
        return reject(new Error('YANDEX_FOLDER_ID not set — skip yandex, use ruleBased'));
      }
      const body=JSON.stringify({
        modelUri: `gpt://${folderId}/yandexgpt-lite`,
        completionOptions:{stream:false, temperature:0.6, maxTokens:600},
        messages:[{role:'system', text:'Ты — техподдержка Air DLC, читы для SpookyTime. Отвечай кратко, дружелюбно, на русском, помогай с ключами (AIR-...), HWID, оплатой, каналом @dlc_airclient, ботом @airdlcbot /start. Если не можешь решить — скажи что передашь человеку.'},{role:'user', text: prompt}]
      });
      const req=require('https').request({
        hostname:'llm.api.cloud.yandex.net',
        path:'/foundationModels/v1/completion',
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Api-Key ${GEMINI_API_KEY}`, 'x-folder-id': folderId, 'Content-Length': Buffer.byteLength(body)}
      }, res=>{
        let buf=''; res.on('data',c=>buf+=c); res.on('end',()=>{
          try{
            const j=JSON.parse(buf);
            if(j.result && j.result.alternatives && j.result.alternatives[0]) resolve(j.result.alternatives[0].message.text);
            else if(j.error) reject(new Error(j.error.message||buf.slice(0,300)));
            else reject(new Error('Yandex empty '+buf.slice(0,300)));
          }catch(e){ reject(e); }
        });
      });
      req.on('error',reject); req.setTimeout(15000,()=>req.destroy(new Error('yandex timeout'))); req.write(body); req.end();
      return;
    }
    // Google Gemini
    const body=JSON.stringify({
      contents:[{parts:[{text: prompt}]}],
      generationConfig:{temperature:0.7, maxOutputTokens:600},
      systemInstruction:{parts:[{text: 'Ты — техподдержка Air DLC. Помогай с читом для SpookyTime: ключи AIR-..., HWID, подписки Lifetime/1 Month, скачивание, канал @dlc_airclient, бот @airdlcbot /start. Отвечай кратко на русском, дружелюбно. Если не знаешь — скажи что передашь админу.'}]}
    });
    const req=require('https').request({
      hostname:'generativelanguage.googleapis.com',
      path:`/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, res=>{
      let buf=''; res.on('data',c=>buf+=c); res.on('end',()=>{
        try{
          const j=JSON.parse(buf);
          if(j.candidates && j.candidates[0] && j.candidates[0].content){
            const parts=j.candidates[0].content.parts;
            resolve(parts.map(p=>p.text).join(''));
          } else if(j.error) reject(new Error(j.error.message||buf.slice(0,400)));
          else reject(new Error('Gemini empty '+buf.slice(0,400)));
        }catch(e){ reject(e); }
      });
    });
    req.on('error',reject); req.setTimeout(15000,()=>req.destroy(new Error('gemini timeout'))); req.write(body); req.end();
  });
}
function ruleBasedReply(text){
  const t=text.toLowerCase();
  if(t.includes('ключ')||t.includes('key')||t.includes('air-')){
    return '🔑 Ключ выдаётся в Telegram боте @airdlcbot — подпишись на @dlc_airclient и нажми /start → Проверить подписку. Один Telegram = один ключ. Если ключ пишет "Invalid" — проверь пробелы, или ключ уже использован (привязан к аккаунту).';
  }
  if(t.includes('не работ')||t.includes('не запуск')||t.includes('ошибк')||t.includes('вылет')||t.includes('инжект')){
    return '🛠 Попробуй: 1) Запусти от имени администратора 2) Отключи антивирус 3) Перезапусти игру и лоадер 4) Проверь HWID в Dashboard — если сменился, напиши сюда свой новый HWID. Если не помогло — админ подключится.';
  }
  if(t.includes('оплат')||t.includes('купить')||t.includes('цен')||t.includes('подписк')){
    return '💳 Подписки: Lifetime, 1/3/6 Months, 1 Year — ключи генерирует админ в Dashboard → Admin. Бесплатный ключ — только через бота @airdlcbot (подписка на канал).';
  }
  if(t.includes('скачат')||t.includes('загруз')||t.includes('download')){
    return '⬇️ Скачать лоадер: на сайте Download или в Dashboard → Downloads. Нужен логин. Если кнопка не активна — войди в аккаунт.';
  }
  if(t.includes('hwid')||t.includes('желез')){
    return '🆔 HWID привязывается при первом логине лаунчера. Сменить можно только через поддержку — напиши свой новый HWID.';
  }
  if(t.includes('привет')||t.includes('здравст')||t.includes('хай')){
    return 'Привет! 👋 Чем могу помочь по Air DLC? Опиши проблему — постараюсь решить, иначе передам админу.';
  }
  return null;
}
async function generateAutoReply(ticket, userMsg){
  if(!GEMINI_API_KEY) return ruleBasedReply(userMsg.text);
  const history = ticket.messages.slice(-6).map(m=>`${m.from==='user'?ticket.user:'Support'}: ${m.text}`).join('\n');
  const prompt = `Диалог техподдержки Air DLC:\n${history}\n\nНовое сообщение от ${ticket.user}: "${userMsg.text}"\n\nОтветь как техподдержка, кратко, по делу, на русском. Если вопрос про ключи/HWID/оплату — дай инструкцию. Если не уверен — скажи что передашь админу.`;
  try{
    const ai = await callGemini(prompt);
    if(ai && ai.trim().length>10) return ai.trim().slice(0,1200);
  }catch(e){
    console.error('[auto-reply] gemini failed', e.message.slice(0,200));
  }
  return ruleBasedReply(userMsg.text) || 'Спасибо за обращение! Админ скоро ответит в Telegram и здесь. Среднее время — до 24ч.';
}

if(!fs.existsSync(UD))try{fs.mkdirSync(UD,{recursive:true})}catch{}

const gt=()=>crypto.randomBytes(32).toString('hex');
const MIME={'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.exe':'application/octet-stream','.zip':'application/zip'};
const rb=(req,cb)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>cb(b))};
const rbr=(req,cb)=>{let c=[];req.on('data',d=>c.push(d));req.on('end',()=>cb(Buffer.concat(c)))};
function seed(d){
  let changed=false;
  if(d.seeded && d.users && d.keys) return d;
  if(!d.users) {d.users=[]; changed=true;}
  if(!d.keys) {d.keys=[]; changed=true;}
  if(!d.telegramIssued) {d.telegramIssued={}; changed=true;}
  if(!d.seeded) {d.seeded=true; changed=true;}
  const A='kekainat';
  if(!d.users.find(u=>u.username===A)){
    d.users.push({username:A,email:'admin@airdlc.me',password:'kekainat',key:'ADMIN-PANEL',subType:'Lifetime',expiry:'Never',hwid:'ADMIN-HWID',joinDate:new Date().toISOString()});
    changed=true;
  }
  [{key:'AIR-TEST-KEY1-2024',subType:'Lifetime'},{key:'AIR-DEMO-XXXX-9999',subType:'1 Month'},{key:'AIR-PREM-ABCD-7777',subType:'3 Months'}].forEach(k=>{
    if(!d.keys.find(x=>x.key===k.key)){
      d.keys.push({...k,used:false,usedBy:null,usedDate:null,createdBy:A,createdDate:new Date().toISOString()});
      changed=true;
    }
  });
  if(changed) wd(d);
  return d;
}
function mp(buf,bnd){let r={fields:{},file:null},bb=Buffer.from('--'+bnd),ps=[],s=0;while(true){let i=buf.indexOf(bb,s);if(i===-1)break;if(s>0)ps.push(buf.slice(s,i-2));s=i+bb.length}ps.forEach(p=>{let he=p.indexOf('\r\n\r\n');if(he===-1)return;let h=p.slice(0,he).toString(),b=p.slice(he+4);if(b.length>=2&&b[b.length-2]===13&&b[b.length-1]===10)b=b.slice(0,-2);let nm=h.match(/name="([^"]+)"/),fm=h.match(/filename="([^"]+)"/);if(nm){if(fm)r.file={fieldname:nm[1],filename:fm[1],data:b};else r.fields[nm[1]]=b.toString()}});return r}
function js(res,code,obj){res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj))}
function findUser(users,inp){return users.find(x=>x.username.toLowerCase()===inp.username.toLowerCase()&&x.password===inp.password)}
http.createServer((req,res)=>{let url=req.url.split('?')[0],qs=req.url.split('?')[1]||'',params={};qs.split('&').forEach(p=>{let kv=p.split('=');if(kv[0])params[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||'')});

// === Telegram webhook (для бесплатного тарифа — просыпает спящий инстанс, надежнее polling) ===
if(url==='/api/telegram/webhook'&&req.method==='POST'){
  return rb(req, async b=>{
    try{
      const upd = JSON.parse(b);
      // вызываем handleUpdate из bot.js (lazy require чтобы избежать циркулярки на старте)
      const bot = require('./bot');
      // отвечаем сразу 200, а обработку делаем async чтобы не держать Telegram
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true}));
      bot.handleUpdate(upd).catch(e=>console.error('[webhook] handleUpdate error', e.message, e.stack));
    }catch(e){
      console.error('[webhook] parse error', e.message);
      res.writeHead(400); res.end('bad request');
    }
  });
}
if(url==='/api/telegram/webhook'&&req.method==='GET'){
  // для проверки что webhook жив
  js(res,200,{ok:true, webhook: '/api/telegram/webhook', method:'POST Telegram updates here'});
  return;
}
if(url==='/api/telegram/debug'&&req.method==='GET'){
  // диагностика бота: webhookInfo + storage
  (async()=>{
    try{
      const bot = require('./bot');
      const info = await bot.tgApi('getWebhookInfo', {});
      let d={}; try{d=rd()}catch(e){d={error:e.message}}
      js(res,200,{ok:true, webhookInfo: info, storageBase: storage.BASE_DIR, upstash: storage.upstashEnabled, gist: storage.gistEnabled, users: (d.users||[]).length, keys: (d.keys||[]).length, telegramIssued: d.telegramIssued?Object.keys(d.telegramIssued).length:0});
    }catch(e){ js(res,500,{error:e.message}); }
  })();
  return;
}

if(url==='/api/data'&&req.method==='GET'){let d=seed(rd()); js(res,200,{users:d.users,keys:d.keys});return}
if(url==='/api/data'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),d=rd();
  if(i.users) d.users=i.users;
  if(i.keys) d.keys=i.keys;
  wd(d);js(res,200,{ok:true})}catch(e){console.error('/api/data POST error',e);res.writeHead(400);res.end('err')}});
if(url==='/api/login'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),d=rd(),u=findUser(d.users,i);if(!u)return js(res,401,{error:'Invalid credentials'});let t=gt(),tk=rt();tk[t]={username:u.username,created:Date.now()};wt(tk);js(res,200,{token:t,username:u.username})}catch(e){res.writeHead(400);res.end('err')}});
if(url==='/api/validate'&&req.method==='GET'){let t=rt()[params.token];if(!t)return js(res,401,{valid:false});let d=rd(),u=d.users.find(x=>x.username===t.username);return u?js(res,200,{valid:true,username:u.username,subType:u.subType,expiry:u.expiry}):js(res,401,{valid:false})}
if(url==='/api/logout'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),tk=rt();delete tk[i.token];wt(tk);js(res,200,{ok:true})}catch(e){res.writeHead(400);res.end('err')}});
if(url==='/api/updates'&&req.method==='GET'){js(res,200,ru());return}
if(url==='/api/updates/upload'&&req.method==='POST'){let ct=req.headers['content-type']||'',bn=ct.split('boundary=')[1];if(!bn)return js(res,400,{error:'No boundary'});return rbr(req,buf=>{try{let p=mp(buf,bn),v=p.fields.version||'unknown',n=p.fields.notes||'',t=p.fields.type||'release',fn=p.file?p.file.filename:null,id=v.replace(/[^a-zA-Z0-9.-]/g,'_')+'_'+Date.now();if(p.file)fs.writeFileSync(path.join(UD,id+path.extname(p.file.filename)),p.file.data);let u=ru(),e={id,version:v,notes:n,type:t,filename:fn,savedAs:p.file?id+path.extname(p.file.filename):null,size:p.file?p.file.data.length:0,date:new Date().toISOString()};u.unshift(e);wu(u);js(res,200,{ok:true,update:e})}catch(e){console.error('upload error',e);res.writeHead(500);res.end(e.message)}})}
if(url==='/api/updates/delete'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),u=ru(),upd=u.find(x=>x.id===i.id);if(upd&&upd.savedAs){let f=path.join(UD,upd.savedAs);if(fs.existsSync(f))fs.unlinkSync(f)}wu(u.filter(x=>x.id!==i.id));js(res,200,{ok:true})}catch(e){res.writeHead(400);res.end('err')}});
if(url.startsWith('/api/updates/download/')&&req.method==='GET'){let id=url.split('/api/updates/download/')[1],u=ru(),upd=u.find(x=>x.id===id);if(!upd||!upd.savedAs)return js(res,404,{error:'Not found'});let f=path.join(UD,upd.savedAs);if(!fs.existsSync(f))return js(res,404,{error:'File not found'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+(upd.filename||upd.savedAs)+'"'});fs.createReadStream(f).pipe(res);return}
if(url==='/launcher/login'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),d=rd(),u=findUser(d.users,i);if(!u)return js(res,401,{error:'Invalid credentials'});let t=gt(),tk=rt();tk[t]={username:u.username,created:Date.now()};wt(tk);js(res,200,{user:{login:u.username,group:u.subType||'Lifetime',buyed_until:u.expiry||'Never'},token:t})}catch(e){res.writeHead(400);res.end('err')}});
if(url==='/launcher/login-by-token'&&req.method==='POST'){let ath=(req.headers['authorization']||'').replace('Bearer ','');return rb(req,b=>{try{let i=JSON.parse(b),tk=rt(),t=tk[ath];if(!t)return js(res,401,{error:'Invalid token'});let d=rd(),u=d.users.find(x=>x.username===t.username);if(!u)return js(res,401,{error:'User not found'});if(i.hwid)u.hwid=i.hwid;wd(d);js(res,200,{user:{login:u.username,group:u.subType||'Lifetime',buyed_until:u.expiry||'Never'}})}catch(e){res.writeHead(400);res.end('err')}})}
if(url==='/launcher/logout'&&req.method==='POST'){let tk=rt();delete tk[(req.headers['authorization']||'').replace('Bearer ','')];wt(tk);js(res,200,{ok:true});return}
if(req.method==='OPTIONS'){res.writeHead(200,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});res.end();return}
if(url==='/auth'){res.writeHead(302,{'Location':'/auth.html'+(qs?'?'+qs:'')});res.end();return}
if(url==='/api/health'&&req.method==='GET'){
  let d={};
  try{d=rd()}catch(e){d={error:e.message}}
  let sup=[]; try{sup=rs()}catch{}
  js(res,200,{ok:true, storageBase: storage.BASE_DIR, df: DF, upstash: storage.upstashEnabled, gist: storage.gistEnabled, users: (d.users||[]).length, keys: (d.keys||[]).length, telegramIssued: d.telegramIssued? Object.keys(d.telegramIssued).length:0, updatesDir: UD, updates: ru().length, chat: rc().length, support: sup.length, supportMsgs: sup.reduce((a,t)=>a+t.messages.length,0) });
  return;
}
if(url==='/api/backup'&&req.method==='GET'){
  // ручной бэкап для бесплатного тарифа без Upstash — скачать весь data.json
  let d={}; try{d=rd()}catch(e){d={error:e.message}}
  res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="airdlc-backup.json"'});
  res.end(JSON.stringify(d,null,2));
  return;
}
if(url==='/api/restore'&&req.method==='POST'){
  // ручное восстановление из бэкапа
  return rb(req,b=>{
    try{
      const data=JSON.parse(b);
      if(!data.users || !data.keys) return js(res,400,{error:'Invalid backup'});
      wd(data);
      js(res,200,{ok:true, users:data.users.length, keys:data.keys.length});
    }catch(e){ js(res,400,{error:e.message}); }
  });
}
// === Chat API ===
const chatRate = {}; // username -> [timestamps]
function canSendChat(username){
  const now=Date.now();
  if(!chatRate[username]) chatRate[username]=[];
  chatRate[username]=chatRate[username].filter(t=>now-t<10000);
  if(chatRate[username].length>=5) return false;
  if(chatRate[username].length>0 && now-chatRate[username][chatRate[username].length-1]<1500) return false;
  return true;
}
if(url==='/api/chat'&&req.method==='GET'){
  const limit = Math.min(parseInt(params.limit||'100',10)||100, 200);
  const since = params.since ? parseInt(params.since,10) : 0;
  let msgs = rc();
  if(since) msgs = msgs.filter(m=>m.ts>since);
  else msgs = msgs.slice(-limit);
  js(res,200, msgs);
  return;
}
if(url==='/api/chat'&&req.method==='POST'){
  return rb(req, async b=>{
    try{
      const body=JSON.parse(b);
      let username = (body.username||'').trim();
      let text = (body.text||'').trim();
      const token = body.token||'';
      if(!username || !text) return js(res,400,{error:'username and text required'});
      if(text.length>500) return js(res,400,{error:'Message too long (max 500)'});
      if(text.length<1) return js(res,400,{error:'Empty message'});
      const d=rd();
      const u=d.users.find(x=>x.username.toLowerCase()===username.toLowerCase());
      if(!u) return js(res,403,{error:'User not found, please register'});
      if(token){
        const tk=rt()[token];
        if(!tk || tk.username.toLowerCase()!==username.toLowerCase()) return js(res,403,{error:'Invalid token'});
      }
      if(!canSendChat(username)) return js(res,429,{error:'Too fast, wait 1.5s (max 5 per 10s)'});
      const msgs=rc();
      const msg={
        id: crypto.randomBytes(8).toString('hex'),
        user: u.username,
        text: text.slice(0,500),
        ts: Date.now(),
        subType: u.subType||'User',
        admin: u.username=== 'kekainat'
      };
      msgs.push(msg);
      if(msgs.length>500) msgs.splice(0, msgs.length-500);
      wc(msgs);
      // wait for Upstash backup to ensure persistence on free tier
      if(storage.upstashEnabled){
        try{ await storage.backupUpstash('airdlc:chat', msgs); }catch(e){ console.error('[chat] backup failed', e.message); }
      }
      chatRate[username].push(Date.now());
      js(res,200,{ok:true, msg});
    }catch(e){ console.error('/api/chat POST error', e); js(res,400,{error:e.message}); }
  });
}
if(url==='/api/chat/clear'&&req.method==='POST'){
  return rb(req,b=>{
    try{
      const body=JSON.parse(b);
      const username=(body.username||'').trim();
      const token=body.token||'';
      const d=rd();
      const u=d.users.find(x=>x.username.toLowerCase()===username.toLowerCase());
      if(!u || username!=='kekainat') return js(res,403,{error:'Admin only'});
      if(token){
        const tk=rt()[token];
        if(!tk || tk.username!=='kekainat') return js(res,403,{error:'Invalid admin token'});
      }
      wc([]);
      js(res,200,{ok:true});
    }catch(e){ js(res,400,{error:e.message}); }
  });
}
if(url==='/api/chat/online'&&req.method==='GET'){
  const d=rd();
  const users=d.users.map(u=>({username:u.username, subType:u.subType, admin:u.username==='kekainat'}));
  js(res,200,{users, total:users.length, online: users.length});
  return;
}
// === Support API (техподдержка, пересылает в Telegram админу) ===
const supportRate = {};
function canSupportSend(username){
  const now=Date.now();
  if(!supportRate[username]) supportRate[username]=[];
  supportRate[username]=supportRate[username].filter(t=>now-t<60000);
  if(supportRate[username].length>=5) return false;
  if(supportRate[username].length>0 && now-supportRate[username][supportRate[username].length-1]<3000) return false;
  return true;
}
function tgNotifyAdmin(ticket, userMsg){
  if(!SUPPORT_ADMIN_ID) return Promise.resolve({ok:false, skipped:true});
  return new Promise((resolve,reject)=>{
    const d=rd();
    const u=d.users.find(x=>x.username===ticket.user);
    const email = u ? u.email : 'unknown';
    const sub = u ? (u.subType||'User') : 'Unknown';
    const text = `🔧 *Новая заявка в техподдержку*\n\n👤 Пользователь: \`${ticket.user}\` (${sub})\n📧 Email: ${email}\n🆔 Ticket: \`${ticket.id}\`\n📝 Сообщение:\n${userMsg.text}\n\nВсего сообщений: ${ticket.messages.length} | Статус: ${ticket.status}`;
    const body=JSON.stringify({
      chat_id: SUPPORT_ADMIN_ID,
      text,
      parse_mode:'Markdown',
      reply_markup:{
        inline_keyboard:[
          [{text:'💬 Ответить', callback_data:`support_reply:${ticket.id}`},{text:'✅ Закрыть', callback_data:`support_close:${ticket.id}`}],
          [{text:'👤 Профиль', callback_data:`support_user:${ticket.user}`},{text:'📋 Открыть на сайте', url: SITE_URL || 'https://airdlc.onrender.com/support.html'}]
        ]
      }
    });
    const req=require('https').request({
      hostname:'api.telegram.org',
      path:`/bot${BOT_TOKEN_SRV}/sendMessage`,
      method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, res=>{
      let buf=''; res.on('data',c=>buf+=c); res.on('end',()=>{
        try{ const j=JSON.parse(buf); if(!j.ok) console.error('[support] tgNotify failed', j.description); resolve(j); }catch(e){ resolve({ok:false, error:e.message}); }
      });
    });
    req.on('error',e=>{ console.error('[support] tgNotify error', e.message); resolve({ok:false}); });
    req.write(body); req.end();
  });
}
if(url==='/api/support'&&req.method==='GET'){
  const username=(params.username||'').trim();
  if(!username) return js(res,400,{error:'username required'});
  const all=rs();
  const isAdmin = username==='kekainat' || username===SUPPORT_ADMIN_USERNAME;
  let out;
  if(isAdmin){
    out=all;
  } else {
    out=all.filter(t=>t.user===username);
  }
  // sort by updated desc
  out = out.slice().sort((a,b)=>b.updated-a.updated);
  js(res,200,out.slice(0,50));
  return;
}
if(url==='/api/support'&&req.method==='POST'){
  return rb(req, async b=>{
    try{
      const body=JSON.parse(b);
      let username=(body.username||'').trim();
      let text=(body.text||'').trim();
      const token=body.token||'';
      if(!username || !text) return js(res,400,{error:'username and text required'});
      if(text.length>2000) return js(res,400,{error:'Too long (max 2000)'});
      const d=rd();
      const u=d.users.find(x=>x.username.toLowerCase()===username.toLowerCase());
      if(!u) return js(res,403,{error:'User not found'});
      if(token){
        const tk=rt()[token];
        if(!tk || tk.username.toLowerCase()!==username.toLowerCase()) return js(res,403,{error:'Invalid token'});
      }
      if(!canSupportSend(username)) return js(res,429,{error:'Подожди 3 сек (лимит 5/мин)'});
      let tickets=rs();
      let ticket=tickets.find(t=>t.user===username && t.status==='open');
      const now=Date.now();
      const msg={id: crypto.randomBytes(6).toString('hex'), from:'user', user: username, text, ts: now};
      if(ticket){
        ticket.messages.push(msg);
        ticket.updated=now;
      } else {
        ticket={
          id: crypto.randomBytes(6).toString('hex'),
          user: username,
          email: u.email,
          status:'open',
          created: now,
          updated: now,
          messages:[msg]
        };
        tickets.push(ticket);
      }
      if(tickets.length>200) tickets=tickets.slice(-200);
      ws(tickets);
      if(storage.upstashEnabled) try{ await storage.backupUpstash('airdlc:support', tickets); }catch{}
      supportRate[username].push(now);
      js(res,200,{ok:true, ticketId: ticket.id, msg});
      // notify admin in background
      tgNotifyAdmin(ticket, msg).catch(()=>{});
      // auto-reply via Gemini (самая легкая модель, не отвечаем админу самому)
      if(GEMINI_API_KEY && username!=='kekainat' && username!==SUPPORT_ADMIN_USERNAME){
        setTimeout(async()=>{
          try{
            const replyText = await generateAutoReply(ticket, msg);
            if(!replyText || replyText.trim().length<5) return;
            let cur=rs();
            let curTicket=cur.find(x=>x.id===ticket.id);
            if(!curTicket || curTicket.status==='closed') return;
            const last=curTicket.messages[curTicket.messages.length-1];
            if(last && last.from==='admin' && Date.now()-last.ts < 8000) return; // human just replied
            const autoMsg={id: crypto.randomBytes(6).toString('hex'), from:'admin', user:'Support', text: replyText, ts: Date.now(), admin:'AutoBot', auto:true};
            curTicket.messages.push(autoMsg);
            curTicket.updated=Date.now();
            ws(cur);
            if(storage.upstashEnabled) try{ await storage.backupUpstash('airdlc:support', cur); }catch{}
            console.log(`[auto-reply] to ${curTicket.user} ticket ${curTicket.id}: ${replyText.slice(0,70)}`);
            // уведомить админа что сработал автоответчик
            if(SUPPORT_ADMIN_ID){
              const body2=JSON.stringify({chat_id: SUPPORT_ADMIN_ID, text:`🤖 Автоответчик ответил пользователю \`${curTicket.user}\` (тикет \`${curTicket.id}\`):\n\n${replyText.slice(0,900)}`, parse_mode:'Markdown', reply_markup:{inline_keyboard:[[{text:'💬 Ответить', callback_data:`support_reply:${curTicket.id}`},{text:'✅ Закрыть', callback_data:`support_close:${curTicket.id}`}]]}});
              const req=require('https').request({hostname:'api.telegram.org', path:`/bot${BOT_TOKEN_SRV}/sendMessage`, method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body2)}}, res2=>{ let b=''; res2.on('data',c=>b+=c); res2.on('end',()=>{}); });
              req.on('error',()=>{}); req.write(body2); req.end();
            }
          }catch(e){ console.error('[auto-reply] failed', e.message); }
        }, 1800);
      }
    }catch(e){ console.error('/api/support POST', e); js(res,400,{error:e.message}); }
  });
}
if(url==='/api/support/close'&&req.method==='POST'){
  return rb(req, async b=>{
    try{
      const body=JSON.parse(b);
      const username=(body.username||'').trim();
      const ticketId=(body.ticketId||'').trim();
      const token=body.token||'';
      if(!ticketId) return js(res,400,{error:'ticketId required'});
      const d=rd();
      const u=d.users.find(x=>x.username.toLowerCase()===username.toLowerCase());
      const isAdmin = username==='kekainat' || username===SUPPORT_ADMIN_USERNAME;
      // allow owner or admin to close
      let tickets=rs();
      const t=tickets.find(x=>x.id===ticketId);
      if(!t) return js(res,404,{error:'Ticket not found'});
      if(t.user!==username && !isAdmin) return js(res,403,{error:'No access'});
      t.status='closed';
      t.updated=Date.now();
      t.messages.push({id: crypto.randomBytes(6).toString('hex'), from:'system', text: `Тикет закрыт ${username}`, ts: Date.now()});
      ws(tickets);
      if(storage.upstashEnabled) try{ await storage.backupUpstash('airdlc:support', tickets); }catch{}
      js(res,200,{ok:true});
    }catch(e){ js(res,400,{error:e.message}); }
  });
}
if(url==='/api/support/reply'&&req.method==='POST'){
  // reply from website admin panel (alternative to bot)
  return rb(req, async b=>{
    try{
      const body=JSON.parse(b);
      const username=(body.username||'').trim();
      const ticketId=(body.ticketId||'').trim();
      let text=(body.text||'').trim();
      const token=body.token||'';
      if(!ticketId || !text) return js(res,400,{error:'ticketId and text required'});
      const isAdmin = username==='kekainat';
      if(!isAdmin) return js(res,403,{error:'Admin only'});
      if(token){
        const tk=rt()[token];
        if(!tk || tk.username!=='kekainat') return js(res,403,{error:'Invalid token'});
      }
      let tickets=rs();
      const t=tickets.find(x=>x.id===ticketId);
      if(!t) return js(res,404,{error:'Ticket not found'});
      const msg={id: crypto.randomBytes(6).toString('hex'), from:'admin', user: 'Support', text, ts: Date.now(), admin: username};
      t.messages.push(msg);
      t.updated=Date.now();
      t.status='open';
      ws(tickets);
      if(storage.upstashEnabled) try{ await storage.backupUpstash('airdlc:support', tickets); }catch{}
      js(res,200,{ok:true, msg});
    }catch(e){ js(res,400,{error:e.message}); }
  });
}
let fp=path.join(__dir,url==='/'?'index.html':url),ext=path.extname(fp);
fs.readFile(fp,(e,d)=>{if(e)fs.readFile(path.join(__dir,'index.html'),(_,h)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(h)});else{res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});res.end(d)}})}).listen(PORT, async ()=>{
  // Восстановление с Upstash/Gist для бесплатного тарифа (если настроено)
  try{
    if (storage.init) {
      console.log('[storage] init: проверка удаленного хранилища (Upstash/Gist)...');
      await storage.init();
      console.log('[storage] init done');
    }
  }catch(e){ console.error('[storage] init error', e.message); }

  seed(rd());
  console.log('Air DLC: http://localhost:'+PORT);
  console.log(`[storage] using BASE_DIR=${storage.BASE_DIR} DF=${DF} upstash=${storage.upstashEnabled} gist=${storage.gistEnabled}`);
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || `http://localhost:${PORT}/`;
  const https = require('https');
  function pingSelf(){
    const lib = SELF_URL.startsWith('https') ? https : http;
    lib.get(SELF_URL, r=>{
      console.log(`[keep-alive] ping ${SELF_URL} -> ${r.statusCode}`);
      r.on('data',()=>{});
    }).on('error', e=> console.error('[keep-alive] error', e.message));
  }
  setInterval(pingSelf, 10*60*1000);
  setTimeout(pingSelf, 60*1000);
  console.log(`[keep-alive] enabled every 10m -> ${SELF_URL}`);

  try {
    const bot = require('./bot');
    bot.startBot();
  } catch(e){ console.error('[bot] failed to start', e.message, e.stack); }
});
