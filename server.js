const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||8080,__dir=__dirname;
const DF=path.join(__dir,'data.json'),TF=path.join(__dir,'tokens.json'),UD=path.join(__dir,'updates'),UF=path.join(__dir,'updates.json');
if(!fs.existsSync(UD))fs.mkdirSync(UD,{recursive:true});
const rd=()=>{try{return JSON.parse(fs.readFileSync(DF,'utf8'))}catch(e){return{users:[],keys:[],seeded:false}}};
const wd=d=>fs.writeFileSync(DF,JSON.stringify(d,null,2),'utf8');
const rt=()=>{try{return JSON.parse(fs.readFileSync(TF,'utf8'))}catch(e){return{}}};
const wt=t=>fs.writeFileSync(TF,JSON.stringify(t,null,2),'utf8');
const ru=()=>{try{return JSON.parse(fs.readFileSync(UF,'utf8'))}catch(e){return[]}};
const wu=u=>fs.writeFileSync(UF,JSON.stringify(u,null,2),'utf8');
const gt=()=>crypto.randomBytes(32).toString('hex');
const MIME={'.html':'text/html','.css':'text/css','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.json':'application/json','.exe':'application/octet-stream','.zip':'application/zip'};
const rb=(req,cb)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>cb(b))};
const rbr=(req,cb)=>{let c=[];req.on('data',d=>c.push(d));req.on('end',()=>cb(Buffer.concat(c)))};
function seed(d){if(d.seeded)return d;d.seeded=true;if(!d.users)d.users=[];if(!d.keys)d.keys=[];const A='kekainat';if(!d.users.find(u=>u.username===A))d.users.push({username:A,email:'admin@airdlc.me',password:'kekainat',key:'ADMIN-PANEL',subType:'Lifetime',expiry:'Never',hwid:'ADMIN-HWID',joinDate:new Date().toISOString()});[{key:'AIR-TEST-KEY1-2024',subType:'Lifetime'},{key:'AIR-DEMO-XXXX-9999',subType:'1 Month'},{key:'AIR-PREM-ABCD-7777',subType:'3 Months'}].forEach(k=>{if(!d.keys.find(x=>x.key===k.key))d.keys.push({...k,used:false,usedBy:null,usedDate:null,createdBy:A,createdDate:new Date().toISOString()})});wd(d);return d}
function mp(buf,bnd){let r={fields:{},file:null},bb=Buffer.from('--'+bnd),ps=[],s=0;while(true){let i=buf.indexOf(bb,s);if(i===-1)break;if(s>0)ps.push(buf.slice(s,i-2));s=i+bb.length}ps.forEach(p=>{let he=p.indexOf('\r\n\r\n');if(he===-1)return;let h=p.slice(0,he).toString(),b=p.slice(he+4);if(b.length>=2&&b[b.length-2]===13&&b[b.length-1]===10)b=b.slice(0,-2);let nm=h.match(/name="([^"]+)"/),fm=h.match(/filename="([^"]+)"/);if(nm){if(fm)r.file={fieldname:nm[1],filename:fm[1],data:b};else r.fields[nm[1]]=b.toString()}});return r}
function js(res,code,obj){res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(obj))}
function findUser(users,inp){return users.find(x=>x.username.toLowerCase()===inp.username.toLowerCase()&&x.password===inp.password)}
http.createServer((req,res)=>{let url=req.url.split('?')[0],qs=req.url.split('?')[1]||'',params={};qs.split('&').forEach(p=>{let kv=p.split('=');if(kv[0])params[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||'')});
if(url==='/api/data'&&req.method==='GET'){js(res,200,{users:seed(rd()).users,keys:seed(rd()).keys});return}
if(url==='/api/data'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),d=rd();if(i.users)d.users=i.users;if(i.keys)d.keys=i.keys;wd(d);js(res,200,{ok:true})}catch(e){res.writeHead(400);res.end('err')}});
if(url==='/api/login'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),d=rd(),u=findUser(d.users,i);if(!u)return js(res,401,{error:'Invalid credentials'});let t=gt(),tk=rt();tk[t]={username:u.username,created:Date.now()};wt(tk);js(res,200,{token:t,username:u.username})}catch(e){res.writeHead(400);res.end('err')}});
if(url==='/api/validate'&&req.method==='GET'){let t=rt()[params.token];if(!t)return js(res,401,{valid:false});let d=rd(),u=d.users.find(x=>x.username===t.username);return u?js(res,200,{valid:true,username:u.username,subType:u.subType,expiry:u.expiry}):js(res,401,{valid:false})}
if(url==='/api/logout'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),tk=rt();delete tk[i.token];wt(tk);js(res,200,{ok:true})}catch(e){res.writeHead(400);res.end('err')}});
if(url==='/api/updates'&&req.method==='GET'){js(res,200,ru());return}
if(url==='/api/updates/upload'&&req.method==='POST'){let ct=req.headers['content-type']||'',bn=ct.split('boundary=')[1];if(!bn)return js(res,400,{error:'No boundary'});return rbr(req,buf=>{try{let p=mp(buf,bn),v=p.fields.version||'unknown',n=p.fields.notes||'',t=p.fields.type||'release',fn=p.file?p.file.filename:null,id=v.replace(/[^a-zA-Z0-9.-]/g,'_')+'_'+Date.now();if(p.file)fs.writeFileSync(path.join(UD,id+path.extname(p.file.filename)),p.file.data);let u=ru(),e={id,version:v,notes:n,type:t,filename:fn,savedAs:p.file?id+path.extname(p.file.filename):null,size:p.file?p.file.data.length:0,date:new Date().toISOString()};u.unshift(e);wu(u);js(res,200,{ok:true,update:e})}catch(e){res.writeHead(500);res.end(e.message)}})}
if(url==='/api/updates/delete'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),u=ru(),upd=u.find(x=>x.id===i.id);if(upd&&upd.savedAs){let f=path.join(UD,upd.savedAs);if(fs.existsSync(f))fs.unlinkSync(f)}wu(u.filter(x=>x.id!==i.id));js(res,200,{ok:true})}catch(e){res.writeHead(400);res.end('err')}});
if(url.startsWith('/api/updates/download/')&&req.method==='GET'){let id=url.split('/api/updates/download/')[1],u=ru(),upd=u.find(x=>x.id===id);if(!upd||!upd.savedAs)return js(res,404,{error:'Not found'});let f=path.join(UD,upd.savedAs);if(!fs.existsSync(f))return js(res,404,{error:'File not found'});res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+(upd.filename||upd.savedAs)+'"'});fs.createReadStream(f).pipe(res);return}
if(url==='/launcher/login'&&req.method==='POST')return rb(req,b=>{try{let i=JSON.parse(b),d=rd(),u=findUser(d.users,i);if(!u)return js(res,401,{error:'Invalid credentials'});let t=gt(),tk=rt();tk[t]={username:u.username,created:Date.now()};wt(tk);js(res,200,{user:{login:u.username,group:u.subType||'Lifetime',buyed_until:u.expiry||'Never'},token:t})}catch(e){res.writeHead(400);res.end('err')}});
if(url==='/launcher/login-by-token'&&req.method==='POST'){let ath=(req.headers['authorization']||'').replace('Bearer ','');return rb(req,b=>{try{let i=JSON.parse(b),tk=rt(),t=tk[ath];if(!t)return js(res,401,{error:'Invalid token'});let d=rd(),u=d.users.find(x=>x.username===t.username);if(!u)return js(res,401,{error:'User not found'});if(i.hwid)u.hwid=i.hwid;wd(d);js(res,200,{user:{login:u.username,group:u.subType||'Lifetime',buyed_until:u.expiry||'Never'}})}catch(e){res.writeHead(400);res.end('err')}})}
if(url==='/launcher/logout'&&req.method==='POST'){let tk=rt();delete tk[(req.headers['authorization']||'').replace('Bearer ','')];wt(tk);js(res,200,{ok:true});return}
if(req.method==='OPTIONS'){res.writeHead(200,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'});res.end();return}
if(url==='/auth'){res.writeHead(302,{'Location':'/auth.html'+(qs?'?'+qs:'')});res.end();return}
let fp=path.join(__dir,url==='/'?'index.html':url),ext=path.extname(fp);
fs.readFile(fp,(e,d)=>{if(e)fs.readFile(path.join(__dir,'index.html'),(_,h)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(h)});else{res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});res.end(d)}})}).listen(PORT,()=>{
  seed(rd());
  console.log('Air DLC: http://localhost:'+PORT);
  // keep-alive bot for Render free tier (sleeps after 15m idle) - ping every 10m
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

  // Telegram bot hosting (same process, no extra deps)
  try {
    const bot = require('./bot');
    bot.startBot();
  } catch(e){ console.error('[bot] failed to start', e.message); }
});