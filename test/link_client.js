// Эмулятор «Феликс Link»: поиск по UDP, сопряжение, команды, звонок, неверный код, скачивание APK.
// Запуск: electron (ELECTRON_RUN_AS_NODE=1) link_client.js <код> <файл-отчёт> [apk-путь]
const net = require('net'), dgram = require('dgram'), http = require('http'), crypto = require('crypto'), fs = require('fs');
const [CODE, OUT, APK] = process.argv.slice(2);
const lines = [];
const out = s => { lines.push(new Date().toISOString().slice(11, 23) + ' ' + s); fs.writeFileSync(OUT, lines.join('\n') + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '');
const keyOf = c => crypto.pbkdf2Sync(norm(c), 'FelixLink1', 100000, 32, 'sha256');
const enc = (key, o) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(o)), c.final()]); return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64'); };
const dec = (key, line) => { try { const a = Buffer.from(line, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, a.subarray(0, 12)); d.setAuthTag(a.subarray(a.length - 16)); return JSON.parse(Buffer.concat([d.update(a.subarray(12, a.length - 16)), d.final()]).toString()); } catch { return null; } };

function discover() {
  return new Promise(res => {
    const u = dgram.createSocket('udp4');
    const t = setTimeout(() => { u.close(); res(null); }, 3000);
    u.on('message', m => { clearTimeout(t); u.close(); res(String(m)); });
    u.bind(0, () => { u.setBroadcast(true); u.send('FELIX?', 47891, '127.0.0.1'); });
  });
}

function connect(code, { onMsg } = {}) {
  return new Promise(res => {
    const key = keyOf(code), s = net.connect(47890, '127.0.0.1');
    let buf = '', n = 0, nonce = null, welcome = null;
    const api = { s, send: o => s.write(enc(key, { ...o, n: ++n }) + '\n'), msgs: [] };
    s.on('data', ch => {
      buf += ch; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!nonce) {
          if (line.startsWith('FELIXLINK1 ')) { nonce = line.slice(11); api.send({ t: 'hello', nonce, device: 'Эмулятор', model: 'Test Phone', android: '14' }); }
          continue;
        }
        if (line === 'BADCODE') { res({ bad: true }); continue; }
        const m = dec(key, line);
        if (!m) { out('  ! не расшифровал строку'); continue; }
        api.msgs.push(m);
        if (m.t === 'welcome' && !welcome) { welcome = m; res({ ...api, welcome }); }
        onMsg && onMsg(m, api);
      }
    });
    s.on('error', e => res({ error: e.message }));
    s.on('close', () => { if (!welcome) res({ closed: true }); });
  });
}

const waitFor = async (api, pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = api.msgs.find(pred); if (m) { api.msgs.splice(api.msgs.indexOf(m), 1); return m; } await sleep(100); } return null; };

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, what) => { cond ? pass++ : fail++; out((cond ? 'PASS ' : 'FAIL ') + what); };

  const d = await discover();
  ok(d && /^FELIX! 47890 /.test(d), 'UDP-поиск: ' + d);

  const bad = await connect('WRONG-CODE');
  ok(bad.bad || bad.closed, 'неверный код отвергнут: ' + JSON.stringify(bad.bad ? 'BADCODE' : bad));

  const cmds = [];
  const c = await connect(CODE, {
    onMsg: (m, api) => {
      if (m.t === 'cmd') { cmds.push(m.cmd); out('  <- cmd ' + m.cmd + ' ' + JSON.stringify(m)); api.send({ t: 'res', id: m.id, ok: true, text: 'готово', data: m.cmd === 'battery' ? { level: 77, charging: true } : undefined }); }
      else if (m.t === 'say') out('  <- say «' + m.text + '» wav=' + (m.wav ? Math.round(m.wav.length * 3 / 4 / 1024) + ' КБ' : 'нет') + ' speak=' + m.speak);
      else if (m.t !== 'pong') out('  <- ' + JSON.stringify(m).slice(0, 200));
    }
  });
  ok(c.welcome && c.welcome.t === 'welcome', 'сопряжение: welcome pc=' + (c.welcome && c.welcome.pc) + ' wol=' + JSON.stringify(c.welcome && c.welcome.wol));
  if (!c.welcome) { out(`ИТОГ: ${pass} ок, ${fail} ошибок`); process.exit(1); }

  c.send({ t: 'ping' });
  ok(!!await waitFor(c, m => m.t === 'pong', 3000), 'ping → pong');

  c.send({ t: 'battery', level: 77, charging: true });

  for (const q of ['сколько будет 2 плюс 2', 'который час', 'найди телефон', 'сколько заряда на телефоне']) {
    c.send({ t: 'felix', text: 'Феликс, ' + q });
    const say = await waitFor(c, m => m.t === 'say', 12000);
    ok(!!say, `команда «${q}» → ответ: ${say ? say.text : 'нет'}`);
    await sleep(500);
  }
  ok(cmds.includes('find'), 'телефону ушла команда find');

  // входящий звонок: карточка + объявление
  c.send({ t: 'call', state: 'ringing', number: '+70000000000', name: 'Тестовый контакт', incoming: true });
  const ann = await waitFor(c, m => m.t === 'say' && /Звонит/.test(m.text), 6000);
  ok(!!ann, 'звонок объявлен: ' + (ann ? ann.text : 'нет'));
  fs.writeFileSync(OUT + '.ringing', '1');
  await sleep(5000);                                       // в это время снимается экран с карточкой
  c.send({ t: 'felix', text: 'прими' });
  await sleep(2500);
  ok(cmds.includes('answer'), '«прими» → команда answer');
  c.send({ t: 'call', state: 'idle' });
  await sleep(800);

  // повтор старого счётчика → сервер рвёт связь
  const replay = await new Promise(res => { c.s.once('close', () => res(true)); c.s.write(enc(keyOf(CODE), { t: 'ping', n: 1 }) + '\n'); setTimeout(() => res(false), 3000); });
  ok(replay, 'повтор старого сообщения → разрыв');

  // APK по HTTP
  const apk = await new Promise(res => http.get('http://127.0.0.1:47892/FelixLink.apk', r => { let n = 0; r.on('data', b => n += b.length); r.on('end', () => res({ status: r.statusCode, n, type: r.headers['content-type'] })); }).on('error', e => res({ error: e.message })));
  const want = APK && fs.existsSync(APK) ? fs.statSync(APK).size : -1;
  ok(apk.status === 200 && apk.n === want, `APK по HTTP: ${apk.status} ${apk.n} байт (ожидалось ${want}) ${apk.type}`);
  const nf = await new Promise(res => http.get('http://127.0.0.1:47892/../config.json', r => { r.resume(); res(r.statusCode); }).on('error', () => res('err')));
  ok(nf === 404, 'другие пути по HTTP → ' + nf);

  out(`ИТОГ: ${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out('CRASH ' + e.stack); process.exit(2); });
