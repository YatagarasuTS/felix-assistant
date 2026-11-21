// Феликс — голосовой 3D-ассистент для рабочего стола Windows.
// Главный процесс: окно с Феликсом поверх рабочего стола, значок в трее, настройки, первый запуск,
// голосовые команды (FelixCore: Vosk + окна + громкость; FelixInput: клавиши, музыка, звук), голос Piper, нейросеть.
const { app, BrowserWindow, ipcMain, screen, protocol, net, shell, powerMonitor, nativeTheme, clipboard, Tray, Menu, nativeImage, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { Config, THEMES } = require('./lib/config');
const { Core } = require('./lib/core');
const { Input } = require('./lib/input');
const { Tts } = require('./lib/tts');
const { Llm, explain } = require('./lib/llm');
const { Link, newCode, normCode, APK_PORT, PORT: LINK_PORT, DISC_PORT } = require('./lib/link');
const brain = require('./lib/brain');
const phoneapps = require('./lib/phoneapps');

const VERSION = require('./package.json').version;
// HOME — папка программы: рядом с Felix.exe лежат native\, voice\, stt\, models\, sounds\
const HOME = process.env.FELIX_HOME || (app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, '..', 'stage'));
// DATA — настройки и журнал: %APPDATA%\Felix (FELIX_DATA — своя папка, например для переносной версии или проверки)
const DATA = process.env.FELIX_DATA || path.join(app.getPath('appData'), 'Felix');
if (process.env.FELIX_DATA) app.setPath('userData', path.join(DATA, 'chromium'));
const ARGS = process.argv.slice(1);
const DEV = !app.isPackaged;

app.setAppUserModelId('Felix.Assistant');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
fs.mkdirSync(DATA, { recursive: true });
const cfg = new Config(DATA);

let core, input, tts, llm, tray = null;
const W = {};
let apps = [];
let lastFg = null, lastExternalFg = null;
let pendingConfirm = null;
let listenUntil = 0;
let speaking = false;
let idlePlaying = false, idleEndSent = 0;
let hiddenByFullscreen = false;
let lastSaid = '';
const timers = [];
const bootTime = Date.now();

const send = (win, ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const broadcast = (ch, data) => Object.values(W).forEach(w => send(w, ch, data));
const log = (...a) => { try { fs.appendFileSync(path.join(DATA, 'felix.log'), new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch { } };
const fileUrl = p => 'felix://file/' + encodeURIComponent(p.replace(/\\/g, '/'));
const exists = p => { try { return fs.existsSync(p); } catch { return false; } };
const primary = () => screen.getPrimaryDisplay();
const nick = () => cfg.get().user.nick || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');

function themeVars() {
  const t = cfg.theme();
  return { ...t, presets: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, { name: v.name, accent: v.accent, bg: v.bg, dark: v.dark }])) };
}

// ---------------------------------------------------------------- ключ Claude API: хранится зашифрованным (Windows DPAPI)
const keyFile = () => path.join(DATA, 'claude.key');
function getKey() {
  try {
    const raw = fs.readFileSync(keyFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
  } catch { return null; }
}
function setKey(k) {
  k = String(k || '').trim();
  try {
    if (!k) { fs.rmSync(keyFile(), { force: true }); return true; }
    fs.writeFileSync(keyFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(k) : Buffer.from(k, 'utf8'));
    return true;
  } catch (e) { log('key save', e.message); return false; }
}
const keyHint = () => { const k = getKey(); return k ? k.slice(0, 7) + '…' + k.slice(-4) : ''; };

// ---------------------------------------------------------------- окна
function baseWin(opts) {
  const w = new BrowserWindow({
    frame: false, transparent: true, thickFrame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    ...opts
  });
  w.setMenu(null);
  return w;
}
const load = (w, page, query = {}) => w.loadURL(`felix://app/ui/${page}?${new URLSearchParams(query)}`);

const HEADROOM = 150;   // место над головой под облачко с текстом
function assistantRect() {
  const d = primary(), wa = d.workArea;
  const a = cfg.get().assistant;
  const s = a.scale || 1;
  const height = Math.round(Math.max(330, Math.min(560, wa.height * 0.46)) * s);
  const width = Math.round(height * 0.95);
  const lift = Math.max(0, Math.min(400, Number(a.lift ?? 8)));
  const bottom = wa.y + wa.height - lift;
  const x = a.side === 'left' ? wa.x + 6 : wa.x + wa.width - width - 6;
  return { x, y: bottom - height - HEADROOM, width, height: height + HEADROOM };
}

function createAssistant() {
  if (!cfg.get().assistant.enabled || W.assistant) return;
  const w = W.assistant = baseWin({ ...assistantRect(), alwaysOnTop: true, focusable: true });
  w.setAlwaysOnTop(true, 'floating');
  ignoreMouse(w, true);
  load(w, 'assistant.html', { headroom: String(HEADROOM), side: cfg.get().assistant.side });
  w.once('ready-to-show', () => { w.setBounds(assistantRect()); w.showInactive(); w._ready = true; });
  w.on('closed', () => { delete W.assistant; });
}

function layoutAssistant() {
  const w = W.assistant;
  if (!w || w.isDestroyed() || idlePlaying) return;
  const r = assistantRect(), b = w.getBounds();
  if (r.x !== b.x || r.y !== b.y || r.width !== b.width || r.height !== b.height) w.setBounds(r);
  send(w, 'side', cfg.get().assistant.side);
}

function openSettings(section) {
  if (W.settings && !W.settings.isDestroyed()) { W.settings.show(); W.settings.focus(); if (section) send(W.settings, 'goto', section); return; }
  const w = W.settings = new BrowserWindow({
    width: 980, height: 700, minWidth: 820, minHeight: 560, frame: false, show: false, backgroundColor: cfg.theme().bg, title: 'Феликс — настройки',
    icon: path.join(__dirname, 'ui', 'assets', 'felix.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, spellcheck: false }
  });
  w.setMenu(null);
  load(w, 'settings.html', section ? { section } : {});
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => { delete W.settings; });
}

function openWelcome() {
  if (W.welcome && !W.welcome.isDestroyed()) { W.welcome.show(); W.welcome.focus(); return; }
  const w = W.welcome = new BrowserWindow({
    width: 860, height: 620, resizable: false, frame: false, show: false, backgroundColor: cfg.theme().bg, title: 'Феликс — знакомство',
    icon: path.join(__dirname, 'ui', 'assets', 'felix.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, spellcheck: false }
  });
  w.setMenu(null);
  load(w, 'welcome.html');
  w.once('ready-to-show', () => { w.show(); w.focus(); });
  w.on('closed', () => { delete W.welcome; });
}

// ---------------------------------------------------------------- мышь «насквозь»
// Окно Феликса прозрачно для кликов, пока курсор не над самим Феликсом (страница проверяет пиксель под курсором).
// Пересылку движения Electron держит глобальным хуком, который Windows иногда снимает, поэтому курсор
// дополнительно опрашиваем сами каждые 40 мс и передаём странице (preload превращает это в mousemove).
function ignoreMouse(w, ignore, forward = true) {
  if (!w || w.isDestroyed()) return;
  w._ignore = ignore ? (forward ? 'fwd' : 'all') : '';
  if (ignore && forward) w.setIgnoreMouseEvents(true, { forward: true }); else w.setIgnoreMouseEvents(ignore);
}
let lastPt = null;
function mouseTick() {
  const w = W.assistant;
  if (!w || w.isDestroyed() || !w.isVisible()) return;
  const pt = screen.getCursorScreenPoint();
  const moved = !lastPt || pt.x !== lastPt.x || pt.y !== lastPt.y;
  lastPt = pt;
  const b = w.getBounds();
  const inside = pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
  const now = Date.now();
  const flipped = w._ignore !== w._ignSeen; w._ignSeen = w._ignore;
  if (w._ignore === 'fwd' || w._ignore === '') {
    if (inside) { w._outSince = 0; if (moved || flipped) send(w, 'mouse:fwd', { x: pt.x - b.x, y: pt.y - b.y }); }
    else if (w._ignore === 'fwd') { if (w._fwdIn) send(w, 'mouse:fwd', { out: true }); }
    else {
      if (!w._outSince) w._outSince = now;
      if (flipped || w._fwdIn || now - (w._outSent || 0) > 300) { w._outSent = now; send(w, 'mouse:fwd', { out: true }); }
      if (now - w._outSince > 1500) { w._outSince = 0; ignoreMouse(w, true); send(w, 'mouse:sync', true); }
    }
  }
  w._fwdIn = inside;
}

// ---------------------------------------------------------------- значок в трее
function trayMenu() {
  const a = cfg.get().assistant;
  return Menu.buildFromTemplate([
    { label: a.minimized ? 'Показать Феликса' : 'Спрятать Феликса', click: () => setMinimized(!cfg.get().assistant.minimized) },
    { label: 'Слушать команду (Win+Y)', click: () => callFelix() },
    { label: 'Микрофон', type: 'checkbox', checked: !!a.mic, click: m => applyConfig({ assistant: { mic: m.checked } }) },
    { type: 'separator' },
    { label: 'Телефон на экране', enabled: !!(link && link.connected), click: () => openPhonePanel() },
    { label: 'Настройки…', click: () => openSettings() },
    { label: 'Что умеет Феликс', click: () => openSettings('help') },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() }
  ]);
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'ui', 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('Феликс — голосовой ассистент');
  tray.setContextMenu(trayMenu());
  tray.on('click', () => { if (cfg.get().assistant.minimized) setMinimized(false); else callFelix(); });
}
const refreshTray = () => { if (tray && !tray.isDestroyed()) tray.setContextMenu(trayMenu()); };

// ---------------------------------------------------------------- речь
async function say(text, opts = {}) {
  if (!text) return;
  const a = cfg.get().assistant;
  log('say', text);
  if (!opts.noRepeat) lastSaid = text;
  const wav = a.voice === 'off' ? null : await tts.synth(text, a.pitch, a.voice, a);
  const rate = tts.natural(a.voice) ? 1 : a.pitch;
  // команда пришла с телефона — ответ уходит и туда, тем же голосом (готовый звук и та же скорость)
  if (link && link.connected && Date.now() - phoneOrigin < 30000) {
    let audio = null;
    try { if (wav) audio = fs.readFileSync(wav).toString('base64'); } catch { }
    link.send({ t: 'say', text, wav: audio, rate, volume: a.volume, speak: a.voice !== 'off' });
  }
  speaking = true;
  core.safe('sttPause', { paused: true });
  send(W.assistant, 'say', { text, wav: wav ? fileUrl(wav) : null, pitch: rate, volume: a.volume, anim: opts.anim || 'talk', emotion: opts.emotion || 'neutral' });
  setTimeout(() => { if (speaking) { speaking = false; core.safe('sttPause', { paused: false }); } }, 25000);
}
function onSpoken() {
  speaking = false;
  setTimeout(() => { if (!speaking) core.safe('sttPause', { paused: false }); }, 250);
}

function onStt(e) {
  if (e.error === 'nomic') { send(W.assistant, 'mic', { ok: false }); return; }
  if (e.state) { send(W.assistant, 'mic', { ok: true }); return; }
  if (speaking || idlePlaying) return;
  const listening = Date.now() < listenUntil;
  const w = brain.wake(e.text);
  if (!e.final) {
    if (listening || w.woke) send(W.assistant, 'partial', { text: listening ? e.text : w.rest });
    return;
  }
  log('heard', e.text);
  if (pendingConfirm && Date.now() < pendingConfirm.until) {
    const p = brain.parse(w.woke ? w.rest : e.text);
    if (p.intent === 'yes' || p.intent === 'no') return handle(p, e.text);
  }
  if (listening) { listenUntil = 0; return handle(brain.parse(w.woke ? w.rest : e.text), e.text); }
  if (w.woke && cfg.get().assistant.wake) {
    const p = brain.parse(w.rest);
    if (w.weak && (p.intent === 'unknown' || p.intent === 'call' || p.intent.startsWith('chat'))) return;
    return handle(p, e.text);
  }
}
function startListening(sec = 8) { listenUntil = Date.now() + sec * 1000; send(W.assistant, 'listen', { until: listenUntil }); }
function callFelix() {
  if (cfg.get().assistant.minimized) setMinimized(false);
  startListening(8);
  core.safe('sttPause', { paused: false });
  return say(brain.pick(brain.SAY.call), { anim: 'listen' });
}

// ---------------------------------------------------------------- команды
async function handle(p, raw) {
  const S = brain.SAY, pick = brain.pick;
  send(W.assistant, 'heard', { text: raw, intent: p.intent });
  // ответ на «Через какое приложение: Яндекс Еда или Самокат?»
  if (pendingChoice) {
    const pc = pendingChoice; pendingChoice = null;
    if (Date.now() < pc.until) {
      const hit = phoneapps.pickByVoice(brain.norm(raw || p.text || ''), pc.options, brain.translit);
      if (hit) { cfg.patch({ phone: { services: { [pc.kind]: hit } } }); return runService(pc.kind, hit, pc.args, false); }
      if (p.intent === 'no') return say(pick(S.cancelled));
      if (p.intent === 'unknown' || p.intent === 'call') { openSettings('phone'); return say('Не расслышал. Выбери приложение в настройках, раздел «Телефон», — я запомню.'); }
    }
  }
  switch (p.intent) {
    case 'call': startListening(8); return say(pick(S.call), { anim: 'listen' });
    case 'yes': {
      const pc = pendingConfirm; pendingConfirm = null;
      if (!pc) return;
      if (pc.action === 'emptyRecycle') { await core.safe('emptyRecycle', {}, 30000); return say('Корзина очищена.', { emotion: 'happy' }); }
      if (pc.action === 'dial') { const r = link && link.connected ? await link.request('dial', { number: pc.number }) : null; return say(r && r.ok ? `Звоню: ${pc.name}.` : 'Не получилось позвонить.'); }
      if (pc.action === 'shutdownTimer') { spawnDetached('shutdown.exe', ['/s', '/t', String(pc.seconds)]); return say(`Хорошо, выключу через ${brain.spellDuration(pc.seconds)}. Отменить: «Феликс, отмени выключение».`); }
      await say('Выполняю.'); setTimeout(() => power(pc.action), 1500);
      return;
    }
    case 'no': {
      const had = pendingConfirm && Date.now() < pendingConfirm.until;
      pendingConfirm = null;
      return had || !/стоп/.test(brain.norm(raw)) ? say(pick(S.cancelled)) : mediaControl('pause');
    }
    case 'self.hide': await say(pick(S.hide), { anim: 'wave' }); setTimeout(() => setMinimized(true), 1800); return;
    case 'self.show': setMinimized(false); setTimeout(() => say(pick(S.show), { anim: 'happy', emotion: 'happy' }), 900); return;
    case 'self.mute': cfg.patch({ assistant: { mic: false } }); refreshTray(); await say('Хорошо, больше не слушаю. Включить микрофон можно в трее или кликом по мне.'); setTimeout(() => core.safe('sttStop'), 4000); return;
    case 'self.side': applyConfig({ assistant: { side: p.side } }); return say(p.side === 'left' ? 'Перебрался налево.' : 'Вернулся направо.', { emotion: 'happy' });
    case 'self.lift': {
      const lift = Math.max(0, Math.min(400, Number(cfg.get().assistant.lift ?? 8) + p.delta));
      applyConfig({ assistant: { lift } });
      return say(p.delta < 0 ? (lift === 0 ? 'Ниже уже некуда!' : 'Так лучше?') : 'Поднялся повыше.', { emotion: 'happy' });
    }
    case 'self.scale': {
      const s = Math.max(0.7, Math.min(1.3, Math.round(((cfg.get().assistant.scale || 1) + p.delta) * 100) / 100));
      applyConfig({ assistant: { scale: s } });
      return say(p.delta > 0 ? 'Подрос!' : 'Уменьшился.', { emotion: 'happy' });
    }
    case 'self.dance': return say(pick(S.dance), { anim: 'happy', emotion: 'happy' });
    case 'self.wave': return say(pick(S.wave), { anim: 'wave', emotion: 'happy' });
    case 'theme': {
      if (!p.theme) return say('Какую тему поставить? Есть мята, полночь, закат, сакура, угли и снег.');
      applyConfig({ theme: { preset: p.theme, accent: THEMES[p.theme].accent } });
      return say(`Поставил тему «${THEMES[p.theme].name}».`, { emotion: 'happy' });
    }
    case 'win.minimizeAll': core.safe('keys', { keys: ['LWIN', 'D'] }); return say('Сворачиваю все окна.');
    case 'win.minimize': if (lastExternalFg) core.safe('minimize', { hwnd: lastExternalFg.hwnd }); return say('Свернул.');
    case 'win.maximize': if (lastExternalFg) core.safe('maximize', { hwnd: lastExternalFg.hwnd }); return say('Готово.');
    case 'win.close': if (lastExternalFg) core.safe('close', { hwnd: lastExternalFg.hwnd }); return say('Закрываю.');
    case 'volume': {
      const r = await core.safe('volume', p);
      if (p.mute === true) return say('Звук выключен.');
      if (p.mute === false) return say('Звук включён.');
      return say(`Громкость ${r ? r.level : ''} процентов.`);
    }
    case 'media': return mediaControl(p.action);
    case 'power':
      if (p.confirm) { pendingConfirm = { action: p.action, until: Date.now() + 12000 }; startListening(10); return say(S.confirm[p.action], { anim: 'think' }); }
      await say('Блокирую компьютер.'); return setTimeout(() => power(p.action), 1200);
    case 'screenshot': core.safe('keys', { keys: ['LWIN', 'SNAPSHOT'] }); return say('Сделал снимок экрана. Он в папке «Изображения», «Снимки экрана».', { emotion: 'happy' });
    case 'web': await shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(p.query)); return say(`Ищу в интернете: ${p.query}.`);
    case 'find': return findFiles(p.query);
    case 'time': { const d = new Date(); return say(`Сейчас ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}.`); }
    case 'date': return say('Сегодня ' + new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + '.');
    case 'weather': return weatherSay(p);
    case 'status': return statusSay();
    case 'open': case 'focus': return openTarget(p.target);
    case 'close': return closeTarget(p.target);
    case 'ai': return askAi(p.query || raw);
    case 'chat.hello': return say(pick(S.hello(nick())), { anim: 'wave', emotion: 'happy' });
    case 'chat.how': return say(pick(S.how), { emotion: 'happy' });
    case 'chat.who': return say(pick(S.who), { anim: 'happy' });
    case 'chat.name': return say(pick(S.name), { anim: 'happy', emotion: 'happy' });
    case 'chat.help': return say(pick(S.help));
    case 'chat.thanks': return say(pick(S.thanks), { emotion: 'happy' });
    case 'chat.compliment': return say(pick(S.compliment), { anim: 'shy', emotion: 'shy' });
    case 'chat.bye': return say(pick(S.bye), { anim: 'wave' });
    case 'chat.joke': return say(pick(S.joke), { emotion: 'happy' });
    case 'repeat': return say(lastSaid || 'Я пока ничего не говорил.', { noRepeat: true });
    case 'timer': return startTimer(p);
    case 'alarm': return link && link.connected ? phoneHandle({ ...p, intent: 'phone.alarm' }) : setAlarm(p);
    case 'phone.answer': case 'phone.decline': case 'phone.hangup': case 'phone.speaker': case 'phone.who': case 'phone.find':
    case 'phone.timer': case 'phone.volume': case 'phone.ringer': case 'phone.dnd': case 'phone.battery':
    case 'phone.open': case 'phone.media': case 'phone.notifs': case 'phone.call':
    case 'phone.food': case 'phone.taxi': case 'phone.route': case 'phone.map': case 'phone.shop': case 'phone.music':
    case 'phone.nav': case 'phone.type': case 'phone.url': case 'phone.clip': case 'phone.panel':
      return phoneHandle(p);
    case 'timer.cancel': {
      const n = timers.length;
      timers.splice(0).forEach(t => clearTimeout(t.handle));
      return say(n ? (n > 1 ? `Отменил таймеры: ${n}.` : 'Таймер отменён.') : 'Таймеров нет.');
    }
    case 'timer.left': {
      if (!timers.length) return say('Таймеров нет.');
      const t = timers.reduce((a, b) => (a.at < b.at ? a : b));
      return say(`До ${t.text ? 'напоминания' : 'конца таймера'} осталось ${brain.spellDuration(Math.max(1, Math.round((t.at - Date.now()) / 1000)))}.`);
    }
    case 'calc':
      if (p.result === null || !isFinite(p.result)) return say('Не смог посчитать. Скажи, например: сколько будет двенадцать умножить на семь.', { anim: 'think' });
      return say(`${p.expr} — это ${brain.sayNumber(p.result)}.`);
    case 'coin': return say(Math.random() < 0.5 ? 'Орёл!' : 'Решка!', { anim: 'happy', emotion: 'happy' });
    case 'dice': return say(`Выпало ${1 + Math.floor(Math.random() * 6)}.`, { anim: 'happy' });
    case 'random': {
      const lo = Math.min(p.from ?? 1, p.to ?? 100), hi = Math.max(p.from ?? 1, p.to ?? 100);
      return say(`Загадал: ${lo + Math.floor(Math.random() * (hi - lo + 1))}.`, { emotion: 'happy' });
    }
    case 'uptime': return say(`Компьютер работает ${brain.spellDuration(Math.round(os.uptime()))}.`);
    case 'disk': return say(diskReport());
    case 'ram': {
      const free = os.freemem() / 1073741824, total = os.totalmem() / 1073741824;
      const used = Math.round((1 - free / total) * 100);
      return say(`Занято ${used} ${brain.plural(used, 'процент', 'процента', 'процентов')} памяти, свободно ${free.toFixed(1).replace('.', ',')} гигабайта из ${Math.round(total)}.`);
    }
    case 'layout': core.safe('keys', { keys: ['LWIN', 'SPACE'] }); return say('Переключил раскладку.');
    case 'alttab': core.safe('keys', { keys: ['ALT', 'TAB'] }); return;
    case 'recycle.empty': {
      const rb = await core.safe('recycle');
      if (rb && !rb.count) return say('Корзина и так пустая.');
      pendingConfirm = { action: 'emptyRecycle', until: Date.now() + 12000 }; startListening(10);
      return say(`Очистить корзину${rb && rb.count ? ', там ' + rb.count + ' ' + brain.plural(rb.count, 'файл', 'файла', 'файлов') : ''}? Это нельзя отменить. Скажи «да».`, { anim: 'think' });
    }
    case 'youtube': await shell.openExternal('https://www.youtube.com/results?search_query=' + encodeURIComponent(p.query)); return say(`Ищу на ютубе: ${p.query}.`);
    case 'translate': await shell.openExternal(`https://translate.google.com/?sl=auto&tl=${p.to || 'en'}&text=${encodeURIComponent(p.query)}&op=translate`); return say(`Открываю перевод: ${p.query}.`);
    case 'app.minimize': {
      const ws = await findAppWindows(p.target);
      if (!ws.length) return say(`Не вижу окна «${p.target}».`);
      ws.forEach(w => core.safe('minimize', { hwnd: w.hwnd }));
      return say('Свернул.');
    }
    case 'app.maximize': {
      const ws = await findAppWindows(p.target);
      if (!ws.length) return openTarget(p.target);
      ws.forEach(w => core.safe('maximize', { hwnd: w.hwnd }));
      activateWindow(ws[0]);
      return say('Развернул.');
    }
    case 'music.play': return playTrack(p.query);
    case 'audio.output': return audioOutputCmd(p);
    case 'browser': return browserAction(p);
    case 'site': return openSite(p.query);
    case 'type': {
      if (!input.ready || !lastExternalFg) return say('Не знаю, куда печатать: сначала открой окно.');
      input.steps([`activate ${lastExternalFg.hwnd}`, 'sleep 150', `type ${b64(p.text)}`]);
      return;
    }
    case 'tg.open': return openTelegram(p.query);
    case 'tg.saved': return telegramKeys(['keys CTRL 0'], 'Открываю «Избранное».');
    case 'ds.open': return openDiscord(p.query, p.kind);
    case 'ds.key': {
      const w = await ensureApp('дискорд', DISCORD_RE);
      if (!w) return say('Дискорд не запущен.');
      input.steps([`activate ${w.hwnd}`, 'sleep 300', p.key === 'mute' ? 'keys CTRL SHIFT M' : 'keys CTRL SHIFT D']);
      return say(p.key === 'mute' ? 'Переключил микрофон в Дискорде.' : 'Переключил звук в Дискорде.');
    }
    case 'time.city': {
      const g = await geocodeCity(p.city);
      if (!g || !g.tz) return say(`Не нашёл город «${p.city}».`);
      return say(`В городе ${g.name} сейчас ${new Date().toLocaleTimeString('ru-RU', { timeZone: g.tz, hour: '2-digit', minute: '2-digit' })}.`);
    }
    case 'sun': {
      const wc = await homeCity(); if (!wc) return askCity();
      const f = await forecast(wc.lat, wc.lon);
      if (!f) return say('Не получилось узнать. Нет интернета?');
      const hm = s => String(s).slice(11, 16);
      return say(`В городе ${wc.city} восход в ${hm(f.daily.sunrise[0])}, закат в ${hm(f.daily.sunset[0])}.`);
    }
    case 'currency': return currencySay(p);
    case 'wiki': return wikiSay(p.query);
    case 'fact': return say(pick(S.facts), { emotion: 'happy' });
    case 'daysuntil': return daysUntilSay(p.what);
    case 'note.add':
      try { fs.appendFileSync(notesFile(), `[${new Date().toLocaleString('ru-RU')}] ${p.text}\r\n`, 'utf8'); } catch { return say('Не получилось записать заметку.'); }
      return say('Записал.', { emotion: 'happy' });
    case 'note.read': {
      let lines = [];
      try { lines = fs.readFileSync(notesFile(), 'utf8').split(/\r?\n/).filter(Boolean); } catch { }
      if (!lines.length) return say('Заметок пока нет. Скажи: запиши заметку, и что записать.');
      return say('Последние заметки: ' + lines.slice(-3).map(l => l.replace(/^\[[^\]]*\]\s*/, '')).join('. ') + '.');
    }
    case 'note.open':
      if (!exists(notesFile())) try { fs.writeFileSync(notesFile(), '', 'utf8'); } catch { }
      shell.openPath(notesFile()); return say('Открываю заметки.');
    case 'last.download': return openNewest(app.getPath('downloads'), 'загрузках');
    case 'last.screenshot': return openNewest(path.join(app.getPath('pictures'), 'Screenshots'), 'снимках экрана');
    case 'clipboard': {
      const txt = clipboard.readText().replace(/\s+/g, ' ').trim();
      if (!txt) return say('В буфере обмена нет текста.');
      return say(txt.length > 300 ? 'В буфере: ' + txt.slice(0, 300) + '… и дальше.' : 'В буфере: ' + txt);
    }
    case 'power.timer':
      pendingConfirm = { action: 'shutdownTimer', seconds: p.seconds, until: Date.now() + 12000 }; startListening(10);
      return say(`Выключить компьютер через ${brain.spellDuration(p.seconds)}? Скажи «да».`, { anim: 'think' });
    case 'power.cancel': spawnDetached('shutdown.exe', ['/a']); return say('Отменил выключение.');
    default:
      return askAi(p.text || raw, true);
  }
}

// ---------------------------------------------------------------- таймеры и будильник
function addTimer(sec, text, kind = 'timer') {
  const t = { at: Date.now() + sec * 1000, text: text || '', kind };
  t.handle = setTimeout(() => {
    const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1);
    if (cfg.get().assistant.minimized) setMinimized(false);
    send(W.assistant, 'chime', {});
    const n = nick();
    const msg = t.kind === 'alarm' ? `${n ? n + ', п' : 'П'}одъём! Будильник.` : t.text ? `${n ? n + ', н' : 'Н'}апоминаю: ${t.text}.` : `${n ? n + ', в' : 'В'}ремя вышло!`;
    setTimeout(() => say(msg, { anim: 'wave', emotion: 'happy' }), 900);
  }, sec * 1000);
  timers.push(t);
}
function startTimer(p) {
  const sec = p.seconds;
  if (!sec || sec < 1) return say('На сколько поставить таймер? Например: таймер на пять минут.');
  if (sec > 24 * 3600) return say('Таймер можно поставить максимум на сутки.');
  addTimer(sec, p.text);
  return say(p.text ? `Хорошо, напомню через ${brain.spellDuration(sec)}.` : `Поставил таймер на ${brain.spellDuration(sec)}.`, { emotion: 'happy' });
}
function setAlarm(p) {
  if (p.ask) return say('На какое время? Например: будильник на семь тридцать.');
  let sec = p.inSec;
  if (!sec) {
    const now = new Date(), at = new Date(now); at.setHours(p.hour, p.minute, 0, 0);
    if (at <= now) at.setDate(at.getDate() + 1);
    sec = Math.round((at - now) / 1000);
  }
  addTimer(sec, '', 'alarm');
  const at = new Date(Date.now() + sec * 1000);
  return say(`Будильник на ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}. Только не выключай компьютер.`, { emotion: 'happy' });
}

function diskReport() {
  const parts = [];
  for (const L of 'CDEFGH') {
    try {
      const s = fs.statfsSync(L + ':\\');
      const free = s.bavail * s.bsize / 1073741824, total = s.blocks * s.bsize / 1073741824;
      if (total < 1) continue;
      parts.push(`на диске ${L} свободно ${free < 10 ? free.toFixed(1).replace('.', ',') : Math.round(free)} из ${Math.round(total)} гигабайт`);
    } catch { }
  }
  if (!parts.length) return 'Не получилось прочитать диски.';
  const s = parts.join('; ');
  return s[0].toUpperCase() + s.slice(1) + '.';
}

// загрузка процессора — по разнице счётчиков os.cpus() за секунду
async function cpuLoad() {
  const snap = () => os.cpus().map(c => c.times);
  const a = snap(); await sleep(1000); const b = snap();
  let idle = 0, total = 0;
  b.forEach((t, i) => { const d = k => t[k] - a[i][k]; const tt = d('user') + d('nice') + d('sys') + d('idle') + d('irq'); total += tt; idle += d('idle'); });
  return total ? Math.round((1 - idle / total) * 100) : 0;
}
async function statusSay() {
  const load = await cpuLoad();
  const used = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  return say(`Процессор загружен на ${load} ${brain.plural(load, 'процент', 'процента', 'процентов')}, память занята на ${used} ${brain.plural(used, 'процент', 'процента', 'процентов')}. ${load > 85 ? 'Компьютер сейчас очень занят.' : 'Всё в порядке.'}`);
}

// ---------------------------------------------------------------- программы и окна
function spawnDetached(cmd, args = []) {
  try { const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }); p.unref(); return true; } catch (e) { log('spawn', cmd, e.message); return false; }
}
const BROWSER_RE = /^(msedge|chrome|firefox|opera|browser|yandex|brave|vivaldi|arc|chromium)$/i;
const TELEGRAM_RE = /^telegram$/i;
const DISCORD_RE = /^discord(ptb|canary)?$/i;

async function windowsNow() { const l = await core.safe('windows'); return Array.isArray(l) ? l : []; }
async function findAppWindows(target, sp = brain.special(target)) {
  const t = brain.norm(target);
  if (/^(браузер|интернет|браузера)$/.test(t)) return (await windowsNow()).filter(w => BROWSER_RE.test(w.name || ''));
  const cands = brain.candidates(t);
  if (sp && sp.name) cands.push(brain.norm(sp.name));
  if (sp && sp.kind === 'aumid' && sp.target === 'MSEdge') cands.push('msedge');
  return (await windowsNow()).filter(w => {
    const n = brain.norm((w.desc || '') + ' ' + (w.name || '') + ' ' + (w.title || ''));
    const words = brain.norm((w.desc || '') + ' ' + (w.name || '')).split(' ');
    return cands.some(c => n.includes(c) || words.some(x => x.length >= 4 && brain.similarity(x, c) >= 0.75));
  });
}
async function activateWindow(w) { if (input.ready) input.steps([`activate ${w.hwnd}`]); else await core.safe('activate', { hwnd: w.hwnd }); }

async function launch(item) {
  const k = item.kind, t = item.target;
  switch (k) {
    case 'path':
      if (/^[a-z]+\.exe$/i.test(t)) return spawnDetached(t, item.args || []);
      return !(await shell.openPath(t));
    case 'aumid': return spawnDetached('explorer.exe', ['shell:AppsFolder\\' + t]);
    case 'uri': case 'url': await shell.openExternal(t); return true;
    case 'shell': return spawnDetached('explorer.exe', [t]);
    case 'folder': await shell.openPath(app.getPath(item.folder)); return true;
    case 'drive': await shell.openPath(t); return true;
    case 'settings': openSettings(); return true;
    case 'search': return findFiles('');
    case 'app': {
      if (!apps.length) await loadApps();
      const a = apps.find(x => x.name.toLowerCase() === String(t).toLowerCase()) || brain.matchApp(t, apps);
      return a ? launch(appItem(a)) : false;
    }
  }
  return false;
}
function appItem(a) {
  if (/^[a-z]:\\/i.test(a.id) || a.id.startsWith('\\\\')) return { name: a.name, kind: 'path', target: a.id };
  if (/^\{[0-9A-F-]+\}\\/i.test(a.id)) return { name: a.name, kind: 'shell', target: 'shell:AppsFolder\\' + a.id };
  return { name: a.name, kind: 'aumid', target: a.id };
}

// список программ «Пуска» — через Get-StartApps в отдельном процессе (с кэшем на диске)
function startAppsPs() {
  const cmd = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress';
  return new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, timeout: 30000, maxBuffer: 16 << 20 }, (err, out) => {
    try { const j = JSON.parse(String(out).replace(/^﻿/, '')); res((Array.isArray(j) ? j : [j]).filter(a => a && a.Name && a.AppID).map(a => ({ name: a.Name, id: a.AppID }))); } catch { res(null); }
  }));
}
let appsLoading = null;
function loadApps() {
  if (appsLoading) return appsLoading;
  const cacheFile = path.join(DATA, 'apps.json');
  const accept = list => { if (Array.isArray(list) && list.length) apps = list.filter(a => !/^(uninstall|удалить)/i.test(a.name)).sort((x, y) => x.name.localeCompare(y.name, 'ru')); };
  if (!apps.length) { try { accept(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))); } catch { } }
  appsLoading = (async () => {
    let list = await startAppsPs();
    if (!list || !list.length) list = await core.safe('apps', {}, 20000);
    accept(list);
    try { if (apps.length) fs.writeFileSync(cacheFile, JSON.stringify(apps)); } catch { }
    appsLoading = null;
    return apps;
  })();
  return apps.length ? Promise.resolve(apps) : appsLoading;
}

async function openTarget(target, opts = {}) {
  const sc = findChatShortcut(target);
  if (sc) return openShortcut(sc);
  const sp = brain.special(target);
  const appLike = !sp || ['aumid', 'app'].includes(sp.kind) || (sp.kind === 'path' && !/explorer\.exe$/i.test(sp.target));
  if (appLike) {
    const ws = await findAppWindows(target, sp);
    if (ws.length) { await activateWindow(ws[0]); return opts.silent ? null : say(`Переключаюсь на ${ws[0].desc || ws[0].name}.`); }
    if (/^(браузер|интернет)$/.test(brain.norm(target))) { await shell.openExternal('https://www.google.com'); return opts.silent ? null : say('Открываю браузер.'); }
  }
  if (sp) { await launch(sp); return opts.silent ? null : say(brain.pick(brain.SAY.opened(sp.name))); }
  if (!apps.length) await loadApps();
  const a = brain.matchApp(target, apps);
  if (a) { await launch(appItem(a)); return opts.silent ? null : say(brain.pick(brain.SAY.opened(a.name))); }
  return say(brain.pick(brain.SAY.notFound(target)), { anim: 'think' });
}
async function closeTarget(target) {
  const t = brain.norm(target);
  if (/^(это|окно|текущее)/.test(t)) { if (lastExternalFg) core.safe('close', { hwnd: lastExternalFg.hwnd }); return say('Закрываю.'); }
  const hits = await findAppWindows(target);
  if (!hits.length) return say(`Не вижу открытого окна «${target}».`);
  hits.forEach(w => core.safe('close', { hwnd: w.hwnd }));
  return say(`Закрываю ${hits[0].desc || hits[0].name}.`);
}
async function ensureApp(name, re) {
  let w = (await windowsNow()).find(x => re.test(x.name || ''));
  if (w) return w;
  await openTarget(name, { silent: true });
  for (let i = 0; i < 50; i++) { await sleep(500); w = (await windowsNow()).find(x => re.test(x.name || '')); if (w) { await sleep(1500); return w; } }
  return null;
}

// поиск файлов — стандартный поиск Проводника по папке пользователя
function findFiles(q) {
  const home = os.homedir();
  const uri = `search-ms:displayname=${encodeURIComponent('Поиск: ' + (q || ''))}&crumb=location:${encodeURIComponent(home)}` + (q ? `&query=${encodeURIComponent(q)}` : '');
  spawnDetached('explorer.exe', [uri]);
  return say(q ? `Ищу «${q}».` : 'Открываю поиск.');
}

// ---------------------------------------------------------------- браузер
const BROWSER_KEYS = {
  newtab: 'CTRL T', closetab: 'CTRL W', reopentab: 'CTRL SHIFT T', nexttab: 'CTRL TAB', prevtab: 'CTRL SHIFT TAB', back: 'ALT LEFT', forward: 'ALT RIGHT',
  reload: 'F5', down: 'PGDN', up: 'PGUP', top: 'HOME', bottom: 'END', zoomin: 'CTRL PLUS', zoomout: 'CTRL MINUS', zoomreset: 'CTRL 0',
  history: 'CTRL H', downloads: 'CTRL J', incognito: 'CTRL SHIFT N', bookmark: 'CTRL D', address: 'CTRL L', find: 'CTRL F'
};
const BROWSER_SAY = { newtab: 'Новая вкладка.', closetab: 'Закрыл вкладку.', reopentab: 'Вернул вкладку.', incognito: 'Открываю режим инкогнито.', bookmark: 'Добавляю в закладки.', history: 'Открываю историю.', downloads: 'Открываю загрузки браузера.' };
const PAGE_ACTIONS = new Set(['back', 'forward', 'reload', 'down', 'up', 'top', 'bottom', 'zoomin', 'zoomout', 'zoomreset', 'find']);
async function browserAction(p) {
  if (!input.ready) return say('Не могу нажимать клавиши: помощник FelixInput не запущен.');
  let w = PAGE_ACTIONS.has(p.action) && lastExternalFg ? lastExternalFg : null;
  if (!w) w = (lastExternalFg && BROWSER_RE.test(lastExternalFg.name || '')) ? lastExternalFg : (await windowsNow()).find(x => BROWSER_RE.test(x.name || ''));
  if (!w) {
    if (p.action === 'newtab') { await shell.openExternal('https://www.google.com'); return say('Открываю браузер.'); }
    return say('Браузер не открыт. Скажи «открой браузер».');
  }
  const steps = [`activate ${w.hwnd}`, 'sleep 150', `keys ${p.action === 'tab' ? 'CTRL ' + p.n : BROWSER_KEYS[p.action]}`];
  if (p.action === 'find' && p.query) steps.push('sleep 350', `type ${b64(p.query)}`);
  input.steps(steps);
  if (BROWSER_SAY[p.action]) return say(BROWSER_SAY[p.action]);
}
async function openSite(q) {
  const s = brain.norm(q).replace(/^(сайт|страницу)\s+/, '');
  const sp = brain.special(s);
  if (sp && sp.kind === 'url') { await shell.openExternal(sp.target); return say(brain.pick(brain.SAY.opened(sp.name))); }
  if (/ точка /.test(s)) {
    const TLD = { ком: 'com', ру: 'ru', рф: 'рф', нет: 'net', орг: 'org', ио: 'io', инфо: 'info', дев: 'dev', ми: 'me', тв: 'tv' };
    const dom = s.split(' точка ').map((part, i, all) => (i === all.length - 1 && TLD[part]) || brain.translit(part).replace(/[^a-z0-9-]/g, '')).join('.');
    await shell.openExternal('https://' + dom);
    return say(`Открываю ${dom}.`);
  }
  await shell.openExternal('https://duckduckgo.com/?q=' + encodeURIComponent('\\' + s));
  return say(`Открываю ${q}.`);
}

// ---------------------------------------------------------------- Telegram и Discord
const chatsList = () => (Array.isArray(cfg.get().chats) ? cfg.get().chats : []);
const chatKey = s => brain.stemQuery(brain.norm(s).replace(/^(чат|канал|группу|группа|сервер|личку|переписку|диалог)\s+(с\s+|со\s+)?/, ''));
function findChatShortcut(said, appName) {
  const k = chatKey(said);
  if (!k) return null;
  return chatsList().find(c => (!appName || c.app === appName) && c.say && (chatKey(c.say) === k || brain.similarity(chatKey(c.say), k) >= 0.8)) || null;
}
async function openShortcut(c) {
  const t = String(c.target || '').trim();
  let url = null, m;
  if ((m = t.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(.+)$/i))) {
    const rest = m[1].replace(/\/$/, '');
    if (/^\+/.test(rest)) url = 'tg://join?invite=' + rest.slice(1);
    else if (/^joinchat\//i.test(rest)) url = 'tg://join?invite=' + rest.split('/')[1];
    else if (/^c\//i.test(rest)) url = 'https://t.me/' + rest;
    else { const [domain, post] = rest.split('/'); url = 'tg://resolve?domain=' + domain + (post ? '&post=' + post : ''); }
  } else if ((m = t.match(/^(?:https?:\/\/)?(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(.+)$/i))) url = 'discord://-/channels/' + m[1];
  else if (/^(tg|discord|https?):/i.test(t)) url = t;
  if (url) { await shell.openExternal(url); return say(`Открываю ${c.say}.`); }
  return c.app === 'discord' ? openDiscord(t, '', true) : openTelegram(t, true);
}
async function openTelegram(q, exact = false) {
  if (!exact) { const sc = findChatShortcut(q, 'telegram'); if (sc) return openShortcut(sc); }
  if (!input.ready) return say('Не могу управлять Телеграмом: помощник FelixInput не запущен.');
  say(`Открываю в Телеграме «${q}».`);
  const w = await ensureApp('телеграм', TELEGRAM_RE);
  if (!w) return say('Не получилось открыть Телеграм.');
  input.steps([`activate ${w.hwnd}`, 'sleep 400', 'keys ESC', 'sleep 150', 'keys ESC', 'sleep 150', 'keys CTRL F', 'sleep 300', 'keys CTRL A', `type ${b64(exact ? q : brain.stemQuery(q))}`, 'sleep 1400', 'keys ENTER']);
}
async function telegramKeys(steps, phrase) {
  if (!input.ready) return say('Не могу управлять Телеграмом: помощник FelixInput не запущен.');
  const w = await ensureApp('телеграм', TELEGRAM_RE);
  if (!w) return say('Не получилось открыть Телеграм.');
  input.steps([`activate ${w.hwnd}`, 'sleep 400', 'keys ESC', 'sleep 150', ...steps]);
  return say(phrase);
}
async function openDiscord(q, kind, exact = false) {
  if (!exact) { const sc = findChatShortcut(q, 'discord'); if (sc) return openShortcut(sc); }
  if (!input.ready) return say('Не могу управлять Дискордом: помощник FelixInput не запущен.');
  const what = { server: 'сервер', channel: 'канал', voice: 'голосовой канал', dm: 'личку' }[kind] || '';
  say(`Открываю в Дискорде ${what ? what + ' ' : ''}«${q}».`);
  const w = await ensureApp('дискорд', DISCORD_RE);
  if (!w) return say('Не получилось открыть Дискорд.');
  const prefix = { server: '*', channel: '#', voice: '!', dm: '@' }[kind] || '';
  input.steps([`activate ${w.hwnd}`, 'sleep 500', 'keys ESC', 'sleep 150', 'keys CTRL K', 'sleep 500', `type ${b64(prefix + (exact ? q : brain.stemQuery(q)))}`, 'sleep 900', 'keys ENTER']);
}

// ---------------------------------------------------------------- погода, время, валюты, справка (Open-Meteo, ЦБ РФ, Википедия)
const WMO = { 0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно', 45: 'Туман', 48: 'Изморозь', 51: 'Морось', 53: 'Морось', 55: 'Сильная морось', 56: 'Ледяная морось', 57: 'Ледяная морось', 61: 'Небольшой дождь', 63: 'Дождь', 65: 'Сильный дождь', 66: 'Ледяной дождь', 67: 'Ледяной дождь', 71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег', 77: 'Снежные зёрна', 80: 'Ливень', 81: 'Ливень', 82: 'Сильный ливень', 85: 'Снегопад', 86: 'Сильный снегопад', 95: 'Гроза', 96: 'Гроза с градом', 99: 'Гроза с градом' };
async function geocode(name) {
  try {
    const j = await (await net.fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=ru&format=json`)).json();
    return (j.results || []).map(r => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, tz: r.timezone }));
  } catch (e) { log('geocode', e.message); return []; }
}
const CITY_ALIASES = { питер: 'Санкт-Петербург', питере: 'Санкт-Петербург', петербург: 'Санкт-Петербург', петербурге: 'Санкт-Петербург', спб: 'Санкт-Петербург', мск: 'Москва', екб: 'Екатеринбург', нижний: 'Нижний Новгород', 'нижнем новгороде': 'Нижний Новгород', ростове: 'Ростов-на-Дону', ростов: 'Ростов-на-Дону', 'нью йорке': 'Нью-Йорк', 'нью йорк': 'Нью-Йорк' };
async function geocodeCity(name) {
  const n = brain.norm(name);
  if (!n) return null;
  const forms = [...new Set([CITY_ALIASES[n], n.replace(/е(?=\s|$)/g, 'а'), n.replace(/е(?=\s|$)/g, ''), n.replace(/и(?=\s|$)/g, 'ь'), n.replace(/и(?=\s|$)/g, 'а'), n.replace(/у(?=\s|$)/g, 'а'), n.replace(/ом(?=\s|$)/g, ''), n].filter(Boolean))];
  const found = {};
  for (const f of forms) {
    const r = await geocode(f);
    found[f] = r[0];
    if (r[0] && brain.norm(r[0].name) === brain.norm(f)) return r[0];
  }
  const r = found[n];
  return r && brain.similarity(brain.norm(r.name), n) >= 0.75 ? r : null;
}
async function homeCity() { const w = cfg.get().weather; return w.lat != null ? w : null; }
function askCity() { openSettings('general'); return say('Сначала скажи мне свой город: я открыл настройки. Или спроси, например: погода в Казани.'); }
async function forecast(lat, lon) {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=3&wind_speed_unit=ms`;
    return await (await net.fetch(u)).json();
  } catch (e) { log('forecast', e.message); return null; }
}
async function weatherSay(p) {
  let place, lat, lon;
  if (p.city) {
    const g = await geocodeCity(p.city);
    if (!g) return say(`Не нашёл город «${p.city}».`, { anim: 'think' });
    place = g.name; lat = g.lat; lon = g.lon;
  } else { const w = await homeCity(); if (!w) return askCity(); place = w.city; lat = w.lat; lon = w.lon; }
  const f = await forecast(lat, lon);
  if (!f || !f.current) return say('Не получилось узнать погоду. Нет интернета?');
  if (!p.day) {
    const c = f.current, pp = f.daily.precipitation_probability_max[0];
    const deg = Math.round(c.temperature_2m), wind = Math.round(c.wind_speed_10m);
    return say(`В городе ${place} сейчас ${deg} ${brain.plural(deg, 'градус', 'градуса', 'градусов')}, ${(WMO[c.weather_code] || '').toLowerCase()}. Ощущается как ${Math.round(c.apparent_temperature)}. Ветер ${wind} ${brain.plural(wind, 'метр', 'метра', 'метров')} в секунду${pp >= 40 ? `, вероятность осадков ${pp} ${brain.plural(pp, 'процент', 'процента', 'процентов')}` : ''}.`);
  }
  const d = f.daily, i = p.day;
  const hi = Math.round(d.temperature_2m_max[i]), pr = d.precipitation_probability_max[i] ?? 0;
  return say(`${i === 1 ? 'Завтра' : 'Послезавтра'} в городе ${place} ${(WMO[d.weather_code[i]] || '').toLowerCase()}, от ${Math.round(d.temperature_2m_min[i])} до ${hi} ${brain.plural(hi, 'градуса', 'градусов', 'градусов')}. Вероятность осадков ${pr} ${brain.plural(pr, 'процент', 'процента', 'процентов')}.`);
}
let rates = null;
async function currencySay(p) {
  try { if (!rates || Date.now() - rates.at > 3600000) rates = { at: Date.now(), v: (await (await net.fetch('https://www.cbr-xml-daily.ru/daily_json.js')).json()).Valute }; }
  catch { return say('Не получилось узнать курс. Нет интернета?'); }
  const rub = code => (code === 'RUB' ? 1 : rates.v[code] ? rates.v[code].Value / rates.v[code].Nominal : null);
  const NAME = { USD: ['доллар', 'доллара', 'долларов'], EUR: ['евро', 'евро', 'евро'], CNY: ['юань', 'юаня', 'юаней'], RUB: ['рубль', 'рубля', 'рублей'], KZT: ['тенге', 'тенге', 'тенге'], GBP: ['фунт', 'фунта', 'фунтов'], JPY: ['иена', 'иены', 'иен'], TRY: ['лира', 'лиры', 'лир'], UAH: ['гривна', 'гривны', 'гривен'], CHF: ['франк', 'франка', 'франков'], PLN: ['злотый', 'злотых', 'злотых'] };
  const nm = (code, n) => brain.plural(Math.round(n), ...NAME[code]);
  const fmt = x => (x >= 100 ? Math.round(x) : Math.round(x * 100) / 100).toString().replace('.', ',');
  if (!p.from) return say(`Доллар — ${fmt(rub('USD'))} рубля, евро — ${fmt(rub('EUR'))} рубля по курсу Центробанка.`);
  const a = rub(p.from), b = rub(p.to || 'RUB');
  if (!a || !b) return say('Такой валюты нет в курсах Центробанка.');
  const res = p.amount * a / b;
  if (p.amount === 1 && (p.to || 'RUB') === 'RUB') return say(`Один ${NAME[p.from][0]} — ${fmt(res)} ${nm('RUB', res)} по курсу Центробанка.`);
  return say(`${fmt(p.amount)} ${nm(p.from, p.amount)} — это примерно ${fmt(res)} ${nm(p.to || 'RUB', res)}.`);
}
async function wikiSay(q) {
  try {
    const s = await (await net.fetch(`https://ru.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=1&namespace=0&format=json`)).json();
    const title = s[1] && s[1][0];
    if (!title) return askAi('Что такое ' + q);
    const d = await (await net.fetch(`https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`)).json();
    let text = String(d.extract || '').replace(/́/g, '').replace(/\s*\([^()]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    text = sentences.slice(0, 2).join(' ').trim();
    if (text.length > 400) text = text.slice(0, 400).replace(/\s\S*$/, '') + '…';
    return say(text || `Про «${title}» в Википедии ничего коротко не написано.`);
  } catch (e) { log('wiki', e.message); return say('Не получилось заглянуть в Википедию. Нет интернета?'); }
}
function daysUntilSay(what) {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), y = now.getFullYear();
  const next = (m, d) => { const t = new Date(y, m, d); return t > today ? t : new Date(y + 1, m, d); };
  const weekday = wd => { const t = new Date(today); do t.setDate(t.getDate() + 1); while (t.getDay() !== wd); return t; };
  const w = brain.norm(what);
  const T = [[/нового года|новый год/, () => next(0, 1), 'Нового года'], [/лета/, () => next(5, 1), 'лета'], [/осени/, () => next(8, 1), 'осени'], [/зимы/, () => next(11, 1), 'зимы'],
    [/весны/, () => next(2, 1), 'весны'], [/конца года/, () => new Date(y, 11, 31), 'конца года'], [/выходны|субботы/, () => weekday(6), 'выходных'], [/пятницы/, () => weekday(5), 'пятницы'],
    [/понедельника/, () => weekday(1), 'понедельника'], [/8 марта|восьмого марта/, () => next(2, 8), 'восьмого марта'], [/дня рождения/, null, '']];
  for (const [re, fn, name] of T) {
    if (!re.test(w)) continue;
    if (!fn) return say('Я пока не знаю, когда у тебя день рождения.');
    const days = Math.round((fn() - today) / 86400000);
    return say(`До ${name} ${days} ${brain.plural(days, 'день', 'дня', 'дней')}.`);
  }
  return say(`Не знаю, когда будет «${what}».`, { anim: 'think' });
}
const notesFile = () => path.join(app.getPath('documents'), 'Заметки Феликса.txt');
function openNewest(dir, where) {
  let best = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/\.(crdownload|part|tmp|partial)$|^desktop\.ini$/i.test(f)) continue;
      const st = fs.statSync(path.join(dir, f));
      if (!best || st.mtimeMs > best.t) best = { f, t: st.mtimeMs };
    }
  } catch { }
  if (!best) return say(`В ${where} пусто.`);
  shell.openPath(path.join(dir, best.f));
  return say(`Открываю ${best.f.replace(/\.[^.]+$/, '')}.`);
}
function power(action) {
  const cmds = { shutdown: ['shutdown.exe', ['/s', '/t', '0']], restart: ['shutdown.exe', ['/r', '/t', '0']], lock: ['rundll32.exe', ['user32.dll,LockWorkStation']], sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']] };
  const c = cmds[action]; if (c) spawnDetached(c[0], c[1]);
}

// ---------------------------------------------------------------- нейросеть
let aiBusy = false;
async function askAi(q, fromUnknown = false) {
  if (aiBusy) return say('Секунду, я ещё думаю над прошлым вопросом.');
  const src = await llm.pick();
  if (!src) return fromUnknown ? say(brain.pick(brain.SAY.unknown), { anim: 'think' }) : say(explain({ code: 'none' }), { anim: 'think' });
  aiBusy = true;
  send(W.assistant, 'think', { on: true, phone: true });
  say(brain.pick(['Секунду, спрошу у нейросети.', 'Сейчас узнаю.', 'Хороший вопрос. Минутку.']), { anim: 'think' });
  try {
    const r = await llm.ask(q);
    log('ai', r.source, q);
    send(W.assistant, 'think', { on: false });
    await sleep(400);
    return say(r.text);
  } catch (e) {
    log('ai error', e.code || '', String(e.message || '').slice(0, 300));
    send(W.assistant, 'think', { on: false });
    return say(explain(e), { anim: 'think' });
  } finally { aiBusy = false; }
}

// ---------------------------------------------------------------- музыка
async function yandexTrack(q) {
  try {
    const j = await (await net.fetch(`https://api.music.yandex.net/search?text=${encodeURIComponent(q)}&type=track&page=0&nocorrect=false`)).json();
    const t = ((j.result && j.result.tracks && j.result.tracks.results) || []).find(x => x && x.id != null && x.available !== false);
    return t ? { id: String(t.id), album: t.albums && t.albums[0] && t.albums[0].id, title: t.title, artist: (t.artists || []).map(a => a.name).join(', ') } : null;
  } catch (e) { log('yandex search', e.message); return null; }
}
async function playTrack(q) {
  if (cfg.get().music === 'yandex') {
    let t = await yandexTrack(q);
    if (!t) { const lat = brain.translit(q); if (lat !== brain.norm(q)) t = await yandexTrack(lat); }
    if (t) { say(`Включаю «${t.title}», ${t.artist}.`, { emotion: 'happy' }); setTimeout(() => shell.openExternal(t.album ? `https://music.yandex.ru/album/${t.album}/track/${t.id}` : `https://music.yandex.ru/search?text=${encodeURIComponent(q)}`), 1500); return; }
    say(`Ищу «${q}» в Яндекс Музыке.`); setTimeout(() => shell.openExternal(`https://music.yandex.ru/search?text=${encodeURIComponent(q)}`), 1200); return;
  }
  say(`Ищу «${q}» на YouTube Music.`, { emotion: 'happy' });
  setTimeout(() => shell.openExternal(`https://music.youtube.com/search?q=${encodeURIComponent(q)}`), 1200);
}

// ---------------------------------------------------------------- звук: устройства вывода и медиа
const outKind = n => (/наушник|headphone|headset|гарнитур|airpods|buds/i.test(n) ? 'phones' : /hdmi|nvidia|displayport|монитор|телевизор|\btv\b/i.test(n) ? 'hdmi' : /динамик|speaker|колонк|realtek|line out|линейн/i.test(n) ? 'speakers' : 'other');
const OUT_SAY = { phones: 'в наушниках', speakers: 'на колонках', hdmi: 'на мониторе', other: '' };
async function audioOutputs() {
  const r = await input.audio('list');
  if (!r || !r.ok) return [];
  return r.text.split('\n').filter(Boolean).map(l => { const [id, name, def] = l.split('\t'); return { id, name, short: name.replace(/\s*\(.*\)\s*$/, ''), kind: outKind(name), active: def === '1' }; });
}
async function audioOutputCmd(p) {
  const list = await audioOutputs();
  if (!list.length) return say('Не вижу устройств вывода звука.');
  const cur = list.find(d => d.active);
  if (p.which) return say(cur ? `Звук сейчас ${OUT_SAY[cur.kind] || 'идёт в ' + cur.short}.` : 'Не знаю, куда сейчас идёт звук.');
  let dev = null;
  if (p.target === 'next') dev = list[(list.indexOf(cur) + 1) % list.length];
  else {
    const t = brain.norm(p.target || '');
    const kind = /наушник/.test(t) ? 'phones' : /(колонк|динамик|акустик)/.test(t) ? 'speakers' : /(монитор|телевизор|hdmi)/.test(t) ? 'hdmi' : null;
    dev = (kind && list.find(d => d.kind === kind)) || list.find(d => brain.norm(d.name).includes(t));
  }
  if (!dev) return say(`Не нашёл устройство «${p.target}». Есть: ${list.map(d => d.short).join(', ')}.`);
  if (dev.active) return say(`Звук и так ${OUT_SAY[dev.kind] || 'идёт в ' + dev.short}.`);
  const r = await input.audio('set', dev.id);
  if (!r || !r.ok) return say('Не получилось переключить звук.');
  return say(`Звук ${OUT_SAY[dev.kind] || 'идёт в ' + dev.short}.`);
}
async function mediaControl(action) {
  const r = await input.media(action);
  if (!r) {
    const key = { next: 'NEXT', prev: 'PREV', pause: 'PLAYPAUSE', play: 'PLAYPAUSE', toggle: 'PLAYPAUSE' }[action];
    if (key) core.safe('keys', { keys: [key] });
    return say(action === 'info' ? 'Не могу узнать, что сейчас играет.' : 'Готово.');
  }
  if (r.status === 'none') return say('Сейчас ничего не играет. Скажи, например: включи трек Группа крови.');
  const what = r.title ? `«${r.title}»${r.artist ? ', ' + r.artist : ''}` : '';
  switch (action) {
    case 'pause': return say('Пауза.');
    case 'play': return say(what ? `Продолжаю ${what}.` : 'Продолжаю.');
    case 'next': return say(what ? `Дальше — ${what}.` : 'Следующий трек.');
    case 'prev': return say(what ? `Возвращаю ${what}.` : 'Предыдущий трек.');
    case 'info': return say(what ? `Сейчас ${r.status === 'Playing' ? 'играет' : 'на паузе'} ${what}.` : 'Не знаю, что сейчас играет.');
  }
}

// ---------------------------------------------------------------- телефон: «Феликс Link»
let link = null;
let phoneCall = null;          // { state: 'ringing'|'active', number, name, incoming, since }
let phoneOrigin = 0;           // когда пришла последняя команда с телефона — ответы уходят и туда
const APK_FILE = () => path.join(HOME, 'phone', 'FelixLink.apk');
const FW_RULE = 'Felix Link';

function startLink() {
  if (link || cfg.get().phone.enabled === false) return;
  if (!cfg.get().phone.code) cfg.patch({ phone: { code: newCode() } });
  link = new Link({ getCode: () => cfg.get().phone.code, pcName: os.hostname(), apkPath: APK_FILE(), log });
  link.on('connected', info => { phoneApps.list = null; phoneStatusChanged(); refreshTray(); send(W.assistant, 'notice', { title: 'Телефон подключён', text: info.device, ms: 3500 }); });
  link.on('disconnected', () => { phoneStatusChanged(); refreshTray(); if (phoneCall) { phoneCall = null; closeCallCard(); } });
  link.on('battery', () => phoneStatusChanged());
  link.on('call', onPhoneCall);
  link.on('notif', m => { if (cfg.get().phone.notifs) send(W.assistant, 'notice', { title: `${m.app}: ${m.title}`, text: m.text }); });
  link.on('felix', text => {
    phoneOrigin = Date.now();
    log('phone cmd', text);
    const w = brain.wake(text);
    handle(brain.parse(w.woke ? w.rest : text), text);
  });
  link.start();
}
function stopLink() { try { link && link.stop(); } catch { } link = null; phoneStatusChanged(); }

function phoneStatus() {
  return {
    enabled: cfg.get().phone.enabled !== false, connected: !!(link && link.connected), info: link && link.info, battery: link && link.battery,
    code: cfg.get().phone.code, addresses: Link.addresses(), apkPort: APK_PORT, apk: exists(APK_FILE()),
    wol: Link.wolFor(link && link.info ? link.info.address : ''), control: !!(link && link.connected) && appVer() >= 1.1
  };
}
const phoneStatusChanged = () => { const s = phoneStatus(); send(W.settings, 'phone', s); send(W.phone, 'phone', s); };
const callerName = m => (m && (m.name || m.number)) || 'неизвестный номер';

function onPhoneCall(m) {
  const prev = phoneCall;
  if (m.state === 'idle') { phoneCall = null; closeCallCard(prev ? 'Звонок завершён' : null); return; }
  phoneCall = { ...m, since: prev && prev.state === m.state ? prev.since : Date.now() };
  showCallCard(phoneCall);
  if (m.state === 'ringing' && (!prev || prev.state !== 'ringing') && cfg.get().phone.announce) {
    say(`Звонит ${callerName(m)}.`, { anim: 'listen' });
    // ближайшие секунды можно сказать «прими» / «отклони» без «Феликс»
    setTimeout(() => { if (phoneCall && phoneCall.state === 'ringing') startListening(15); }, 1800);
  }
}

// карточка звонка — внизу по центру основного монитора, поверх всего (даже полноэкранных окон)
function showCallCard(call) {
  const wa = primary().workArea, w = 420, h = 118;
  if (!W.call || W.call.isDestroyed()) {
    const win = W.call = baseWin({ x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + wa.height - 40 - h, width: w, height: h, alwaysOnTop: true, focusable: true });
    win.setAlwaysOnTop(true, 'screen-saver');
    load(win, 'call.html');
    win.webContents.once('did-finish-load', () => { send(win, 'call', win._call); win.showInactive(); });
    win.on('closed', () => { if (W.call === win) delete W.call; });
  }
  W.call._call = call;
  send(W.call, 'call', call);
}
function closeCallCard(text) {
  const w = W.call;
  if (!w || w.isDestroyed()) return;
  if (!text) { w.close(); return; }
  w._call = { state: 'ended', text };
  send(w, 'call', w._call);
  setTimeout(() => { if (!w.isDestroyed() && w._call && w._call.state === 'ended') w.close(); }, 2500);
}

function phoneReady() {
  if (link && link.connected) return true;
  if (cfg.get().phone.enabled === false) say('Связь с телефоном выключена. Включи её в настройках, раздел «Телефон».');
  else say('Телефон не подключён. Открой на телефоне приложение «Феликс Link».');
  return false;
}
/** Команда телефону с ответом голосом; okText — строка или функция от ответа */
async function phoneDo(cmd, args = {}, okText = null) {
  if (!phoneReady()) return null;
  const r = await link.request(cmd, args);
  if (!r) { say('Телефон не ответил.'); return null; }
  if (!r.ok) { say(`Не получилось: ${r.text || 'телефон отказал'}.`); return null; }
  if (okText) say(typeof okText === 'function' ? okText(r) : okText);
  return r;
}
const two = n => String(n).padStart(2, '0');

// Брандмауэр: правило только для портов Феликса и только для устройств домашней сети.
// Запускается кнопкой в Настройках → Телефон; Windows сама спрашивает подтверждение (UAC).
function allowFirewall() {
  const exe = process.execPath;
  const cmds = [
    `netsh advfirewall firewall delete rule name="${FW_RULE}"`,
    `netsh advfirewall firewall add rule name="${FW_RULE}" dir=in action=allow protocol=TCP localport=${LINK_PORT},${APK_PORT} remoteip=localsubnet profile=any program="${exe}"`,
    `netsh advfirewall firewall add rule name="${FW_RULE}" dir=in action=allow protocol=UDP localport=${DISC_PORT} remoteip=localsubnet profile=any program="${exe}"`
  ].join(' & ');
  return new Promise(res => execFile('powershell.exe', ['-NoProfile', '-Command', `Start-Process cmd -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '/c ${cmds.replace(/'/g, "''")}'`],
    { windowsHide: true, timeout: 180000 }, err => res(!err)));
}
/** Разрешено ли телефону подключиться: наше правило или правило из окна Windows «Разрешить доступ» */
function firewallAllowed() {
  return new Promise(res => execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in', 'verbose'], { windowsHide: true, maxBuffer: 64 << 20, timeout: 20000 }, (err, out) => {
    if (err && !out) return res(false);
    const exe = process.execPath.toLowerCase();
    res(String(out).split(/\r?\n\s*\r?\n/).some(b => { const s = b.toLowerCase(); return s.includes(exe) && /(action|действие):\s+(allow|разрешить)/.test(s) && /(enabled|включен\S*):\s+(yes|да)/.test(s); }));
  }));
}

async function phoneHandle(p) {
  switch (p.intent) {
    case 'phone.answer':
      if (!phoneCall || phoneCall.state !== 'ringing') return say('Сейчас никто не звонит.');
      return phoneDo('answer');
    case 'phone.decline': case 'phone.hangup':
      if (!phoneCall) return say('Сейчас нет звонка.');
      return phoneDo(phoneCall.state === 'ringing' && p.intent === 'phone.decline' ? 'decline' : 'hangup');
    case 'phone.speaker':
      if (!phoneCall || phoneCall.state !== 'active') return say('Громкую связь можно включить во время разговора.');
      if (await phoneDo('speaker', { on: p.on !== false }) && phoneCall) { phoneCall.speaker = p.on !== false; showCallCard(phoneCall); }
      return;
    case 'phone.who':
      return say(phoneCall ? `${phoneCall.state === 'ringing' ? 'Звонит' : 'Разговор с'} ${callerName(phoneCall)}.` : 'Сейчас никто не звонит.');
    case 'phone.find':
      return phoneDo('find', { on: p.on !== false }, p.on === false ? 'Выключил звонок на телефоне.' : 'Звоню на телефон. Скажи «нашёл», чтобы выключить.');
    case 'phone.alarm': {
      let h = p.hour, m = p.minute;
      if (p.inSec) { const d = new Date(Date.now() + p.inSec * 1000); h = d.getHours(); m = d.getMinutes(); }
      return phoneDo('alarm', { hour: h, minute: m, label: 'Феликс' }, `Поставил будильник на телефоне на ${h}:${two(m)}.`);
    }
    case 'phone.timer':
      if (!p.seconds) return say('На сколько поставить таймер на телефоне?');
      return phoneDo('timer', { seconds: p.seconds, label: 'Феликс' }, `Таймер на телефоне: ${brain.spellDuration(p.seconds)}.`);
    case 'phone.volume':
      return phoneDo('volume', { stream: p.stream || 'music', ...(p.level != null ? { level: p.level } : { delta: p.delta || 0 }) },
        r => `Громкость ${p.stream === 'ring' ? 'звонка' : 'телефона'} ${r.data && r.data.level != null ? r.data.level + ' ' + brain.plural(r.data.level, 'процент', 'процента', 'процентов') : 'изменена'}.`);
    case 'phone.ringer':
      return phoneDo('ringer', { mode: p.mode }, { silent: 'Выключил звук на телефоне.', vibrate: 'Телефон на вибрации.', normal: 'Включил звук на телефоне.' }[p.mode]);
    case 'phone.dnd':
      return phoneDo('dnd', { on: p.on }, p.on ? 'Включил «Не беспокоить» на телефоне.' : 'Выключил «Не беспокоить».');
    case 'phone.battery': {
      const r = await phoneDo('battery');
      if (r && r.data) return say(`На телефоне ${r.data.level} ${brain.plural(r.data.level, 'процент', 'процента', 'процентов')}${r.data.charging ? ', заряжается' : ''}.`);
      return;
    }
    case 'phone.open':
      return phoneDo('open', { names: brain.candidates(p.app) }, r => `Открываю на телефоне ${r.text || p.app}.`);
    case 'phone.media':
      return phoneDo('media', { action: p.action }, { pause: 'Пауза на телефоне.', play: 'Продолжаю на телефоне.', next: 'Следующий трек на телефоне.', prev: 'Предыдущий трек на телефоне.' }[p.action]);
    case 'phone.notifs': {
      const r = await phoneDo('notifs', { count: 5 });
      if (!r) return;
      const list = Array.isArray(r.data) ? r.data : [];
      if (!list.length) return say('Новых уведомлений на телефоне нет.');
      return say('Последние уведомления: ' + list.slice(0, 4).map(n => `${n.app}, ${n.title}${n.text ? ': ' + String(n.text).slice(0, 80) : ''}`).join('. ') + '.');
    }
    case 'phone.call': {
      const short = p.name.split(' ').map(w => (w.length >= 4 ? w.slice(0, -1) : w)).join(' ');
      const r = await phoneDo('contact', { names: [p.name, brain.stemQuery(p.name), short] });
      if (!r || !r.data) return;
      pendingConfirm = { action: 'dial', number: r.data.number, name: r.data.name, until: Date.now() + 12000 };
      startListening(10);
      return say(`Позвонить: ${r.data.name}? Скажи «да».`, { anim: 'think' });
    }
    // ---- дела: приложение выбирает пользователь; Феликс открывает его и вписывает запрос, заказывает человек сам
    case 'phone.food': return phoneService('food', { query: p.query });
    case 'phone.music': return phoneService('music', { query: p.query });
    case 'phone.map':
      if (!(link && link.connected)) return mapsOnPc(p.query, false);
      return phoneService('maps', { query: p.query });
    case 'phone.taxi': case 'phone.route': {
      const route = p.intent === 'phone.route';
      if (route && !p.to) return say('Куда построить маршрут?');
      const pl = placeDest(p.to);
      if (pl.missing) { openSettings('phone'); return say(`Не знаю, где ${pl.missing === 'дом' ? 'твой дом' : 'твоя работа'}. Впиши адрес в настройках, раздел «Телефон», — и скажи ещё раз.`); }
      if (route && !(link && link.connected)) return mapsOnPc(pl.dest, true);
      return phoneService(route ? 'maps' : 'taxi', { dest: pl.dest, phrase: pl.phrase, route });
    }
    case 'phone.shop': {
      if (!p.query) return say('Что найти?');
      if (!phoneReady()) return;
      const pkg = phoneapps.storePkg(p.store);
      if (pkg) {
        const list = await phoneAppList();
        if (list && list.some(a => a.pkg === pkg)) return phoneService('shop', { query: p.query, pkg });
        if (list) await say(`${phoneapps.knownName(pkg)} на телефоне не нашёл — ищу в твоём магазине.`);
      }
      return phoneService('shop', { query: p.query });
    }
    // ---- управление телефоном с компьютера
    case 'phone.panel':
      if (!phoneReady()) return;
      openPhonePanel();
      return say(appVer() < 1.1 ? NEED_UPDATE : 'Вот твой телефон. Кликай мышкой — как пальцем.');
    case 'phone.nav':
      if (!phoneReady()) return;
      if (appVer() < 1.1) return say(NEED_UPDATE);
      if (p.action === 'wake') return phoneDo('wake', {}, 'Включил экран телефона.');
      return phoneDo('nav', { action: p.action }, { back: 'Назад.', home: 'На главный экран.', recents: 'Недавние приложения.', notifications: 'Открыл шторку.', lock: 'Заблокировал телефон.', screenshot: 'Сделал снимок экрана на телефоне.' }[p.action] || 'Готово.');
    case 'phone.type':
      if (!phoneReady()) return;
      if (appVer() < 1.1) return say(NEED_UPDATE);
      return phoneDo('text', { text: p.text }, 'Написал.');
    case 'phone.url': {
      const url = (clipboard.readText() || '').trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return say('Скопируй ссылку на компьютере — и я открою её на телефоне.');
      if (!phoneReady()) return;
      if (appVer() < 1.1) return say(NEED_UPDATE);
      return phoneDo('url', { url }, 'Открыл ссылку на телефоне.');
    }
    case 'phone.clip': {
      const text = clipboard.readText() || '';
      if (!text.trim()) return say('Буфер обмена пуст. Скопируй текст — и я отправлю его на телефон.');
      if (!phoneReady()) return;
      if (appVer() < 1.1) return say(NEED_UPDATE);
      return phoneDo('clip', { text: text.slice(0, 20000) }, 'Отправил на телефон — можно вставлять.');
    }
  }
}

// ---------------------------------------------------------------- дела на телефоне: доставка, такси, карты, покупки, музыка
let pendingChoice = null;          // { kind, options: [{ pkg, label }], args, until } — «Через какое приложение…?»
const phoneApps = { list: null, at: 0 };
const appVer = () => parseFloat((link && link.info && link.info.app) || '1.0') || 1;
const NEED_UPDATE = 'Обнови «Феликс Link» на телефоне: новая версия умеет управлять телефоном с компьютера. Скачать — по QR-коду в настройках, раздел «Телефон».';
const orList = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' или ' + a[a.length - 1] : a[0] || '');

/** Приложения телефона (с иконками), кэш на 10 минут */
async function phoneAppList(force = false) {
  if (!link || !link.connected || appVer() < 1.1) return null;
  if (!force && phoneApps.list && Date.now() - phoneApps.at < 10 * 60000) return phoneApps.list;
  const r = await link.request('apps', { icons: true }, 25000);
  if (r && r.ok && Array.isArray(r.data)) { phoneApps.list = r.data; phoneApps.at = Date.now(); }
  return phoneApps.list;
}
const chosenApp = kind => { const s = (cfg.get().phone.services || {})[kind]; return s && s.pkg ? { pkg: s.pkg, label: s.label || phoneapps.knownName(s.pkg) || '' } : null; };

/** «домой» / «на работу» → адрес из настроек; остальное — как сказано */
function placeDest(to) {
  const pl = cfg.get().phone.places || {};
  if (to === 'дом') return pl.home ? { dest: pl.home, phrase: 'до дома' } : { missing: 'дом' };
  if (to === 'работа') return pl.work ? { dest: pl.work, phrase: 'до работы' } : { missing: 'работа' };
  return { dest: to || '', phrase: to ? `до «${to}»` : '' };
}

/** Телефон не подключён — карта открывается на компьютере (Google Карты в браузере) */
function mapsOnPc(q, route) {
  if (!q) return say('Что найти на карте?');
  const u = route ? 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q) : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  shell.openExternal(u);
  return say(route ? `Телефон не на связи — открыл маршрут на компьютере.` : `Телефон не на связи — открыл карту на компьютере.`);
}

async function phoneService(kind, args = {}) {
  if (!phoneReady()) return;
  if (appVer() < 1.1) return say(NEED_UPDATE);
  let app = args.pkg ? { pkg: args.pkg, label: phoneapps.knownName(args.pkg) || '' } : chosenApp(kind);
  let picked = false;
  if (!app) {
    const found = phoneapps.suggest(kind, (await phoneAppList()) || []);
    if (found.length === 1) {
      app = { pkg: found[0].pkg, label: found[0].label }; picked = true;
      cfg.patch({ phone: { services: { [kind]: app } } });
    } else if (found.length > 1) {
      const options = found.slice(0, 4).map(a => ({ pkg: a.pkg, label: a.label }));
      pendingChoice = { kind, options, args, until: Date.now() + 15000 };
      startListening(14);
      return say(`Через какое приложение: ${orList(options.map(o => o.label))}? Запомню выбор.`, { anim: 'think' });
    } else {
      openSettings('phone');
      return say(`На телефоне не нашёл ${phoneapps.CATS[kind].gen}. Выбери любое приложение в настройках, раздел «Телефон».`);
    }
  }
  return runService(kind, app, args, picked);
}

async function runService(kind, app, args = {}, picked = false) {
  if (!link || !link.connected) return phoneReady();
  const w = cfg.get().weather;
  const near = w.lat != null && w.lon != null ? { lat: w.lat, lon: w.lon } : null;
  const where = kind === 'taxi' || (kind === 'maps' && args.route);
  const query = where ? '' : String(args.query || '');
  const dest = where ? String(args.dest || '') : '';
  const links = phoneapps.links(kind, app.pkg, kind === 'maps' ? (args.route ? 'route' : 'place') : '');
  send(W.assistant, 'think', { on: true, phone: true, text: `Открываю ${app.label || 'приложение'} на телефоне…` });
  const r = await link.request('service', { pkg: app.pkg, links, query, dest, near, search: true }, 30000);
  send(W.assistant, 'think', { on: false });
  if (!r) return say('Телефон не ответил.');
  if (!r.ok) return say(`Не получилось: ${r.text || 'телефон отказал'}.`);
  const d = r.data || {}, name = d.label || app.label || 'приложение';
  const q = query || dest;
  const phrase = args.phrase || (dest ? `до «${dest}»` : '');
  const inClip = `«${q}» — в буфере обмена телефона, вставь в поиск.`;
  let text;
  if (kind === 'food') text = !q ? `Открываю ${name}. Приятного аппетита!` : d.typed ? `Открыл ${name} и ищу «${q}». Выбирай!` : `Открыл ${name}. ${inClip}`;
  else if (kind === 'taxi') text = !dest ? `Открываю ${name}. Куда едем — выбери в приложении.`
    : d.how === 'link' ? `Открыл ${name}: маршрут ${phrase}. Проверь и закажи.`
      : d.typed ? `Открыл ${name} и вписал, куда ехать. Выбери адрес и закажи.` : `Открыл ${name}. Адрес скопировал — вставь в поле «Куда».`;
  else if (kind === 'maps' && args.route) text = d.how === 'link' ? `Строю маршрут ${phrase} в приложении ${name}.` : d.typed ? `Открыл ${name} и вписал адрес.` : `Открыл ${name}. Адрес в буфере обмена — вставь в поиск.`;
  else text = !q ? `Открываю ${name}.` : (d.how === 'link' || d.typed) ? `Ищу «${q}» в приложении ${name}.` : `Открыл ${name}. ${inClip}`;
  if (picked) text += ' Другое приложение можно выбрать в настройках.';
  return say(text, { emotion: 'happy' });
}

// ---------------------------------------------------------------- окно «Телефон»: экран телефона на компьютере, кнопки, приложения, дела
function openPhonePanel() {
  if (W.phone && !W.phone.isDestroyed()) { W.phone.show(); W.phone.focus(); return; }
  const wa = primary().workArea;
  const h = Math.min(880, wa.height - 40), w = Math.min(wa.width - 40, Math.round(h * 0.5) + 400);
  const win = W.phone = new BrowserWindow({
    width: w, height: h, minWidth: 640, minHeight: 560, frame: false, show: false, backgroundColor: cfg.theme().bg, title: 'Феликс — телефон',
    icon: path.join(__dirname, 'ui', 'assets', 'felix.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, spellcheck: false, backgroundThrottling: true }
  });
  win.setMenu(null);
  load(win, 'phone.html');
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { if (W.phone === win) delete W.phone; });
}

// ---------------------------------------------------------------- состояние Феликса
function setMinimized(m) {
  cfg.patch({ assistant: { minimized: m } });
  send(W.assistant, m ? 'minimize' : 'restore', {});
  refreshTray();
}

// полноэкранная игра или видео на основном мониторе — Феликс прячется, чтобы не мешать
function onForeground(e) {
  lastFg = e;
  const ours = e.pid === process.pid || Object.values(W).some(w => w && !w.isDestroyed() && w.webContents.getOSProcessId() === e.pid);
  if (ours) return;
  if (e.hwnd && !/^(Progman|WorkerW|Shell_TrayWnd)$/.test(e.cls || '')) lastExternalFg = e;
  const w = W.assistant;
  if (!w || w.isDestroyed() || idlePlaying) return;
  const onPrimary = () => { try { const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); return d.id === primary().id; } catch { return true; } };
  const full = e.fullscreen && !e.max && !/^(Progman|WorkerW|Shell_TrayWnd|Windows\.UI\.Core\.CoreWindow)$/.test(e.cls || '') && onPrimary();
  if (full && !hiddenByFullscreen) { hiddenByFullscreen = true; w.hide(); }
  else if (!full && hiddenByFullscreen) { hiddenByFullscreen = false; w.showInactive(); }
}

// если 10 минут никого нет — Феликс гуляет по рабочему столу, заглядывает в папки и засыпает
function startIdleWatch() {
  setInterval(async () => {
    const a = cfg.get().assistant;
    if (!W.assistant || W.assistant.isDestroyed() || !a.idle) return;
    const idle = powerMonitor.getSystemIdleTime();
    const warm = Date.now() - bootTime > 90000;
    if (!idlePlaying && warm && idle >= a.idleMinutes * 60 && !a.minimized && !hiddenByFullscreen) {
      idlePlaying = true; idleEndSent = 0;
      const d = primary(), b = d.workArea, scale = d.scaleFactor;
      const icons = (await core.safe('desktopIcons', {}, 10000)) || [];
      const desk = app.getPath('desktop');
      const items = icons.map(i => {
        let kids = [];
        try { const p = path.join(desk, i.name); if (fs.statSync(p).isDirectory()) kids = fs.readdirSync(p).slice(0, 5); } catch { }
        return { name: i.name, x: i.x / scale - b.x, y: i.y / scale - b.y, w: i.w / scale, h: i.h / scale, kids };
      }).filter(i => i.x >= 0 && i.y >= 0 && i.x < b.width && i.y < b.height);
      const home = W.assistant.getBounds();
      ignoreMouse(W.assistant, true, false);
      W.assistant.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
      send(W.assistant, 'idle-play', { icons: items, home: { x: home.x - b.x, y: home.y - b.y, width: home.width, height: home.height } });
    } else if (idlePlaying && idle < 2) {
      if (!idleEndSent) { idleEndSent = Date.now(); send(W.assistant, 'idle-end', { greet: brain.pick(brain.SAY.welcomeBack(nick())) }); }
      else if (Date.now() - idleEndSent > 10000) endIdle();
    }
  }, 1000);
}
function endIdle() {
  idlePlaying = false; idleEndSent = 0;
  if (W.assistant && !W.assistant.isDestroyed()) { W.assistant.setBounds(assistantRect()); ignoreMouse(W.assistant, true); }
}

// ---------------------------------------------------------------- настройки
function setAutostart(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: ['--autostart'] }); } catch (e) { log('autostart', e.message); }
}
async function applyConfig(patch) {
  const c = cfg.patch(patch || {});
  broadcast('config', { config: c, theme: themeVars() });
  if (patch.assistant) {
    if (patch.assistant.enabled === false && W.assistant) { W.assistant.close(); }
    if (patch.assistant.enabled === true && !W.assistant) createAssistant();
    if (patch.assistant.mic !== undefined || patch.assistant.micDevice !== undefined) startMic();
    if (patch.assistant.winY !== undefined) core.safe('hotkeys', { winY: !!c.assistant.winY });
    if (patch.assistant.scale !== undefined || patch.assistant.lift !== undefined || patch.assistant.side !== undefined) setTimeout(layoutAssistant, 30);
    refreshTray();
  }
  if (patch.autostart !== undefined && app.isPackaged) setAutostart(c.autostart);
  if (patch.phone && patch.phone.enabled !== undefined) { if (c.phone.enabled) { startLink(); phoneStatusChanged(); } else stopLink(); }
  return c;
}
function sttModel() { return path.join(HOME, 'stt', 'vosk-model-small-ru-0.22'); }
function startMic() {
  const a = cfg.get().assistant;
  if (a.enabled && a.mic && exists(sttModel())) core.safe('sttStart', { model: sttModel(), device: a.micDevice || 0 }, 60000);
  else core.safe('sttStop');
}

// ---------------------------------------------------------------- IPC
function wireIpc() {
  ipcMain.handle('config:get', () => ({ config: cfg.get(), theme: themeVars(), version: VERSION, keyHint: keyHint(), nick: nick() }));
  ipcMain.handle('config:set', (e, patch) => applyConfig(patch || {}));
  // ключ из аккаунта Anthropic самого пользователя: проверяем у Anthropic и только потом сохраняем
  ipcMain.handle('ai:setKey', async (e, k) => {
    k = String(k || '').trim();
    if (!k) { setKey(''); return { ok: true, hint: keyHint() }; }
    const chk = await llm.checkKey(k);
    if (!chk.ok && chk.code !== 'network') return { ok: false, error: chk.error, hint: keyHint() };
    setKey(k);
    if (cfg.get().ai.provider === 'off') applyConfig({ ai: { provider: 'auto' } });
    return { ok: chk.ok, error: chk.ok ? '' : chk.error + ' Ключ сохранён, проверю позже.', hint: keyHint() };
  });
  ipcMain.handle('ai:status', async () => {
    const src = await llm.pick();
    return { source: src, ollama: await llm.ollamaUp(), key: !!getKey() };
  });
  ipcMain.handle('ai:test', async () => {
    try { const r = await llm.ask('Скажи одной короткой фразой, что ты на связи.'); return { ok: true, text: r.text, source: r.source }; }
    catch (e) { return { ok: false, text: explain(e) }; }
  });
  ipcMain.handle('voices', () => tts.voices());
  ipcMain.handle('voices:folder', () => shell.openPath(tts.customDir()));
  ipcMain.handle('voice:test', async (e, text) => { await say(text || 'Привет! Так звучит мой голос.', { anim: 'wave', emotion: 'happy' }); return true; });
  ipcMain.handle('mics', () => core.safe('sttStatus'));
  // телефон
  ipcMain.handle('phone:status', () => phoneStatus());
  ipcMain.handle('phone:newcode', () => { cfg.patch({ phone: { code: newCode() } }); if (link && link.sock) link.sock.destroy(); phoneStatusChanged(); return phoneStatus(); });
  ipcMain.handle('phone:cmd', (e, cmd, args) => (link && link.connected ? link.request(String(cmd), args || {}, cmd === 'service' ? 30000 : 10000) : null));
  // управление телефоном с компьютера: список приложений (с иконками), каталог дел, окно «Телефон», дело кнопкой
  ipcMain.handle('phone:apps', (e, force) => phoneAppList(!!force));
  ipcMain.handle('phone:catalog', () => Object.fromEntries(phoneapps.KINDS.map(k => { const c = phoneapps.CATS[k]; return [k, { name: c.name, icon: c.icon, apps: c.apps.map(([pkg, name]) => ({ pkg, name })) }]; })));
  ipcMain.handle('phone:suggest', async () => { const list = (await phoneAppList()) || []; return Object.fromEntries(phoneapps.KINDS.map(k => [k, phoneapps.suggest(k, list)])); });
  ipcMain.handle('phone:panel', () => openPhonePanel());
  ipcMain.handle('phone:service', (e, kind, args) => {
    if (!phoneapps.CATS[kind]) return null;
    args = args || {};
    if (kind === 'taxi' || (kind === 'maps' && args.route)) {
      const pl = placeDest(brain.parse('такси ' + (args.to || '')).to || '');
      if (pl.missing) { openSettings('phone'); return say(`Впиши адрес «${pl.missing}» в настройках, раздел «Телефон».`); }
      return phoneService(kind, { dest: pl.dest, phrase: pl.phrase, route: !!args.route });
    }
    return phoneService(kind, { query: String(args.query || '') });
  });
  ipcMain.handle('phone:firewall', () => allowFirewall());
  ipcMain.handle('phone:fwstatus', () => firewallAllowed());
  ipcMain.handle('geocode', (e, q) => geocode(q));
  ipcMain.handle('open', (e, what, arg) => {
    if (what === 'settings') return openSettings(arg);
    if (what === 'url' && /^https:\/\//.test(String(arg))) return shell.openExternal(arg);
    if (what === 'data') return shell.openPath(DATA);
    if (what === 'notes') { if (!exists(notesFile())) try { fs.writeFileSync(notesFile(), '', 'utf8'); } catch { } return shell.openPath(notesFile()); }
  });
  ipcMain.handle('mouse:ignore', (e, ignore) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !(idlePlaying && w === W.assistant)) ignoreMouse(w, ignore); });
  ipcMain.handle('win:close', e => { const w = BrowserWindow.fromWebContents(e.sender); w && w.close(); });
  ipcMain.handle('win:min', e => { const w = BrowserWindow.fromWebContents(e.sender); w && w.minimize(); });
  ipcMain.handle('popup', (e, x, y) => { const w = BrowserWindow.fromWebContents(e.sender); trayMenu().popup({ window: w, x: Math.round(x), y: Math.round(y) }); });
  ipcMain.handle('sound', (e, name) => fileUrl(path.join(HOME, 'sounds', String(name).replace(/[^\w-]/g, '') + '.wav')));
  ipcMain.handle('model', () => fileUrl(path.join(HOME, 'models', 'felix.vrm')));
  ipcMain.handle('felix:clicked', () => callFelix());
  ipcMain.handle('felix:spoken', () => onSpoken());
  ipcMain.handle('felix:minimize', (e, m) => setMinimized(m));
  ipcMain.handle('felix:idle-done', () => endIdle());
  ipcMain.handle('felix:say', (e, text, opts) => say(text, opts));
  ipcMain.handle('felix:command', (e, text) => { const w = brain.wake(text); return handle(brain.parse(w.woke ? w.rest : text), text); });
  ipcMain.handle('welcome:done', (e, o) => {
    o = o || {};
    applyConfig({
      firstRun: false,
      user: { nick: String(o.nick || '').trim().slice(0, 24) },
      weather: o.city ? { city: o.city.name, lat: o.city.lat, lon: o.city.lon } : {},
      assistant: { mic: o.mic !== false },
      ai: o.ai ? { provider: o.ai } : {},
      autostart: o.autostart !== false
    });
    if (W.welcome) W.welcome.close();
    if (!W.assistant) createAssistant();
    setTimeout(() => say(`Приятно познакомиться${nick() ? ', ' + nick() : ''}! Зови меня «Феликс» или жми Win и Y. Чтобы узнать, что я умею, спроси: что ты умеешь?`, { anim: 'wave', emotion: 'happy' }), 2500);
    return true;
  });
}

// ---------------------------------------------------------------- запуск
app.on('web-contents-created', (e, wc) => {
  wc.on('console-message', (ev, level, message, line, source) => { if (level >= 2 && !/Electron Security Warning/.test(message)) log('renderer', level, String(source).split('/').pop() + ':' + line, message); });
  wc.on('render-process-gone', (ev, d) => log('renderer gone', d.reason));
  // ссылки из окон настроек — только в браузере пользователя, и только https
  wc.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (ev, url) => { if (!url.startsWith('felix://')) ev.preventDefault(); });
});
app.on('child-process-gone', (e, d) => log('child gone', d.type, d.reason, d.exitCode ?? ''));

app.on('second-instance', (e, argv) => {
  const cmdArg = argv.find(a => a.startsWith('--cmd='));
  if (cmdArg) { const text = cmdArg.slice(6); log('cmd', text); handle(brain.parse(text), text); }
  else if (argv.includes('--quit')) app.quit();
  else if (argv.some(a => a.startsWith('--settings'))) openSettings();
  else if (cfg.get().firstRun) openWelcome();
  else { if (cfg.get().assistant.minimized) setMinimized(false); callFelix(); }
});

protocol.registerSchemesAsPrivileged([{ scheme: 'felix', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';
  protocol.handle('felix', req => {
    const u = new URL(req.url);
    let p;
    if (u.host === 'app') p = path.join(__dirname, decodeURIComponent(u.pathname));
    else if (u.host === 'file') p = decodeURIComponent(u.pathname.slice(1));
    else return new Response('not found', { status: 404 });
    // окна получают только файлы программы, звуки речи, модель и звуки интерфейса
    const allowed = [__dirname, HOME, tts ? tts.dir : os.tmpdir()].some(root => path.resolve(p).toLowerCase().startsWith(path.resolve(root).toLowerCase()));
    if (!allowed) return new Response('forbidden', { status: 403 });
    // без кэша: после обновления программы окна должны получить новые файлы
    return net.fetch(pathToFileURL(p).toString()).then(r => new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' } }));
  });
  try { await session.defaultSession.clearCache(); } catch { }
  log('start', VERSION, DEV ? 'dev' : 'packaged', 'home=' + HOME, 'firstRun=' + cfg.get().firstRun, 'mic=' + cfg.get().assistant.mic, 'data=' + DATA, 'cfgErr=' + (cfg.loadError || '-'));

  core = new Core(path.join(HOME, 'native', 'FelixCore.exe'));
  core.start();
  input = new Input(path.join(HOME, 'native', 'FelixInput.exe'), log);
  input.start();
  tts = new Tts(HOME, DATA, core);
  llm = new Llm({ getConfig: () => cfg.get().ai, getKey, log });
  wireIpc();
  createTray();

  core.on('ready', async () => {
    const pids = [process.pid, ...Object.values(W).filter(w => w && !w.isDestroyed()).map(w => w.webContents.getOSProcessId())];
    await core.safe('exclude', { pids });
    core.safe('hotkeys', { winY: !!cfg.get().assistant.winY });
    startMic();
  });
  core.on('fg', onForeground);
  core.on('stt', onStt);
  core.on('level', e => send(W.assistant, 'level', e));
  core.on('hotkey', e => { if (e.name === 'felix') callFelix(); });

  if (cfg.get().firstRun) openWelcome();
  else createAssistant();
  startLink();
  if (app.isPackaged && !cfg.get().firstRun) setAutostart(cfg.get().autostart);
  setTimeout(loadApps, 3000);
  setInterval(mouseTick, 40);
  setInterval(() => { const w = W.assistant; if (w && !w.isDestroyed() && w.isVisible() && !w.isAlwaysOnTop()) w.setAlwaysOnTop(true, 'floating'); }, 2000);
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => setTimeout(() => { layoutAssistant(); startMic(); }, 1500));
  screen.on('display-metrics-changed', () => setTimeout(layoutAssistant, 300));
  screen.on('display-added', () => setTimeout(layoutAssistant, 300));
  screen.on('display-removed', () => setTimeout(layoutAssistant, 300));
  startIdleWatch();

  if (!cfg.get().firstRun) setTimeout(() => {
    if (!cfg.get().assistant.minimized && !ARGS.includes('--silent')) say(brain.pick(brain.SAY.greetBoot(nick())), { anim: 'wave', emotion: 'happy' });
  }, 5000);
});

app.on('window-all-closed', e => e.preventDefault?.());
app.on('before-quit', () => {
  try { cfg.flush(); } catch { }
  try { input && input.stop(); } catch { }
  try { link && link.stop(); } catch { }
  try { core && core.stop(); tts && tts.stop(); } catch { }
  try { tray && tray.destroy(); } catch { }
});
