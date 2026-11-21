// Окно «Телефон»: экран телефона на компьютере (Android 11+), нажатия и свайпы мышью, ввод с клавиатуры,
// кнопки «Назад/Домой/Обзор», список приложений и дела (доставка, такси, карты, покупки, музыка).
// Всё идёт через «Феликс Link» 1.1+ по зашифрованной связи в домашней сети.
import { Y, init, svg, esc } from './common.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cmd = (c, a = {}) => Y.invoke('phone:cmd', c, a);

const I = {
  back: '<path d="M15 5 8 12l7 7"/>',
  home: '<circle cx="12" cy="12" r="6.5"/>',
  recents: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5h4"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.3"/>',
  vdown: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M15.5 12h5"/>',
  vup: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M15.5 12h5M18 9.5v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  tasks: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  apps: '<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>'
};
const ico = n => `<svg class="ico" viewBox="0 0 24 24">${I[n]}</svg>`;

$('#logo').innerHTML = svg('phone');
$('#bmin').innerHTML = svg('min'); $('#bclose').innerHTML = svg('close');
$('#bmin').onclick = () => Y.invoke('win:min');
$('#bclose').onclick = () => Y.invoke('win:close');

let toastT = null;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600); }
async function act(c, a, okText) {
  const r = await cmd(c, a);
  if (!r) toast('Телефон не ответил');
  else if (!r.ok) toast('Не получилось: ' + (r.text || 'телефон отказал'));
  else if (okText) toast(okText);
  return r;
}

// ---------------------------------------------------------------- кнопки под экраном
const TOOLS = [
  ['back', 'Назад', () => act('nav', { action: 'back' })], ['home', 'Домой', () => act('nav', { action: 'home' })], ['recents', 'Недавние приложения', () => act('nav', { action: 'recents' })], null,
  ['bell', 'Шторка уведомлений', () => act('nav', { action: 'notifications' })], ['sun', 'Включить экран', () => act('wake')], ['lock', 'Заблокировать', () => act('nav', { action: 'lock' }, 'Телефон заблокирован')],
  ['camera', 'Снимок экрана на телефоне', () => act('nav', { action: 'screenshot' }, 'Снимок сохранён на телефоне')], null,
  ['vdown', 'Тише', () => act('volume', { stream: 'music', delta: -10 })], ['vup', 'Громче', () => act('volume', { stream: 'music', delta: 10 })]
];
$('#tools').innerHTML = TOOLS.map((t, i) => (t ? `<button data-i="${i}" title="${t[1]}">${ico(t[0])}</button>` : '<span class="sep"></span>')).join('');
$$('#tools button').forEach(b => b.onclick = () => TOOLS[+b.dataset.i][2]());

// ---------------------------------------------------------------- вкладки
const TABS = [['tasks', 'Дела', 'tasks'], ['apps', 'Приложения', 'apps'], ['text', 'Текст и ссылки', 'text']];
$('#tabs').innerHTML = TABS.map(([id, n, ic]) => `<button data-t="${id}">${ico(ic)}${n}</button>`).join('');
function tab(id) {
  $$('#tabs button').forEach(b => b.classList.toggle('sel', b.dataset.t === id));
  $$('.pane').forEach(p => p.classList.toggle('sel', p.id === 'p-' + id));
  if (id === 'apps') loadApps();
}
$$('#tabs button').forEach(b => b.onclick = () => tab(b.dataset.t));
tab('tasks');

// ---------------------------------------------------------------- дела
let C = null, CAT = {};
const TASKS = [
  ['food', 'Что заказать? Например, пицца', [['Открыть', 'q']]],
  ['taxi', 'Куда? Адрес, «дом» или «работа»', [['Такси', 'to']]],
  ['maps', 'Место или адрес', [['Найти', 'q'], ['Маршрут', 'route']]],
  ['shop', 'Что найти? Например, наушники', [['Найти', 'q']]],
  ['music', 'Песня или исполнитель', [['Найти', 'q']]]
];
function renderTasks() {
  const sv = (C && C.phone.services) || {};
  $('#tasks').innerHTML = TASKS.map(([k, ph, btns]) => {
    const c = CAT[k] || { name: k, icon: '•' };
    const app = sv[k] && sv[k].pkg ? sv[k].label || sv[k].pkg : '';
    return `<div class="task" data-k="${k}"><div class="em">${c.icon}</div>
      <div class="nm">${esc(c.name)} <small>${app ? '· ' + esc(app) : '· приложение не выбрано'}</small> <a data-set="1">${app ? 'сменить' : 'выбрать'}</a></div>
      <div class="go"><input class="inp" placeholder="${esc(ph)}">${btns.map(([n, mode]) => `<button class="btn ${mode === btns[0][1] ? 'primary' : ''}" data-m="${mode}">${n}</button>`).join('')}</div></div>`;
  }).join('');
  $$('#tasks .task').forEach(el => {
    const k = el.dataset.k, inp = el.querySelector('input');
    const run = mode => {
      const v = inp.value.trim();
      Y.invoke('phone:service', k, mode === 'q' ? { query: v } : { to: v, route: mode === 'route' });
      toast('Открываю на телефоне…');
    };
    el.querySelectorAll('button[data-m]').forEach(b => b.onclick = () => run(b.dataset.m));
    inp.onkeydown = e => { if (e.key === 'Enter') run(btnsOf(k)[0][1]); };
    el.querySelector('a[data-set]').onclick = () => Y.invoke('open', 'settings', 'phone');
  });
}
const btnsOf = k => TASKS.find(t => t[0] === k)[2];

// ---------------------------------------------------------------- приложения
let apps = null;
async function loadApps(force) {
  if (apps && !force) return renderApps();
  $('#apps').innerHTML = '<div class="dim">Загружаю список с телефона…</div>';
  apps = await Y.invoke('phone:apps', !!force);
  if (!apps) { $('#apps').innerHTML = '<div class="dim">Телефон не на связи или нужна новая версия «Феликс Link».</div>'; return; }
  renderApps();
}
function renderApps() {
  const q = $('#appq').value.trim().toLowerCase();
  const list = (apps || []).filter(a => !q || a.label.toLowerCase().includes(q) || a.pkg.includes(q));
  $('#apps').innerHTML = list.map((a, i) => `<button class="app" data-p="${esc(a.pkg)}" title="${esc(a.label)}">${a.icon ? `<img src="data:image/png;base64,${a.icon}" alt="">` : '<i class="ph"></i>'}<span>${esc(a.label)}</span></button>`).join('') || '<div class="dim">Ничего не нашлось.</div>';
  $$('#apps .app').forEach(b => b.onclick = () => act('launch', { pkg: b.dataset.p }, 'Открываю ' + b.title));
}
$('#appq').oninput = renderApps;

// ---------------------------------------------------------------- текст и ссылки
$('#tType').onclick = () => { const t = $('#txt').value; if (t) act('text', { text: t }, 'Вписал на телефоне'); };
$('#tClip').onclick = () => { const t = $('#txt').value; if (t) act('clip', { text: t }, 'Скопировано в буфер телефона'); };
$('#tUrl').onclick = () => {
  let u = $('#txt').value.trim();
  if (!/^https?:\/\//i.test(u) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u)) u = 'https://' + u;
  if (!/^https?:\/\/\S+$/i.test(u)) return toast('Это не похоже на ссылку');
  act('url', { url: u }, 'Открываю ссылку на телефоне');
};

// ---------------------------------------------------------------- экран телефона
const img = $('#img'), msg = $('#msg'), frame = $('#frame'), screenEl = $('#screen');
let ST = null, info = null, streaming = false, lastFrame = 0;

function message(title, text, btn) {
  img.style.display = 'none'; $('#live').style.display = 'none';
  msg.style.display = ''; msg.innerHTML = `<b>${title}</b>${text}${btn ? `<br><button class="btn" id="msgBtn">${btn[0]}</button>` : ''}`;
  if (btn) $('#msgBtn').onclick = btn[1];
}

async function refresh() {
  ST = await Y.invoke('phone:status');
  const i = ST.info || {};
  $('#title').textContent = ST.connected ? `Телефон — ${i.device || 'телефон'}${ST.battery ? ` · ${ST.battery.level}%${ST.battery.charging ? ' ⚡' : ''}` : ''}` : 'Телефон — нет связи';
  if (!ST.connected) { info = null; return message('Телефон не на связи', 'Открой на телефоне «Феликс Link» — он подключится сам. Телефон и компьютер должны быть в одной сети Wi-Fi.'); }
  if (!ST.control) return message('Нужна новая версия «Феликс Link»', 'Версия на телефоне не умеет управление с компьютера. Обнови приложение: Настройки Феликса → Телефон → QR-код.', ['Открыть настройки', () => Y.invoke('open', 'settings', 'phone')]);
  const r = await cmd('screen');
  info = r && r.ok ? r.data : null;
  if (!info) return message('Телефон не ответил', '', ['Повторить', refresh]);
  if (info.w && info.h) frame.style.setProperty('--ar', (info.w / info.h).toFixed(4));
  if (!info.acc) return message('Включи управление на телефоне', 'В «Феликс Link» нажми «Открыть» у пункта «Управление с компьютера» и включи службу «Феликс Link — управление с компьютера» в специальных возможностях. Приложения и дела справа работают и без неё.', ['Проверить снова', refresh]);
  if (!info.canShot) return message('Экран не показывается', `Показ экрана на компьютере работает на Android 11 и новее. Кнопки внизу, приложения и дела работают.`);
  stream();
}

async function stream() {
  if (streaming) return;
  streaming = true;
  let fails = 0;
  while (!document.hidden && ST && ST.connected && info && info.canShot) {
    const t0 = Date.now();
    const r = await cmd('shot', { w: 540, q: 62 });
    const pause = 125 - (Date.now() - t0);            // не чаще 8 кадров в секунду (телефон и так отдаёт ~3)
    if (pause > 0) await sleep(pause);
    if (r && r.ok && r.data && r.data.jpeg) {
      fails = 0;
      img.src = 'data:image/jpeg;base64,' + r.data.jpeg;
      if (r.data.w && r.data.h) frame.style.setProperty('--ar', (r.data.w / r.data.h).toFixed(4));
      img.style.display = 'block'; msg.style.display = 'none'; $('#live').style.display = 'flex';
      lastFrame = Date.now();
    } else {
      fails++;
      if (fails >= 3) message('Экран не снимается', esc((r && r.text) || 'Телефон не ответил') + '. Возможно, он заблокирован — разблокируй или нажми «Включить экран».', ['Повторить', () => { fails = 0; refresh(); }]);
      await sleep(fails >= 3 ? 3000 : 800);
    }
  }
  streaming = false;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
Y.on('phone', () => { const was = ST && ST.connected; refresh().then(() => { if (!was && ST.connected) apps = null; }); });

// мышь → пальцы: доли экрана 0…1
const frac = e => { const r = img.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
function ripple(e) {
  const r = frame.querySelector('.glassScr').getBoundingClientRect(), d = document.createElement('i');
  d.className = 'ripple'; d.style.left = (e.clientX - r.left) + 'px'; d.style.top = (e.clientY - r.top) + 'px';
  frame.querySelector('.glassScr').appendChild(d); setTimeout(() => d.remove(), 500);
}
let down = null;
img.addEventListener('pointerdown', e => { if (e.button !== 0) return; img.setPointerCapture(e.pointerId); down = { ...frac(e), t: Date.now() }; screenEl.focus(); });
img.addEventListener('pointerup', e => {
  if (!down || e.button !== 0) return;
  const p = frac(e), dt = Date.now() - down.t, dist = Math.hypot(p.x - down.x, p.y - down.y);
  ripple(e);
  if (dist < 0.02) cmd('tap', { x: down.x, y: down.y, long: dt > 550 });
  else cmd('swipe', { x1: down.x, y1: down.y, x2: p.x, y2: p.y, ms: Math.max(120, Math.min(1500, dt)) });
  down = null;
});
img.addEventListener('contextmenu', e => { e.preventDefault(); ripple(e); cmd('nav', { action: 'back' }); });
img.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); cmd('nav', { action: 'home' }); } });
let wheelAcc = 0, wheelT = null, wheelAt = null;
img.addEventListener('wheel', e => {
  e.preventDefault();
  wheelAcc += e.deltaY; wheelAt = frac(e);
  clearTimeout(wheelT);
  wheelT = setTimeout(() => {
    const k = Math.max(-0.45, Math.min(0.45, wheelAcc / 1200)), x = Math.max(0.1, Math.min(0.9, wheelAt.x));
    const y1 = 0.5 + k / 2, y2 = 0.5 - k / 2;   // колесо вниз — палец ведёт вверх
    wheelAcc = 0;
    cmd('swipe', { x1: x, y1, x2: x, y2, ms: 260 });
  }, 120);
}, { passive: false });

// клавиатура → поле ввода на телефоне (пачками, чтобы не слать по букве)
let typed = '', erase = 0, typeT = null;
const flushTyping = (enter = false) => {
  clearTimeout(typeT);
  if (!typed && !erase && !enter) return;
  const a = { text: typed, erase, enter };
  typed = ''; erase = 0;
  cmd('text', a);
};
screenEl.addEventListener('focus', () => frame.classList.add('focus'));
screenEl.addEventListener('blur', () => { frame.classList.remove('focus'); flushTyping(); });
screenEl.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key === 'Enter') { e.preventDefault(); flushTyping(true); return; }
  if (e.key === 'Escape') { e.preventDefault(); flushTyping(); cmd('nav', { action: 'back' }); return; }
  if (e.key === 'Backspace') { e.preventDefault(); if (typed) typed = typed.slice(0, -1); else erase++; }
  else if (e.key.length === 1) { e.preventDefault(); typed += e.key; }
  else return;
  clearTimeout(typeT); typeT = setTimeout(flushTyping, 350);
});
screenEl.addEventListener('paste', e => { const t = e.clipboardData.getData('text'); if (t) { e.preventDefault(); typed += t; flushTyping(); } });

// ---------------------------------------------------------------- старт
CAT = await Y.invoke('phone:catalog');
await init(c => { C = c; renderTasks(); });
refresh();
