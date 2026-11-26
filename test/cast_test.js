// Эмулятор «Феликс Link» 1.2: экран телефона видеопотоком H.264 (как от аппаратного кодера телефона) и касания «вживую».
// Поток — заранее снятый ffmpeg файл Annex B (test\cast\stream.h264, 60 к/с, baseline), шлётся кадрами по 47893
// тем же шифром, что и у телефона. Мышь в окне «Телефон» двигает проверка через тестовый порт Феликса (FELIX_TEST).
// Запуск: Феликс с FELIX_DATA=test\data_phone и FELIX_TEST=<пароль>, затем
//   electron (ELECTRON_RUN_AS_NODE=1) test\cast_test.js TESTCODE <пароль> <файл-отчёт>
const net = require('net'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const [CODE, HOOK, OUT] = process.argv.slice(2);
const lines = [];
const out = s => { lines.push(new Date().toISOString().slice(11, 23) + ' ' + s); fs.writeFileSync(OUT, lines.join('\n') + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = c => crypto.pbkdf2Sync(String(c).toUpperCase().replace(/[^A-Z0-9]/g, ''), 'FelixLink1', 100000, 32, 'sha256');
const enc = (key, o) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(o)), c.final()]); return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64'); };
const dec = (key, line) => { try { const a = Buffer.from(line, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, a.subarray(0, 12)); d.setAuthTag(a.subarray(a.length - 16)); return JSON.parse(Buffer.concat([d.update(a.subarray(12, a.length - 16)), d.final()]).toString()); } catch { return null; } };
const KEY = keyOf(CODE);

// ---- поток: Annex B → NAL → кадры (AUD разделяет кадры; SPS/PPS — отдельный «конфиг», как у MediaCodec)
const H264 = fs.readFileSync(path.join(__dirname, 'cast', 'stream.h264'));
function nals(b) {
  const starts = [];
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 0 && b[i + 1] === 0 && (b[i + 2] === 1 || (b[i + 2] === 0 && b[i + 3] === 1))) { starts.push(i); i += 2; }
  return starts.map((s, k) => b.subarray(s, k + 1 < starts.length ? starts[k + 1] : b.length));
}
const nalType = n => n[n[2] === 1 ? 3 : 4] & 0x1f;
const AUs = [];
let cfg = [], cur = null;
for (const n of nals(H264)) {
  const t = nalType(n);
  if (t === 9) { if (cur && cur.length) AUs.push(cur); cur = []; continue; }
  if (t === 7 || t === 8) { if (!AUs.length) cfg.push(n); continue; }
  if (t === 6) continue;                                  // SEI выкидываем
  (cur = cur || []).push(n);
}
if (cur && cur.length) AUs.push(cur);
const CFG = Buffer.concat(cfg);
const FRAMES = AUs.map(a => ({ key: a.some(n => nalType(n) === 5), data: Buffer.concat(a) }));

function frame(sock, type, seq, pts, data) {
  const plain = Buffer.alloc(13 + data.length);
  plain[0] = type; plain.writeUInt32BE(seq >>> 0, 1); plain.writeBigUInt64BE(BigInt(pts), 5); data.copy(plain, 13);
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  const len = Buffer.alloc(4); len.writeUInt32BE(12 + ct.length);
  return sock.write(Buffer.concat([len, iv, ct]));
}

let cast = null;
function startCast(m) {
  stopCast();
  const s = net.connect(m.port, '127.0.0.1');
  const st = cast = { s, alive: true, sent: 0 };
  s.setNoDelay(true);
  s.on('connect', async () => {
    let seq = 0;
    frame(s, 0, ++seq, 0, Buffer.from(JSON.stringify({ token: m.token, w: 576, h: 1248, sw: 1080, sh: 2340, fps: 60 })));
    frame(s, 1, ++seq, 0, CFG);
    const t0 = Date.now();
    for (let i = 0; st.alive; i++) {
      const f = FRAMES[i % FRAMES.length];
      frame(s, f.key ? 2 : 3, ++seq, Math.round(i * 1e6 / 60), f.data); st.sent++;
      const wait = t0 + (i + 1) * 1000 / 60 - Date.now();
      if (wait > 0) await sleep(wait);
    }
  });
  s.on('error', e => out('  video error ' + e.message));
  s.on('close', () => { st.alive = false; });
}
function stopCast() { if (cast) { cast.alive = false; cast.s.destroy(); cast = null; } }

function phone() {
  return new Promise(res => {
    const s = net.connect(47890, '127.0.0.1');
    let buf = '', n = 0, nonce = null, ready = false;
    const api = { s, cmds: [], says: [], touches: [], send: o => s.write(enc(KEY, { ...o, n: ++n }) + '\n') };
    const reply = (m, ok, text, data) => api.send({ t: 'res', id: m.id, ok, text: text || '', data: data === undefined ? null : data });
    s.on('data', ch => {
      buf += ch; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!nonce) { if (line.startsWith('FELIXLINK1 ')) { nonce = line.slice(11); api.send({ t: 'hello', nonce, device: 'Эмулятор', model: 'Test Phone', android: '14', app: '1.2' }); } continue; }
        const m = dec(KEY, line);
        if (!m) continue;
        if (m.t === 'welcome') { ready = true; res(api); continue; }
        if (m.t === 'say') { api.says.push(m.text); out('  <- say «' + m.text + '»'); continue; }
        if (m.t === 'touch') { api.touches.push({ a: m.a, x: m.x, y: m.y, at: Date.now() }); continue; }
        if (m.t !== 'cmd') continue;
        api.cmds.push(m);
        if (m.cmd !== 'shot') out('  <- cmd ' + m.cmd + ' ' + JSON.stringify({ ...m, t: undefined, n: undefined, id: undefined, token: m.token ? '…' : undefined }));
        switch (m.cmd) {
          case 'screen': reply(m, true, '', { acc: true, canShot: true, cast: true, liveTouch: true, android: 34, w: 1080, h: 2340 }); break;
          case 'cast':
            if (m.on) { reply(m, true, 'streaming', { state: 'streaming' }); setTimeout(() => startCast(m), 150); }
            else { stopCast(); reply(m, true); }
            break;
          default: reply(m, true);
        }
      }
    });
    s.on('error', e => res({ error: e.message }));
    s.on('close', () => { if (!ready) res({ closed: true }); });
  });
}

// тестовый порт Феликса
function hook() {
  return new Promise((res, rej) => {
    const s = net.connect(47898, '127.0.0.1');
    let buf = '', id = 0; const wait = {};
    s.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); (wait[m.id] || (() => { }))(m); delete wait[m.id]; } });
    s.on('connect', () => res(o => new Promise(r => { const k = ++id; wait[k] = m => r(m.error ? { error: m.error } : m.v); s.write(JSON.stringify({ ...o, key: HOOK, id: k }) + '\n'); })));
    s.on('error', rej);
  });
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, what) => { cond ? pass++ : fail++; out((cond ? 'PASS ' : 'FAIL ') + what); };
  out(`поток: ${FRAMES.length} кадров, ключевых ${FRAMES.filter(f => f.key).length}, конфиг ${CFG.length} байт`);
  const p = await phone();
  ok(!p.error && !p.closed, 'сопряжение с app=1.2');
  if (p.error || p.closed) { out(`ИТОГ: ${pass} ок, ${fail} ошибок`); process.exit(1); }
  const H = await hook();
  const waitCmd = async (pred, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const i = p.cmds.findIndex(pred); if (i >= 0) return p.cmds.splice(i, 1)[0]; await sleep(100); } return null; };
  const st = () => H({ c: 'js', win: 'phone', expr: 'window.__phoneState && window.__phoneState()' });

  // 1. окно «Телефон» → экран → трансляция
  p.send({ t: 'felix', text: 'покажи экран телефона' });
  ok(!!await waitCmd(x => x.cmd === 'screen', 12000), 'окно «Телефон» спросило экран');
  const c = await waitCmd(x => x.cmd === 'cast' && x.on, 6000);
  ok(c && c.port === 47893 && /^[0-9a-f]{32}$/.test(c.token || '') && c.fps === 60, 'окно включило трансляцию (порт 47893, разовый пропуск, 60 к/с)');
  await sleep(4500);
  let s = await st();
  out('  состояние окна: ' + JSON.stringify(s));
  ok(s && s.mode === 'video' && s.castState === 'live' && s.w === 576 && s.h === 1248, 'видео идёт: кадр 576×1248 на холсте');
  ok(s && s.fps >= 50, `плавно: ${s && s.fps} к/с (отправлено ${cast && cast.sent})`);
  ok(s && /avc1\.42/.test(s.codec), 'кодек из SPS: ' + (s && s.codec));
  ok(p.cmds.filter(x => x.cmd === 'shot').length === 0, 'снимки экрана не тянет (только видео)');
  await H({ c: 'shot', win: 'phone', file: path.join(path.dirname(OUT), 'cast_panel.png') });

  // 2. касание «вживую»: свайп снизу вверх — палец опускается сразу и ведётся за мышью
  p.touches.length = 0;
  const pathUp = Array.from({ length: 21 }, (_, i) => [0.5, 0.8 - i * 0.03]);
  const t0 = Date.now();
  await H({ c: 'drag', win: 'phone', sel: '#video', path: pathUp, ms: 16 });
  await sleep(500);
  const T = p.touches.slice();
  const downs = T.filter(t => t.a === 'down'), moves = T.filter(t => t.a === 'move'), ups = T.filter(t => t.a === 'up');
  out('  касания: ' + T.map(t => t.a[0] + t.y.toFixed(2)).join(' '));
  ok(downs.length === 1 && Math.abs(downs[0].y - 0.8) < 0.03 && Math.abs(downs[0].x - 0.5) < 0.03, 'палец опустился там, где нажата мышь');
  ok(downs.length && downs[0].at - t0 < 200, `сразу (${downs.length && downs[0].at - t0} мс), а не после отпускания`);
  ok(moves.length >= 8, `ведётся за мышью: ${moves.length} движений`);
  ok(moves.every((m, i) => i === 0 || m.y <= moves[i - 1].y + 1e-6), 'движения по порядку снизу вверх');
  ok(ups.length === 1 && Math.abs(ups[0].y - 0.2) < 0.03, 'палец поднят в конце');
  ok(p.cmds.filter(x => x.cmd === 'swipe' || x.cmd === 'tap').length === 0, 'без старых tap/swipe');

  // 3. короткое нажатие — тоже вживую (down + up в одной точке)
  p.touches.length = 0;
  await H({ c: 'drag', win: 'phone', sel: '#video', path: [[0.3, 0.4], [0.3, 0.4]], ms: 60 });
  await sleep(400);
  ok(p.touches.length >= 2 && p.touches[0].a === 'down' && p.touches[p.touches.length - 1].a === 'up' && Math.abs(p.touches[0].x - 0.3) < 0.03, 'клик → касание в точке (0.3, 0.4)');

  // 4. окно свернули/закрыли — трансляция выключается
  await H({ c: 'js', win: 'phone', expr: "document.querySelector('#bclose').click(), 1" });
  ok(!!await waitCmd(x => x.cmd === 'cast' && x.on === false, 5000), 'окно закрыто → трансляция выключена на телефоне');

  // 5. журнал: окно пишет частоту кадров
  const logf = path.join(__dirname, 'data_phone', 'felix.log');
  const ll = fs.readFileSync(logf, 'utf8').split('\n').filter(l => /phone panel video/.test(l)).slice(-1)[0] || '';
  ok(/\d+ fps 576x1248/.test(ll), 'в журнале: ' + ll.trim().slice(-60));

  out(`ИТОГ: ${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out('CRASH ' + e.stack); process.exit(2); });
