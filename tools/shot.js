// Проверочные снимки окон Феликса без запуска самого ассистента: окна рисуются вне экрана (offscreen)
// и сохраняются в PNG. Запуск: electron.exe tools\shot.js <папка> [страница?параметры ширина высота задержка_мс] …
//   SHOT_PHONE_ON=1        — телефон «подключён» («Феликс Link» 1.1, список приложений, экран)
//   SHOT_PHONE_SCREEN=файл — картинка «экрана телефона» для окна «Телефон» (PNG/JPEG)
const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..');
const { Config, THEMES } = require(path.join(ROOT, 'app', 'lib', 'config.js'));
const phoneapps = require(path.join(ROOT, 'app', 'lib', 'phoneapps.js'));

const APP = path.join(ROOT, 'app'), STAGE = path.join(ROOT, 'stage');
const OUT = process.argv[2] || path.join(ROOT, 'test', 'shots');
const JOBS = [];
for (let i = 3; i + 3 < process.argv.length + 1; i += 4) JOBS.push({ page: process.argv[i], w: +process.argv[i + 1], h: +process.argv[i + 2], delay: +process.argv[i + 3] });
fs.mkdirSync(OUT, { recursive: true });
const tmpData = path.join(app.getPath('temp'), 'felix-shot');
const cfg = new Config(tmpData);
cfg.data.firstRun = false;
const fileUrl = p => 'felix://file/' + encodeURIComponent(p.replace(/\\/g, '/'));

// «телефон» для окна «Телефон» и настроек
const PHONE_ON = !!process.env.SHOT_PHONE_ON;
const SCREEN = process.env.SHOT_PHONE_SCREEN && fs.existsSync(process.env.SHOT_PHONE_SCREEN) ? fs.readFileSync(process.env.SHOT_PHONE_SCREEN).toString('base64') : null;
const FAKE_APPS = [['ru.foodfox.client', 'Яндекс Еда'], ['ru.sbcs.store', 'Самокат'], ['ru.yandex.taxi', 'Яндекс Go'], ['ru.yandex.yandexmaps', 'Яндекс Карты'],
  ['ru.ozon.app.android', 'Ozon'], ['ru.yandex.music', 'Яндекс Музыка'], ['org.telegram.messenger', 'Telegram'], ['com.android.camera', 'Камера'],
  ['com.android.chrome', 'Chrome'], ['com.google.android.gm', 'Почта'], ['com.android.settings', 'Настройки'], ['com.android.calendar', 'Календарь']].map(([pkg, label]) => ({ pkg, label }));
if (PHONE_ON) { cfg.data.phone.enabled = true; cfg.data.phone.services = { food: { pkg: 'ru.sbcs.store', label: 'Самокат' }, taxi: { pkg: 'ru.yandex.taxi', label: 'Яндекс Go' } }; cfg.data.phone.places = { home: 'Казань, ул. Баумана, 10', work: '' }; }

// SHOT_HALF=1 — окно вдвое меньше при плотности 2×: так снимаются страницы выше экрана (Windows не даёт окну быть выше него)
const HALF = !!process.env.SHOT_HALF;
app.setPath('userData', path.join(app.getPath('temp'), 'felix-shot-ud'));   // своя папка: Chromium запоминает масштаб страниц
if (HALF) app.commandLine.appendSwitch('force-device-scale-factor', '2');
protocol.registerSchemesAsPrivileged([{ scheme: 'felix', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.whenReady().then(async () => {
  protocol.handle('felix', req => {
    const u = new URL(req.url);
    const p = u.host === 'app' ? path.join(APP, decodeURIComponent(u.pathname)) : decodeURIComponent(u.pathname.slice(1));
    return net.fetch(pathToFileURL(p).toString());
  });
  const theme = () => ({ ...cfg.theme(), presets: Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, { name: v.name, accent: v.accent, bg: v.bg, dark: v.dark }])) });
  ipcMain.handle('config:get', () => ({ config: cfg.get(), theme: theme(), version: require(path.join(APP, 'package.json')).version, keyHint: '', nick: '' }));
  ipcMain.handle('model', () => fileUrl(path.join(STAGE, 'models', 'felix.vrm')));
  ipcMain.handle('sound', () => null);
  ipcMain.handle('voices', () => [{ id: 'piper', name: 'Дмитрий (по умолчанию)' }, { id: 'sapi', name: 'Голос Windows' }]);
  ipcMain.handle('geocode', () => []);
  ipcMain.handle('ai:status', () => ({ source: null, ollama: false, key: false }));
  ipcMain.handle('mics', () => ({ devices: ['Микрофон (по умолчанию)'] }));
  ipcMain.handle('phone:status', () => ({
    enabled: cfg.get().phone.enabled, connected: PHONE_ON, info: PHONE_ON ? { device: 'Pixel 8', model: 'Pixel 8', android: '15', app: '1.1' } : null,
    battery: PHONE_ON ? { level: 82, charging: false } : null, code: 'K7QM2XWP', addresses: [{ name: 'Ethernet', address: '192.168.0.10' }], apkPort: 47892, apk: true, wol: null, control: PHONE_ON
  }));
  ipcMain.handle('phone:fwstatus', () => false);
  ipcMain.handle('wardrobe:catalog', () => JSON.parse(fs.readFileSync(path.join(APP, 'ui', 'wardrobe-catalog.json'), 'utf8')));
  ipcMain.handle('wardrobe:set', () => null);
  ipcMain.handle('phone:catalog',() => Object.fromEntries(phoneapps.KINDS.map(k => { const c = phoneapps.CATS[k]; return [k, { name: c.name, icon: c.icon, apps: [] }]; })));
  ipcMain.handle('phone:apps', () => (PHONE_ON ? FAKE_APPS : null));
  ipcMain.handle('phone:suggest', () => Object.fromEntries(phoneapps.KINDS.map(k => [k, phoneapps.suggest(k, FAKE_APPS)])));
  ipcMain.handle('phone:cmd', (e, c) => {
    if (c === 'screen') return { ok: true, data: { acc: true, canShot: !!SCREEN, android: 35, w: 1080, h: 2400 } };
    if (c === 'shot' && SCREEN) return new Promise(r => setTimeout(() => r({ ok: true, data: { jpeg: SCREEN, w: 540, h: 1200 } }), 200));
    return { ok: true };
  });
  for (const ch of ['felix:spoken', 'mouse:ignore', 'felix:say', 'popup', 'win:close', 'win:min', 'phone:panel', 'phone:service', 'open']) ipcMain.handle(ch, () => null);
  for (const j of JOBS) try { await shoot(j); } catch (e) { fs.appendFileSync(path.join(OUT, 'errors.txt'), j.page + ': ' + (e && e.stack || e) + '\n'); }
  app.quit();
});

async function shoot(j) {
  {
    const transparent = /assistant/.test(j.page);
    const k = HALF ? 2 : 1;
    const w = new BrowserWindow({ width: Math.round(j.w / k), height: Math.round(j.h / k), useContentSize: true, show: false, frame: false, transparent, backgroundColor: transparent ? '#00000000' : '#071113',
      webPreferences: { offscreen: true, preload: path.join(APP, 'preload.js'), contextIsolation: true, zoomFactor: 1 / k } });
    w.webContents.setFrameRate(30);
    const logs = [];
    w.webContents.on('console-message', (e, level, msg) => logs.push(level + ' ' + msg));
    // «/promo/phone_screen.html» — страница из папки проекта (адрес felix://… в командной строке Electron не пропускает)
    // «settings.html#phone» — открыть раздел настроек (сообщением goto, как это делает сам Феликс)
    const [page, section] = j.page.split('#');
    await w.loadURL(page.startsWith('/') ? 'felix://file/' + path.join(ROOT, page).replace(/\\/g, '/') : 'felix://app/ui/' + page);
    w.webContents.setZoomFactor(1 / k);
    if (section) setTimeout(() => w.webContents.send('goto', section), 400);
    if (/^call/.test(j.page)) setTimeout(() => w.webContents.send('call', { state: 'ringing', name: 'Мама', number: '+7 900 000-00-00', incoming: true }), 600);
    await new Promise(r => setTimeout(r, j.delay));
    const img = await w.webContents.capturePage();
    const name = j.page.replace(/^.*\//, '').replace(/[?=&#]/g, '_').replace(/\.html/, '') + '.png';
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    fs.writeFileSync(path.join(OUT, name + '.log'), logs.join('\n'));
    w.destroy();
  }
}
