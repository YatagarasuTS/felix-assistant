// Покадровый рендер рекламных роликов «Феликса»: страница-сцена → кадры BGRA → ffmpeg (H.264 + AAC)
//   electron promo --video out.mp4                                         — ролик 16:9 (promo.html + audio.wav)
//   electron promo --page vert.html --audio phone_audio.wav --video out.mp4 — вертикальный 9:16 (размер берётся у сцены)
//   electron promo [--page …] --stills 1,7.5,30 dir                         — отдельные кадры PNG для проверки
// Windows не даёт окну быть выше экрана, поэтому высокий кадр снимается полосами по 960 px и склеивается.
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const PROMO = __dirname, ROOT = path.resolve(__dirname, '..'), APP = path.join(ROOT, 'app');
const FFMPEG = process.env.FFMPEG || (fs.existsSync('D:\\YatagarasuOs\\deps\\ffmpeg\\ffmpeg.exe') ? 'D:\\YatagarasuOs\\deps\\ffmpeg\\ffmpeg.exe' : 'ffmpeg');
const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const PAGE = arg('--page', 'promo.html'), AUDIO = arg('--audio', 'audio.wav');
const STRIP = 960;
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setPath('userData', path.join(app.getPath('temp'), 'felix-promo'));
protocol.registerSchemesAsPrivileged([{ scheme: 'felix', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

app.whenReady().then(async () => {
  // felix://app/… — программа, felix://promo/… — сцены ролика, felix://root/… — папка проекта, felix://file/E:/… — любой файл
  protocol.handle('felix', req => {
    const u = new URL(req.url), p = decodeURIComponent(u.pathname);
    const file = u.host === 'app' ? path.join(APP, p) : u.host === 'promo' ? path.join(PROMO, p) : u.host === 'root' ? path.join(ROOT, p) : p.slice(1);
    return net.fetch(pathToFileURL(file).toString()).then(r => new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }));
  });
  const log = s => fs.appendFileSync(path.join(PROMO, 'render.log'), new Date().toISOString() + ' ' + s + '\n');
  fs.writeFileSync(path.join(PROMO, 'render.log'), '');
  // размер кадра: у вертикальной сцены — 1080×1920, у старой — 1920×1080
  const [W, H] = (arg('--size', /vert|wardrobe/.test(PAGE) ? '1080x1920' : '1920x1080')).split('x').map(Number);
  const strips = Math.ceil(H / STRIP), SH = Math.ceil(H / strips);
  const win = new BrowserWindow({ width: W, height: SH, show: false, useContentSize: true, frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: false } });
  win.webContents.setFrameRate(30);
  const logs = [];
  win.webContents.on('console-message', (e, lvl, msg, line, src) => { logs.push(lvl + ' ' + msg); try { fs.appendFileSync(path.join(PROMO, 'console.log'), lvl + ' ' + String(src).split('/').pop() + ':' + line + ' ' + msg + '\n'); } catch { } });
  await win.loadURL('felix://promo/' + PAGE).catch(e => log('load ' + e.message));
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) { ok = await win.webContents.executeJavaScript("typeof window.renderFrame === 'function'"); if (!ok) await new Promise(r => setTimeout(r, 250)); }
  if (!ok) { log('scene not ready\n' + logs.join('\n')); app.exit(2); return; }
  process.on('unhandledRejection', e => { log('error ' + (e && e.stack || e)); app.exit(3); });
  const DUR = await win.webContents.executeJavaScript('window.promoDur');
  const FPS = 30;
  const js = s => win.webContents.executeJavaScript(s);
  // дождаться, пока изменения нарисуются (два кадра анимации), иначе capturePage может отдать прошлый кадр
  const paint = () => js('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
  // один кадр целиком: сцена на момент t, затем полосы сверху вниз (BGRA строками — просто склеиваются)
  async function frame(t) {
    await js(`setStrip && setStrip(0), renderFrame(${t})`);
    const parts = [];
    for (let s = 0; s < strips; s++) {
      if (strips > 1) { if (s) await js(`setStrip(${s * SH})`); await paint(); }
      let img = await win.webContents.capturePage();
      const sz = img.getSize();
      if (sz.width !== W || sz.height !== SH) img = img.resize({ width: W, height: SH });
      parts.push(img.toBitmap());
    }
    return Buffer.concat(parts).subarray(0, W * H * 4);
  }
  await js('window.setStrip = window.setStrip || (() => true); 1');

  const si = args.indexOf('--stills');
  if (si >= 0) {
    const { nativeImage } = require('electron');
    const times = args[si + 1].split(',').map(Number), dir = args[si + 2];
    fs.mkdirSync(dir, { recursive: true });
    for (const t of times) { await frame(t); const buf = await frame(t); fs.writeFileSync(path.join(dir, `t${String(t).replace('.', '_')}.png`), nativeImage.createFromBitmap(buf, { width: W, height: H }).toPNG()); log('still ' + t); }
    log(logs.join('\n'));
    app.exit(0); return;
  }
  const out = arg('--video');
  const ff = spawn(FFMPEG, ['-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-i', path.join(PROMO, AUDIO),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'ignore'] });
  const total = Math.round(FPS * DUR);
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    const buf = await frame(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) log(`frame ${i}/${total} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  ff.on('close', code => { log('ffmpeg done ' + code + '\n' + logs.join('\n')); app.exit(code); });
});
