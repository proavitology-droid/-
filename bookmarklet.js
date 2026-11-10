(function () {
  'use strict';
  var POP_ID = '__avito_promo_checker_widget';
  var previous = document.getElementById(POP_ID);
  if (previous) previous.remove();

  if (!/^(?:www\.|m\.)?avito\.ru$/i.test(location.hostname)) {
    alert('Откройте поисковую выдачу на avito.ru, а затем нажмите закладку «Проверить продвижение».');
    return;
  }

  var STYLE = 'font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.45;color:#142039;box-sizing:border-box;';
  var box = document.createElement('div');
  box.id = POP_ID;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Подсчёт продвижения в выдаче Авито');
  box.style.cssText = STYLE + 'position:fixed;top:20px;right:20px;width:min(390px,calc(100vw - 30px));max-height:calc(100vh - 40px);overflow:auto;z-index:2147483647;background:white;border:1px solid #e4e9f0;box-shadow:0 10px 55px #0b152755;border-radius:16px;padding:20px;';
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px;';
  var title = document.createElement('div');
  title.textContent = '↗ Продвижение в выдаче';
  title.style.cssText = 'font-weight:800;font-size:17px;color:#142039;';
  var close = document.createElement('button');
  close.textContent = '×';
  close.title = 'Закрыть';
  close.style.cssText = 'border:0;background:#f1f3f6;border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:22px;color:#425268;';
  close.addEventListener('click', function(){box.remove()});
  header.appendChild(title);
  header.appendChild(close);
  box.appendChild(header);

  var status = document.createElement('div');
  status.textContent = 'Считаем объявления на открытой странице…';
  status.style.cssText = 'color:#67768b;font-size:13px;margin-bottom:10px;';
  box.appendChild(status);

  var result = document.createElement('div');
  result.style.cssText = 'background:#f7f8fb;border-radius:12px;padding:15px 16px;margin-bottom:13px;color:#142039;';
  box.appendChild(result);

  var note = document.createElement('div');
  note.style.cssText = 'color:#59677c;font-size:12px;line-height:1.6;margin-bottom:16px;';
  box.appendChild(note);

  var controls = document.createElement('div');
  controls.style.cssText = 'display:flex;gap:9px;flex-wrap:wrap;';
  function button(label,color){
    var b=document.createElement('button');
    b.textContent=label;
    b.style.cssText='appearance:none;border:0;border-radius:9px;padding:10px 12px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;background:'+color+';color:'+(color==='#e8edf4'?'#273b54':'white')+';';
    controls.appendChild(b);
    return b;
  }
  var refresh=button('↻ Пересчитать','#e8edf4');
  var load=button('↓ Прогрузить карточки','#ed615b');
  box.appendChild(controls);
  document.body.appendChild(box);

  function getCardId(el){
    var id=el.getAttribute('data-item-id')||el.getAttribute('data-itemid')||'';
    if(!id){
      var inner=el.querySelector('[data-item-id]');
      if(inner) id=inner.getAttribute('data-item-id')||'';
    }
    if(!id){
      var href=el.querySelector('a[href*="_"]');
      var match=href && href.getAttribute('href').match(/_(\d{6,14})(?:[?/#]|$)/);
      if(match) id=match[1];
    }
    return /^\d{6,14}$/.test(id)?id:'';
  }

  function collectCards(){
    var selector='[data-marker="item"],[data-marker="catalog-serp-item"],[data-testid="item"],[data-item-id]';
    var nodes=Array.prototype.slice.call(document.querySelectorAll(selector));
    var picked=[],ids=new Set();
    nodes.forEach(function(el){
      if(el.closest('#'+POP_ID))return;
      if(nodes.some(function(parent){return parent!==el&&parent.contains(el)&&picked.indexOf(parent)!==-1}))return;
      if(!el.getClientRects().length)return;
      var id=getCardId(el),key=id||'n'+picked.length;
      if(ids.has(key))return;
      ids.add(key);
      picked.push({el:el,id:id,key:key});
    });
    return picked;
  }

  function promotionFromElement(el){
    // Only count explicit promotion indicators, not generic ads or sales messages.
    var selectors='[data-marker],[data-testid],[aria-label],[title]';
    var nodes=[el].concat(Array.prototype.slice.call(el.querySelectorAll(selectors)));
    for(var i=0;i<nodes.length;i++){
      var node=nodes[i];
      var marker=['data-marker','data-testid','aria-label','title','data-promotion'].map(function(k){return node.getAttribute(k)||''}).join(' ');
      if(/(?:\bpromoted\b|(?:^|[\s:/_-])promot(?:ion|ed)(?:$|[\s:/_-])|продвинуто|продвигается|платное продвижение)/i.test(marker))return true;
    }
    var txt=(el.innerText||el.textContent||'').slice(0,7000);
    return /(?:^|\s)(?:Продвинуто|Продвигается)(?:$|[.!,\s])/i.test(txt);
  }

  function preloadedStates(){
    var roots=[];
    function add(raw){
      if(!raw)return;
      if(typeof raw==='object'){roots.push(raw);return;}
      if(typeof raw!=='string'||raw.length>8000000)return;
      var attempts=[raw];
      if(raw.indexOf('%7B')!==-1||raw.indexOf('%5B')!==-1){
        try{attempts.push(decodeURIComponent(raw));}catch(e){}
      }
      attempts.forEach(function(s){try{var x=JSON.parse(s);if(x&&typeof x==='object')roots.push(x)}catch(e){}});
    }
    try{add(window.__initialData__);}catch(e){}
    try{add(window.__PRELOADED_STATE__);}catch(e){}
    try{add(window.__NEXT_DATA__);}catch(e){}
    Array.prototype.slice.call(document.querySelectorAll('script#__NEXT_DATA__,script#initialData,script[type="application/json"]')).slice(0,6).forEach(function(node){add(node.textContent||'');});
    return roots;
  }

  function inspectState(obj){
    if(!obj||typeof obj!=='object')return 'unknown';
    var v=obj.value&&typeof obj.value==='object'?obj.value:obj;
    for(var i=0;i<2;i++){
      var x=i===0?v:obj;
      if(typeof x.isPromoted==='boolean')return x.isPromoted?'yes':'no';
      if(typeof x.isBoosted==='boolean'&&x.isBoosted)return 'yes';
      if(Array.isArray(x.promotions)&&x.promotions.some(function(p){return /продвинуто|promot|boost|premium/i.test(typeof p==='string'?p:JSON.stringify(p))}))return 'yes';
    }
    return 'unknown';
  }
  function extractFlags(cards){
    var wanted=new Set(cards.map(function(x){return x.id}).filter(Boolean));
    var flags=new Map(),seen=new WeakSet(),visited=0;
    function record(id,obj){
      var v=inspectState(obj);
      if(v==='unknown'||!wanted.has(String(id)))return;
      var old=flags.get(String(id));
      if(!old||v==='yes')flags.set(String(id),v);
    }
    function walk(obj,depth){
      if(!obj||typeof obj!=='object'||seen.has(obj)||depth>11||++visited>60000)return;
      seen.add(obj);
      if(Array.isArray(obj)){obj.slice(0,1000).forEach(function(x){walk(x,depth+1)});return;}
      var ids=[obj.id,obj.itemId,obj.item_id,obj.adId,obj.listingId];
      if(obj.value&&typeof obj.value==='object')ids.push(obj.value.id,obj.value.itemId,obj.value.item_id);
      ids.forEach(function(id){if(/^\d{6,14}$/.test(String(id||'')))record(String(id),obj)});
      Object.keys(obj).slice(0,250).forEach(function(k){var v=obj[k];if(v&&typeof v==='object')walk(v,depth+1)});
    }
    preloadedStates().forEach(function(root){walk(root,0)});
    return flags;
  }

  function recalc(){
    var cards=collectCards();
    if(!cards.length){
      status.textContent='Не удалось найти карточки объявлений';
      result.textContent='Откройте именно страницу поиска Авито, а не отдельное объявление.';
      note.textContent='Если выдача уже открыта, прокрутите её вниз и попробуйте ещё раз. Разметка Авито может меняться.';
      return;
    }
    var flags=extractFlags(cards);
    var promoted=0,knownNo=0,unknown=0;
    cards.forEach(function(c){
      var state=flags.get(c.id)||'unknown';
      if(promotionFromElement(c.el))state='yes';
      if(state==='yes')promoted++;else if(state==='no')knownNo++;else unknown++;
    });
    status.textContent='Открытая выдача · '+new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
    result.textContent='';
    var main=document.createElement('div');
    main.style.cssText='font-size:31px;font-weight:850;line-height:1.15;letter-spacing:-.04em;';
    main.textContent=String(promoted);
    result.appendChild(main);
    var label=document.createElement('div');
    label.style.cssText='font-size:13px;color:#57677c;margin-top:4px;';
    label.textContent='объявлений с явными признаками продвижения';
    result.appendChild(label);
    var detail=document.createElement('div');
    detail.style.cssText='font-size:13px;margin-top:11px;padding-top:10px;border-top:1px solid #dce2ea;';
    detail.textContent='Всего найдено: '+cards.length+' · Без подтверждения статуса: '+unknown;
    result.appendChild(detail);
    note.textContent=unknown?'Важно: у '+unknown+' карточек нет доступных подтверждений статуса. Реальное число продвигаемых объявлений может быть больше. Ноль не означает отсутствия продвижения.':'Подсчёт по доступным признакам карточек текущей выдачи. Скрытое продвижение Авито не всегда можно определить.';
  }
  refresh.addEventListener('click',recalc);
  load.addEventListener('click',async function(){
    load.disabled=true;load.textContent='Загружаем…';
    var y=window.scrollY;
    try{
      var prevHeight=0;
      for(var i=0;i<15;i++){
        var height=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
        var target=Math.min(height,window.scrollY+Math.max(500,Math.round(innerHeight*.85)));
        window.scrollTo(0,target);
        await new Promise(function(resolve){setTimeout(resolve,300)});
        if(window.scrollY+innerHeight>=height-110 && height===prevHeight)break;
        prevHeight=height;
      }
      window.scrollTo(0,y);
      recalc();
    }finally{load.disabled=false;load.textContent='↓ Прогрузить карточки';}
  });
  recalc();
})();
