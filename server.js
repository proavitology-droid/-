'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const PAGE=fs.readFileSync(path.join(__dirname,'index.html'));
const hits=new Map();
function respond(res,code,obj){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));}
function valid(raw){
  if(typeof raw!=='string'||raw.length>2200)throw Error('Вставьте ссылку на поисковую выдачу Авито.');
  let u;try{u=new URL(raw.trim());}catch{throw Error('Ссылка не распознана.');}
  if(u.protocol!=='https:'||!['avito.ru','www.avito.ru','m.avito.ru'].includes(u.hostname)||u.port||u.username||u.password)throw Error('Нужна ссылка https://www.avito.ru/...');
  if(u.pathname==='/'||/^\/(account|user|profile|legal)(\/|$)/i.test(u.pathname))throw Error('Нужна именно ссылка на поисковую выдачу.');
  u.searchParams.delete('p');u.searchParams.delete('page');u.hash='';return u.href;
}
function status(obj){
  let yes=false,no=false;const seen=new WeakSet();
  function scan(o,d){
    if(!o||typeof o!=='object'||d>5||seen.has(o))return;seen.add(o);
    for(const [key,v] of Object.entries(o)){
      const k=key.toLowerCase().replace(/[-_]/g,'');
      if(['ispromoted','isboosted','haspromotion','haspaidpromotion','ispaidpromotion'].includes(k)){if(v===true||v===1)yes=true;if(v===false||v===0)no=true;}
      if(['promotions','promotion','vas','appliedvas','paidservices','promotiontypes'].includes(k)){
        if(Array.isArray(v)&&v.length===0)no=true;
        const txt=typeof v==='string'?v:JSON.stringify(v||'').slice(0,1200);
        if(/продвинуто|продвигается|promoted|boost|pushup|premium|highlight|bbip|turbo_sale|quick_sale|x[0-9]+_[17]|\bxl\b/i.test(txt))yes=true;
      }
      if(['badges','labels'].includes(k)&&/продвинуто|продвигается/i.test(JSON.stringify(v||'').slice(0,1000)))yes=true;
      if(v&&typeof v==='object'&&!['description','photos','images','seller','gallery','contacts','user'].includes(k))scan(v,d+1);
    }
  }scan(obj,0);return yes?'yes':no?'no':'unknown';
}
function attr(tag,name){const m=tag.match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))','i'));return m?(m[1]||m[2]||m[3]||''):'';}
function iid(o){const x=o&&typeof o==='object'?(o.value&&typeof o.value==='object'?o.value:o):{};const id=[x.id,x.itemId,x.item_id,x.adId,x.item?.id].find(v=>/^\d{6,14}$/.test(String(v||'')));return id?String(id):null;}
function collectArrays(root){
 let arr=[];const seen=new WeakSet();
 function walk(o,p,d){
  if(!o||typeof o!=='object'||d>9||seen.has(o))return;seen.add(o);
  if(Array.isArray(o)){
    const v=o.filter(x=>iid(x));
    if(v.length&&v.length<=150){
      let score=v.length/o.length;
      if(/catalog|serp|search|result/.test(p))score+=10;
      if(/\.items$/.test(p))score+=6;
      if(/similar|recommend|history/.test(p))score-=10;
      arr.push({v,score});return;
    }
    o.slice(0,20).forEach((x,i)=>walk(x,p+'.'+i,d+1));
  }else for(const [k,v] of Object.entries(o))if(v&&typeof v==='object')walk(v,p+'.'+k,d+1);
 }walk(root,'root',0);
 arr.sort((a,b)=>b.score-a.score||b.v.length-a.v.length);
 return arr[0]?.v||[];
}
function scripts(html){
 let roots=[];
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
  const s=m[2].trim(),id=attr(m[1],'id');
  if(s.length>7000000||!(id.includes('initialData')||s.includes('__initialData__')||attr(m[1],'type')==='application/json'))continue;
  const c=[s];
  if(s.startsWith('%7B')){try{c.push(decodeURIComponent(s));}catch{}}
  const a=s.match(/__initialData__\s*=\s*(['"])(.*?)\1\s*[;,]/s);
  if(a){c.push(a[2]);try{c.push(decodeURIComponent(a[2]));}catch{}}
  for(const x of c){try{const v=JSON.parse(x);if(v&&typeof v==='object'){roots.push(v);break;}}catch{}}
 }return roots;
}
function cards(html){
 const clean=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
 const out=[],stack=[],re=/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
 const voids=new Set(['input','img','br','hr','meta','link','source','wbr','area']);
 let m;
 while((m=re.exec(clean))){
  const tag=m[1].toLowerCase(),token=m[0];
  if(token.startsWith('</')){
   while(stack.length){const s=stack.pop();if(s.card)out.push(clean.slice(s.start,re.lastIndex));if(s.tag===tag)break;}
  }else if(!voids.has(tag)&&!token.endsWith('/>')){
   const marker=attr(token,'data-marker'),testid=attr(token,'data-testid'),id=attr(token,'data-item-id');
   const isCard=marker==='item'||marker==='catalog-serp-item'||testid==='item'||/^\d{6,14}$/.test(id);
   stack.push({tag,start:m.index,card:isCard&&!stack.some(s=>s.card)});
  }
 }
 return out;
}
function analyze(html,url){
 if(typeof html!=='string'||!html.trim()||html.length>9000000)throw Error('Не удалось прочитать HTML или файл слишком большой.');
 if(/captcha|подтвердите, что вы не робот|доступ ограничен/i.test(html.slice(0,6000)))throw Error('Авито запросил проверку или ограничил доступ.');
 const map=new Map();
 const roots=scripts(html);
 let dataset=[];
 for(const root of roots){const a=collectArrays(root);if(a.length>dataset.length)dataset=a;}
 for(const raw of dataset){
  const id=iid(raw);if(!id||map.has(id))continue;
  const v=raw.value&&typeof raw.value==='object'?raw.value:raw;
  map.set(id,{id,title:String(v.title||v.name||'').slice(0,140),state:status(raw)});
 }
 for(const card of cards(html)){
  const tag=card.match(/^<[^>]+>/)?.[0]||'';
  const id=attr(tag,'data-item-id')||attr(tag,'data-itemid')||card.match(/_(\d{6,14})(?:[?"'/]|$)/)?.[1];
  if(!/^\d{6,14}$/.test(String(id||'')))continue;
  const positive=/(?:data-marker|data-testid)\s*=\s*['"][^'"]*(?:promotion|promot|boost)[^'"]*['"]|(?:aria-label|title)\s*=\s*['"][^'"]*(?:Продвинуто|Продвигается)[^'"]*['"]/i.test(card)||/\bПродвинуто\b/i.test(card.replace(/<[^>]+>/g,' ').slice(0,1500));
  const prev=map.get(id);
  if(prev){if(positive)prev.state='yes';}
  else map.set(id,{id,title:'',state:positive?'yes':'unknown'});
 }
 if(!map.size)throw Error('Не удалось прочитать объявления. Авито мог изменить разметку страницы.');
 const arr=[...map.values()],promo=arr.filter(x=>x.state==='yes'),unknown=arr.filter(x=>x.state==='unknown');
 return {url,total:arr.length,promoted:promo.length,unknown:unknown.length,sharePercent:Math.round(100*promo.length/arr.length),complete:unknown.length===0,checkedAt:new Date().toISOString(),note:unknown.length?'Явные признаки продвижения найдены, но у '+unknown.length+' объявлений статус не удалось проверить. Итог является нижней оценкой.':'Статус продвижения найден у всех обнаруженных объявлений.'};
}
async function readBody(req){
 return new Promise((ok,bad)=>{let body='',failed=false;req.on('data',c=>{body+=c;if(body.length>9000000&&!failed){failed=true;bad(Error('Файл больше 9 МБ.'));req.destroy();}});req.on('end',()=>{if(!failed){try{ok(JSON.parse(body));}catch{bad(Error('Неверный формат запроса.'));}}});req.on('error',bad);});
}
async function fetchPage(url){
 const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),14000);
 try{
  let current=url,html='';
  for(let n=0;n<2;n++){
   const r=await fetch(current,{signal:ctrl.signal,redirect:'manual',headers:{'user-agent':'Mozilla/5.0 (compatible; AvitoPromotionAnalyzer/1.0)','accept':'text/html','accept-language':'ru-RU,ru;q=0.9'}});
   if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)throw Error('Авито перенаправил запрос.');current=valid(new URL(loc,current).href);continue;}
   if(r.status===403||r.status===429)throw Error('Авито заблокировал автоматическую проверку (HTTP '+r.status+').');
   if(!r.ok)throw Error('Авито вернул HTTP '+r.status+'.');
   if(!(r.headers.get('content-type')||'').includes('text/html'))throw Error('По ссылке не HTML-страница.');
   html=await r.text();break;
  }
  if(!html)throw Error('Не удалось получить страницу.');
  return html;
 }finally{clearTimeout(t);}
}

const paidUsage={day:'',count:0};
async function analyzeWithProvider(url){
 const token=process.env.APIFY_TOKEN;
 if(!token)throw Error('Автоматическая проверка пока не подключена. Авито блокирует прямые запросы (HTTP 403). Для проверки сейчас раскройте блок «Проверка сохранённой страницы» ниже.');
 const day=new Date().toISOString().slice(0,10);
 if(paidUsage.day!==day){paidUsage.day=day;paidUsage.count=0;}
 const max=Math.min(100,Math.max(1,Number(process.env.APIFY_DAILY_LIMIT||20)));
 if(paidUsage.count>=max)throw Error('Сегодня достигнут лимит проверок. Попробуйте завтра.');
 paidUsage.count++;
 const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),115000);
 try{
  const endpoint='https://api.apify.com/v2/acts/dami_studio~avito-listings-scraper/run-sync-get-dataset-items?format=json&timeout=110';
  const response=await fetch(endpoint,{
   method:'POST',signal:ctrl.signal,
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},
   body:JSON.stringify({searchUrls:[url],maxItems:50,maxPagesPerSearch:1,localOnly:false,sellerType:'any',sort:'default'})
  });
  if(!response.ok){
    if(response.status===401||response.status===403)throw Error('Не удалось авторизоваться у поставщика данных. Проверьте API-токен.');
    if(response.status===408)throw Error('Проверка заняла слишком много времени. Попробуйте повторить запрос.');
    throw Error('Поставщик данных временно недоступен (HTTP '+response.status+').');
  }
  const result=await response.json();
  if(!Array.isArray(result))throw Error('Поставщик данных вернул неожиданный ответ.');
  const notices=result.filter(x=>x&&typeof x==='object'&&
    (x.status&&x.status!=='ok'&&x.status!=='success' || x._type==='error'));
  if(notices.length&& !result.some(x=>x&&x.listingId)){
    const descriptions=notices.map(x=>String(x.message||x.error||x.status)).slice(0,3);
    throw Error('Не удалось прочитать выдачу: '+descriptions.join('; '));
  }
  const rows=[...new Map(result.filter(x=>x&&typeof x==='object'&&(x.listingId||x.itemId) &&
    (!x.status||x.status==='ok'||x.status==='success'))
    .map(x=>[String(x.listingId||x.itemId),x])).values()].slice(0,50);
  if(!rows.length)throw Error('По этой ссылке не удалось получить объявления. Уточните фильтры и попробуйте снова.');
  const yes=rows.filter(x=>x.isPromoted===true);
  const unknown=rows.filter(x=>typeof x.isPromoted!=='boolean');
  return {url,total:rows.length,promoted:yes.length,unknown:unknown.length,
   sharePercent:Math.round(100*yes.length/rows.length),
   complete:unknown.length===0 && !notices.length,
   checkedAt:new Date().toISOString(),
   note:unknown.length?'У '+unknown.length+' объявлений поставщик не определил статус продвижения. Это минимальное подтверждённое количество.':
     'Подсчитаны объявления с признаком платного продвижения на первой странице. Источник: Apify.'};
 }catch(e){
  if(e?.name==='AbortError')throw Error('Проверка превысила лимит времени. Попробуйте повторить.');
  throw e;
 }finally{clearTimeout(t);}
}

http.createServer(async(req,res)=>{
 const route=new URL(req.url||'/', 'http://localhost').pathname;
 if(req.method==='GET'&&route==='/api/health')return respond(res,200,{ok:true,version:'1.0.0'});
 if(req.method==='GET'&&route==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(PAGE);}
 if(req.method==='POST'&&(route==='/api/check'||route==='/api/check-html')){
  const ip=req.socket.remoteAddress||'unknown',now=Date.now(),h=hits.get(ip)||{at:now,n:0};
  if(now-h.at>3600000){h.at=now;h.n=0;}if(h.n++>19)return respond(res,429,{error:'Лимит 20 проверок в час. Попробуйте позже.'});hits.set(ip,h);
  try{
   const body=await readBody(req),url=valid(body.url);
   if(route==='/api/check'){return respond(res,200,await analyzeWithProvider(url));}
   const html=route==='/api/check-html'?body.html:await fetchPage(url);
   return respond(res,200,analyze(html,url));
  }catch(e){return respond(res,422,{error:e?.message||'Не удалось проверить выдачу.'});}
 }
 return respond(res,404,{error:'Не найдено'});
}).listen(Number(process.env.PORT||3000),'0.0.0.0');

// One-time startup diagnostic: tests availability without storing or collecting listing details.
if(process.env.AVITO_SELFTEST === '1'){(async()=>{try{const h=await fetchPage('https://www.avito.ru/moskva?q=remont');const r=analyze(h,'https://www.avito.ru/moskva?q=remont');console.log('AVITO_SELFTEST_OK',JSON.stringify({total:r.total,promoted:r.promoted,unknown:r.unknown}));}catch(e){console.log('AVITO_SELFTEST_BLOCKED',e.message)}})();}
