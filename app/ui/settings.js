import { Y, init, svg, esc } from './common.js';
import qrcode from './vendor/qrcode.mjs';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let C = null, META = null, themes = {};

const SECTIONS = [['general', 'Общие', 'user'], ['felix', 'Феликс', 'clover'], ['wardrobe', 'Гардероб', 'shirt'], ['voice', 'Голос', 'voice'], ['mic', 'Микрофон', 'mic'], ['ai', 'Нейросеть', 'brain'], ['phone', 'Телефон', 'phone'], ['chats', 'Чаты и музыка', 'chat'], ['help', 'Что умеет', 'help'], ['about', 'О программе', 'info']];
$('#nav').innerHTML = SECTIONS.map(([id, name, ic]) => `<button data-s="${id}">${svg(ic)}${name}</button>`).join('') + '<div class="ver" id="ver"></div>';
$('#logo').innerHTML = svg('clover');
$('#bmin').innerHTML = svg('min'); $('#bclose').innerHTML = svg('close');
$('#bmin').onclick = () => Y.invoke('win:min');
$('#bclose').onclick = () => Y.invoke('win:close');
function go(id) {
  $$('nav button').forEach(b => b.classList.toggle('sel', b.dataset.s === id));
  $$('section').forEach(s => s.classList.toggle('sel', s.id === 's-' + id));
  if (id === 'ai') aiStatus();
  if (id === 'mic') loadMics();
  if (id === 'phone') phone(true);
}
$$('nav button').forEach(b => b.onclick = () => go(b.dataset.s));
Y.on('goto', go);

const get = (o, k) => k.split('.').reduce((a, x) => a && a[x], o);
const patchOf = (k, v) => k.split('.').reverse().reduce((acc, x) => ({ [x]: acc }), v);
const set = (k, v) => Y.invoke('config:set', patchOf(k, v));

function render() {
  $$('.switch[data-k]').forEach(s => s.classList.toggle('on', !!get(C, s.dataset.k)));
  if (document.activeElement !== $('#nick')) $('#nick').value = C.user.nick || '';
  $('#cityNow').textContent = C.weather.city ? 'Сейчас: ' + C.weather.city : 'Город не выбран.';
  $('#themes').innerHTML = Object.entries(themes).map(([id, t]) => `<button data-t="${id}" class="${C.theme.preset === id ? 'sel' : ''}"><div class="sw" style="background:linear-gradient(135deg, ${t.bg} 40%, ${t.accent})"></div>${esc(t.name)}</button>`).join('');
  $$('#themes button').forEach(b => b.onclick = () => Y.invoke('config:set', { theme: { preset: b.dataset.t, accent: themes[b.dataset.t].accent } }));
  $$('#side button').forEach(b => b.classList.toggle('sel', b.dataset.v === C.assistant.side));
  $$('#music button').forEach(b => b.classList.toggle('sel', b.dataset.v === C.music));
  $('#scale').value = C.assistant.scale; $('#scaleV').textContent = Math.round(C.assistant.scale * 100) + '%';
  $('#lift').value = C.assistant.lift; $('#liftV').textContent = C.assistant.lift + ' пикс.';
  $('#pitch').value = C.assistant.pitch; $('#pitchV').textContent = C.assistant.pitch.toFixed(2);
  $('#volume').value = C.assistant.volume; $('#volV').textContent = Math.round(C.assistant.volume * 100) + '%';
  if ($('#voice').options.length) $('#voice').value = C.assistant.voice;
  $('#httpBox').style.display = C.assistant.voice === 'http' ? 'block' : 'none';
  if (document.activeElement !== $('#hurl')) $('#hurl').value = C.assistant.voiceHttp.url || '';
  if (document.activeElement !== $('#hbody')) $('#hbody').value = C.assistant.voiceHttp.body || '';
  if (document.activeElement !== $('#hhead')) $('#hhead').value = C.assistant.voiceHttp.headers || '';
  $('#provider').value = C.ai.provider;
  if (document.activeElement !== $('#lurl')) $('#lurl').value = C.ai.localUrl;
  if (document.activeElement !== $('#lmodel')) $('#lmodel').value = C.ai.localModel;
  $('#keyHint').textContent = META.keyHint ? 'Сохранён ключ ' + META.keyHint : 'Ключ не сохранён.';
  const pl = C.phone.places || {};
  if (document.activeElement !== $('#plHome')) $('#plHome').value = pl.home || '';
  if (document.activeElement !== $('#plWork')) $('#plWork').value = pl.work || '';
  if (CAT && document.activeElement?.closest?.('#svc') == null) renderServices();
  renderWardrobe();
  renderChats();
}

// гардероб: наряды и аксессуары; клик — Феликс надевает с анимацией
let WCAT = null;
const SLOT_NAMES = { head: 'Голова', face: 'Лицо', neck: 'Шея и грудь', back: 'Спина', hand: 'В руке', ears: 'Уши' };
function renderWardrobe() {
  if (!WCAT || !C.wardrobe) return;
  const w = C.wardrobe, wear = w.wear || {};
  $('#outfits').innerHTML = WCAT.outfits.map(o => `<button data-o="${o.id}" class="${w.outfit === o.id ? 'sel' : ''}"><span class="sw" style="background:linear-gradient(135deg, ${o.swatch[0]} 55%, ${o.swatch[1]} 55%)"></span>${esc(o.name)}</button>`).join('');
  $$('#outfits button').forEach(b => b.onclick = () => Y.invoke('wardrobe:set', 'outfit', b.dataset.o));
  const slots = [...new Set(WCAT.accessories.map(a => a.slot))];
  $('#accs').innerHTML = slots.map(s => `<div class="acc"><div class="slot">${SLOT_NAMES[s] || s}</div><div class="row2">${WCAT.accessories.filter(a => a.slot === s).map(a => `<button data-a="${a.id}" class="${wear[a.slot] === a.id ? 'sel' : ''}"><span class="em">${a.emoji}</span>${esc(a.name)}${wear[a.slot] === a.id ? '<small>надето · снять</small>' : ''}</button>`).join('')}</div></div>`).join('');
  $$('#accs button').forEach(b => b.onclick = () => { const id = b.dataset.a, a = WCAT.accessories.find(x => x.id === id); Y.invoke('wardrobe:set', (C.wardrobe.wear || {})[a.slot] === id ? 'off' : 'wear', id); });
}
$('#wWeather').onclick = () => Y.invoke('wardrobe:set', 'weather');
$('#wOff').onclick = () => Y.invoke('felix:command', 'сними все аксессуары');

$$('.switch[data-k]').forEach(s => s.onclick = () => set(s.dataset.k, !get(C, s.dataset.k)));
$('#nick').onchange = () => Y.invoke('config:set', { user: { nick: $('#nick').value.trim().slice(0, 24) } });
$$('#side button').forEach(b => b.onclick = () => set('assistant.side', b.dataset.v));
$$('#music button').forEach(b => b.onclick = () => set('music', b.dataset.v));
$('#scale').oninput = () => { $('#scaleV').textContent = Math.round($('#scale').value * 100) + '%'; };
$('#scale').onchange = () => set('assistant.scale', +$('#scale').value);
$('#lift').oninput = () => { $('#liftV').textContent = $('#lift').value + ' пикс.'; };
$('#lift').onchange = () => set('assistant.lift', +$('#lift').value);
$('#pitch').oninput = () => { $('#pitchV').textContent = (+$('#pitch').value).toFixed(2); };
$('#pitch').onchange = () => set('assistant.pitch', +$('#pitch').value);
$('#volume').oninput = () => { $('#volV').textContent = Math.round($('#volume').value * 100) + '%'; };
$('#volume').onchange = () => set('assistant.volume', +$('#volume').value);
$('#voice').onchange = () => set('assistant.voice', $('#voice').value);
$('#vtest').onclick = () => Y.invoke('voice:test');
$('#vfolder').onclick = () => Y.invoke('voices:folder');
for (const [id, k] of [['#hurl', 'url'], ['#hbody', 'body'], ['#hhead', 'headers']]) $(id).onchange = () => Y.invoke('config:set', { assistant: { voiceHttp: { [k]: $(id).value } } });
$('#provider').onchange = () => { set('ai.provider', $('#provider').value); setTimeout(aiStatus, 200); };
$('#lurl').onchange = () => set('ai.localUrl', $('#lurl').value.trim());
$('#lmodel').onchange = () => set('ai.localModel', $('#lmodel').value.trim());
$('#consoleOpen').onclick = () => Y.invoke('open', 'url', 'https://console.anthropic.com/settings/keys');
$('#keySave').onclick = async () => {
  const k = $('#key').value.trim();
  if (!k) return;
  const st = $('#aiStatus'); st.style.display = 'block'; st.className = 'status'; st.textContent = 'Проверяю ключ в аккаунте Anthropic…';
  const r = await Y.invoke('ai:setKey', k);
  if (r.ok || /сохранён/.test(r.error || '')) $('#key').value = '';   // неверный ключ оставляем в поле — поправить
  META.keyHint = r.hint; render();
  st.className = 'status ' + (r.ok ? 'ok' : 'bad');
  st.textContent = r.ok ? 'Аккаунт подключён: ключ работает, Феликс будет отвечать через твой Claude.' : (r.error || 'Ключ не подошёл.');
};
$('#keyDel').onclick = async () => { const r = await Y.invoke('ai:setKey', ''); META.keyHint = r.hint; render(); aiStatus(); };
$('#aiTest').onclick = async () => {
  const st = $('#aiStatus'); st.style.display = 'block'; st.className = 'status'; st.textContent = 'Спрашиваю…';
  const r = await Y.invoke('ai:test');
  st.className = 'status ' + (r.ok ? 'ok' : 'bad'); st.textContent = (r.ok ? 'Ответ (' + srcName(r.source) + '): ' : '') + r.text;
};
const srcName = s => ({ 'claude-api': 'твой аккаунт Claude', local: 'локальная модель' }[s] || 'нет');
async function aiStatus() {
  const s = await Y.invoke('ai:status');
  const st = $('#aiStatus'); st.style.display = 'block';
  st.className = 'status ' + (s.source ? 'ok' : 'bad');
  st.textContent = s.source ? `Сейчас вопросы уходят: ${srcName(s.source)}.` : 'Нейросеть не подключена: Феликс выполняет только свои команды.';
  st.textContent += ` Аккаунт Claude ${s.key ? 'подключён' : 'не подключён'}, Ollama ${s.ollama ? 'запущен' : 'не запущен'}.`;
}

// телефон
let lastQr = '';
async function phone(withFw) {
  const s = await Y.invoke('phone:status');
  const i = s.info || {};
  $('.phgrid').classList.toggle('off', !s.enabled);
  $('#phState').textContent = !s.enabled ? 'Выключена — включи, чтобы подключить телефон' : s.connected
    ? `Подключён: ${i.device || 'телефон'}${i.model && i.model !== i.device ? ' (' + i.model + ')' : ''}, Android ${i.android || '?'}${s.battery ? ` · заряд ${s.battery.level}%${s.battery.charging ? ' (заряжается)' : ''}` : ''}`
    : 'Ждёт телефон — открой «Феликс Link» и введи код';
  $('#phRing').style.display = s.connected ? '' : 'none';
  $('#phCode').textContent = s.code && s.code.length === 8 ? s.code.slice(0, 4) + '-' + s.code.slice(4) : (s.code || '—');
  const addr = s.addresses[0];
  const url = addr ? `http://${addr.address}:${s.apkPort}/FelixLink.apk` : '';
  $('#qrUrl').textContent = url ? url + (s.apk ? '' : ' (файла нет)') : 'Компьютер не в сети';
  if (url && url !== lastQr) {
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    $('#qr').innerHTML = `<img src="${q.createDataURL(6, 2)}" alt="QR">`;
    lastQr = url;
  }
  $('#wolInfo').textContent = s.wol ? `Сетевая карта: ${s.wol.iface}, MAC ${s.wol.mac}.` : '';
  $('#phPanel').disabled = !s.connected;
  $('#phCtl').textContent = !s.connected ? 'Телефон не на связи' : s.control ? `«Феликс Link» ${i.app || ''} — управление доступно` : 'Обнови «Феликс Link» на телефоне по QR-коду выше — эта версия не умеет управление';
  services(s);
  if (withFw) {
    const fw = await Y.invoke('phone:fwstatus');
    $('#fwSub').textContent = fw ? 'Телефонам домашней сети подключаться разрешено' : 'Без разрешения телефон может не подключиться. Windows спросит подтверждение администратора';
    $('#phFw').style.display = fw ? 'none' : ''; $('#fwOk').style.display = fw ? '' : 'none';
  }
}
// приложения для дел: выбор из приложений, которые реально стоят на телефоне
let CAT = null, sugg = null, allApps = null, svcFor = '';
async function services(s) {
  if (!CAT) CAT = await Y.invoke('phone:catalog');
  const key = s.connected && s.control ? 'on:' + (s.info && s.info.device) : 'off';
  if (key !== svcFor) {
    svcFor = key;
    sugg = null; allApps = null;
    if (key !== 'off') {
      renderServices('Загружаю список приложений с телефона…');
      [sugg, allApps] = await Promise.all([Y.invoke('phone:suggest'), Y.invoke('phone:apps')]);
    }
  }
  renderServices();
}
function renderServices(loading) {
  const sv = C.phone.services || {};
  $('#svc').innerHTML = Object.entries(CAT).map(([k, c]) => {
    const cur = sv[k] && sv[k].pkg ? sv[k] : null;
    const opts = ['<option value="">— не выбрано —</option>'];
    const seen = new Set();
    const opt = a => { if (seen.has(a.pkg)) return ''; seen.add(a.pkg); return `<option value="${esc(a.pkg)}" ${cur && cur.pkg === a.pkg ? 'selected' : ''}>${esc(a.label)}</option>`; };
    if (sugg && sugg[k] && sugg[k].length) opts.push(`<optgroup label="Подходят">${sugg[k].map(opt).join('')}</optgroup>`);
    if (allApps && allApps.length) opts.push(`<optgroup label="Все приложения телефона">${allApps.map(opt).join('')}</optgroup>`);
    if (cur && !seen.has(cur.pkg)) opts.push(`<option value="${esc(cur.pkg)}" selected>${esc(cur.label || cur.pkg)}</option>`);
    const off = !allApps;
    return `<div class="k"><i>${c.icon}</i>${esc(c.name)}</div><select class="inp" data-k="${k}" ${off ? 'title="Подключи телефон, чтобы выбрать из его приложений"' : ''}>${opts.join('')}</select>`;
  }).join('') + (loading ? `<div></div><div class="dim small">${loading}</div>` : !allApps ? '<div></div><div class="dim small">Подключи телефон с «Феликс Link» 1.1 — тут появятся его приложения. Если не выбрать, Феликс сам найдёт подходящее или спросит голосом.</div>' : '');
  $$('#svc select').forEach(el => el.onchange = () => {
    const a = (allApps || []).find(x => x.pkg === el.value) || (sugg && Object.values(sugg).flat().find(x => x.pkg === el.value));
    Y.invoke('config:set', { phone: { services: { [el.dataset.k]: el.value ? { pkg: el.value, label: a ? a.label : el.value } : { pkg: '', label: '' } } } });
  });
}
$('#plHome').onchange = () => Y.invoke('config:set', { phone: { places: { home: $('#plHome').value.trim() } } });
$('#plWork').onchange = () => Y.invoke('config:set', { phone: { places: { work: $('#plWork').value.trim() } } });
$('#phPanel').onclick = () => Y.invoke('phone:panel');
$('#phNew').onclick = async () => { await Y.invoke('phone:newcode'); phone(); };
$('#phRing').onclick = () => Y.invoke('phone:cmd', 'find', { on: true });
$('#phFw').onclick = async () => { $('#phFw').textContent = 'Подтверди в окне Windows…'; await Y.invoke('phone:firewall'); $('#phFw').textContent = 'Разрешить'; phone(true); };
Y.on('phone', () => { if ($('#s-phone').classList.contains('sel')) phone(); });

// город
let cityT = null;
$('#city').oninput = () => {
  clearTimeout(cityT);
  const q = $('#city').value.trim();
  if (q.length < 2) { $('#cities').innerHTML = ''; return; }
  cityT = setTimeout(async () => {
    const list = await Y.invoke('geocode', q);
    $('#cities').innerHTML = list.slice(0, 5).map((c, i) => `<button data-i="${i}">${esc(c.name)} <span class="dim">${esc(c.region)}</span></button>`).join('');
    $$('#cities button').forEach(b => b.onclick = () => { const c = list[+b.dataset.i]; Y.invoke('config:set', { weather: { city: c.name, lat: c.lat, lon: c.lon } }); $('#cities').innerHTML = ''; $('#city').value = ''; });
  }, 350);
};

// микрофоны
async function loadMics() {
  const s = await Y.invoke('mics');
  const devs = (s && s.devices) || [];
  $('#micDev').innerHTML = devs.length ? devs.map((d, i) => `<option value="${i}">${esc(d)}</option>`).join('') : '<option value="0">Микрофон по умолчанию</option>';
  $('#micDev').value = String(C.assistant.micDevice || 0);
}
$('#micDev').onchange = () => set('assistant.micDevice', +$('#micDev').value);

// ярлыки чатов
function renderChats() {
  const list = C.chats || [];
  $('#chats').innerHTML = list.map((c, i) => `<div class="chat"><input class="inp" data-i="${i}" data-f="say" value="${esc(c.say)}" placeholder="Как сказать: мама"><select class="inp" data-i="${i}" data-f="app"><option value="telegram" ${c.app === 'telegram' ? 'selected' : ''}>Telegram</option><option value="discord" ${c.app === 'discord' ? 'selected' : ''}>Discord</option></select><input class="inp" data-i="${i}" data-f="target" value="${esc(c.target)}" placeholder="t.me/… или имя в поиске"><button class="del" data-i="${i}" title="Удалить">${svg('close')}</button></div>`).join('');
  $$('#chats [data-f]').forEach(el => el.onchange = () => { const l = (C.chats || []).map(x => ({ ...x })); l[+el.dataset.i][el.dataset.f] = el.value.trim(); Y.invoke('config:set', { chats: l }); });
  $$('#chats .del').forEach(b => b.onclick = () => Y.invoke('config:set', { chats: (C.chats || []).filter((_, i) => i !== +b.dataset.i) }));
}
$('#chatAdd').onclick = () => Y.invoke('config:set', { chats: [...(C.chats || []), { say: '', app: 'telegram', target: '' }] });

// что умеет
const HELP = [
  ['folder', 'Программы и папки', 'открой загрузки · открой телеграм · закрой хром · сверни дискорд · переключись на браузер · найди файл отчёт'],
  ['clover', 'Таймеры и будильник', 'таймер на пять минут · напомни через час позвонить маме · будильник на семь тридцать · сколько осталось'],
  ['voice', 'Звук и музыка', 'громче · тише · громкость 40 · пауза · следующий трек · что играет · включи трек … · переключи звук на наушники'],
  ['chat', 'Браузер', 'новая вкладка · закрой вкладку · назад · листай вниз · найди на странице … · зайди на хабр · найди на ютубе …'],
  ['info', 'Справка', 'погода · погода в Казани завтра · сколько времени в Токио · курс доллара · что такое квазар · сколько дней до Нового года'],
  ['gear', 'Компьютер', 'сверни все окна · сделай скриншот · сколько места на диске · как там компьютер · выключи компьютер через час · очисти корзину'],
  ['phone', 'Телефон', 'где мой телефон · прими · отклони · на громкую · будильник на телефоне на семь · сколько заряда на телефоне · позвони маме'],
  ['phone', 'Телефон с компьютера', 'закажи пиццу · вызови такси до работы · маршрут до вокзала · купи наушники · покажи экран телефона · на телефоне назад · напиши на телефоне …'],
  ['shirt', 'Гардероб', 'надень корону · надень что-нибудь · сними очки · переоденься в космос · оденься по погоде · что на тебе · покажи гардероб'],
  ['clover', 'Игры и забота', 'камень, ножницы, бумага · загадай число · загадай загадку · запусти помидор · напоминай пить воду · подними настроение · сделай селфи'],
  ['brain', 'Нейросеть', 'любой вопрос, которого нет в командах: «почему небо голубое», «придумай тост на день рождения», «спроси у нейросети …»'],
  ['user', 'Сам Феликс', 'спрячься · покажись · перейди влево · стань больше · помаши · станцуй · не слушай · почему тебя зовут Феликс']
];
$('#cards').innerHTML = HELP.map(([ic, t, d]) => `<div class="card"><b>${svg(ic)}${t}</b><div>${d}</div></div>`).join('');
$('#cmdGo').onclick = () => { const t = $('#cmd').value.trim(); if (t) { Y.invoke('felix:command', t); $('#cmd').value = ''; } };
$('#cmd').onkeydown = e => { if (e.key === 'Enter') $('#cmdGo').click(); };
$('#repoLink').onclick = e => { e.preventDefault(); Y.invoke('open', 'url', 'https://github.com/YatagarasuTS/felix-assistant'); };
$('#openData').onclick = () => Y.invoke('open', 'data');
$('#openNotes').onclick = () => Y.invoke('open', 'notes');

WCAT = await Y.invoke('wardrobe:catalog');
const voices = await Y.invoke('voices');
$('#voice').innerHTML = voices.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
const first = await init((c, meta) => { C = c; if (meta && meta.keyHint !== undefined) META = { ...META, keyHint: meta.keyHint }; if (meta && meta.theme && meta.theme.presets) themes = meta.theme.presets; if (META) render(); });
META = first; themes = first.theme.presets;
$('#ver').textContent = 'Феликс ' + first.version;
$('#aboutVer').textContent = `Феликс ${first.version} — голосовой 3D-ассистент для Windows 10 и 11 и пульт для телефона. Открытый код, лицензия MIT.`;
render();
go(new URLSearchParams(location.search).get('section') || 'general');
