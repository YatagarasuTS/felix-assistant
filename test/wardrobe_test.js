// Гардероб, игры, помидор, напоминания, селфи — голосовые команды через эмулятор «Феликс Link» (как с телефона).
// Запуск: Феликс с FELIX_DATA=test\data_phone (голос off), FELIX_PICTURES и FELIX_SHOTS — тестовые папки, затем
//   electron (ELECTRON_RUN_AS_NODE=1) test\wardrobe_test.js TESTCODE <файл-отчёт>
const net = require('net'), crypto = require('crypto'), fs = require('fs');
const [CODE, OUT] = process.argv.slice(2);
const lines = [];
const out = s => { lines.push(new Date().toISOString().slice(11, 23) + ' ' + s); fs.writeFileSync(OUT, lines.join('\n') + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = c => crypto.pbkdf2Sync(String(c).toUpperCase().replace(/[^A-Z0-9]/g, ''), 'FelixLink1', 100000, 32, 'sha256');
const enc = (key, o) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(o)), c.final()]); return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64'); };
const dec = (key, line) => { try { const a = Buffer.from(line, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, a.subarray(0, 12)); d.setAuthTag(a.subarray(a.length - 16)); return JSON.parse(Buffer.concat([d.update(a.subarray(12, a.length - 16)), d.final()]).toString()); } catch { return null; } };

function phone(code) {
  return new Promise(res => {
    const key = keyOf(code), s = net.connect(47890, '127.0.0.1');
    let buf = '', n = 0, nonce = null;
    const api = { says: [], send: o => s.write(enc(key, { ...o, n: ++n }) + '\n') };
    s.on('data', ch => {
      buf += ch; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!nonce) { if (line.startsWith('FELIXLINK1 ')) { nonce = line.slice(11); api.send({ t: 'hello', nonce, device: 'Эмулятор', model: 'Test', android: '14', app: '1.1' }); } continue; }
        const m = dec(key, line); if (!m) continue;
        if (m.t === 'welcome') res(api);
        else if (m.t === 'say') { api.says.push(m.text); out('  <- «' + m.text + '»'); }
        else if (m.t === 'cmd') api.send({ t: 'res', id: m.id, ok: true, text: '', data: null });
      }
    });
    s.on('error', e => res({ error: e.message }));
  });
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (c, what) => { c ? pass++ : fail++; out((c ? 'PASS ' : 'FAIL ') + what); };
  const p = await phone(CODE);
  if (p.error) { out('нет связи: ' + p.error); process.exit(2); }
  const ask = async (text, re, ms = 8000) => {
    re = new RegExp(re.source, re.flags.includes('i') ? re.flags : re.flags + 'i');   // Феликс может начать фразу с большой буквы
    p.says.length = 0; p.send({ t: 'felix', text });
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const s = p.says.find(x => re.test(x)); if (s) return s; await sleep(100); }
    return null;
  };
  const say1 = async (text, re, what, ms) => { const s = await ask(text, re, ms); ok(!!s, `${what}: «${text}» → ${s || p.says.join(' | ') || 'нет ответа'}`); return s; };

  // аксессуары
  await say1('Феликс, сними все аксессуары', /(Снимаю|нечего)/, 'исходное состояние');
  await sleep(2500);
  await say1('надень корону', /корону/, 'надеть корону');
  await sleep(2400);
  await say1('надень корону', /уже на мне/, 'повторно — уже надета');
  await say1('надень шляпу волшебника', /(Меняю корону на шляпу волшебника|шляпу волшебника)/, 'замена в том же слоте');
  await sleep(4200);
  await say1('надень солнечные очки', /солнечные очки/i, 'очки (другой слот)');
  await sleep(2400);
  await say1('надень плащ', /нет/, 'несуществующая вещь');
  await say1('сними очки', /Снимаю солнечные очки/, 'снять очки');
  await sleep(1800);
  await say1('возьми зонт', /зонт/, 'зонт в руку');
  await sleep(2400);
  await say1('надень что-нибудь', /(Надеваю|примерю|выбор|Меняю|Снимаю)/, 'случайная вещь');
  await sleep(4200);
  // наряды
  await say1('переоденься в космос', /(переоденусь|ширму|подглядывай)/, 'переодеться: начало');
  const tada = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 8000) { const s = p.says.find(x => /Космос/.test(x)); if (s) return s; await sleep(100); } return null; })();
  ok(!!tada, 'переодеться: «та-да» через ~4,6 с → ' + tada);
  await sleep(1500);
  await say1('что на тебе', /Космос/, 'что надето');
  await say1('переоденься в космос', /и так/, 'тот же наряд');
  await say1('переоденься в пижаму', /нет/, 'несуществующий наряд');
  // игры
  await say1('давай сыграем в камень ножницы бумага', /Говори/, 'камень-ножницы-бумага: старт');
  await say1('камень', /(У меня|Ничья|выиграл|победил)/, 'камень-ножницы-бумага: ход');
  await say1('загадай число от 1 до 16', /Загадал число от 1 до 16/, 'угадай число: старт');
  let lo = 1, hi = 16, won = null;
  for (let i = 0; i < 6 && !won; i++) {
    const g = Math.floor((lo + hi) / 2);
    const r = await ask(String(g), /(больше|меньше|Да!)/);
    if (!r) break;
    if (/Да!/.test(r)) won = r; else if (/больше/.test(r)) lo = g + 1; else hi = g - 1;
  }
  ok(!!won, 'угадай число: угадал делением пополам → ' + won);
  await say1('загадай загадку', /Загадка!/, 'загадка: старт');
  await say1('сдаюсь', /Ответ/, 'загадка: сдаюсь');
  // помидор и напоминания
  await say1('запусти помидор', /Помидор запущен/, 'помидор: старт');
  await say1('сколько осталось помидора', /До перерыва \d+/, 'помидор: сколько осталось');
  await say1('стоп помидор', /остановлен/, 'помидор: стоп');
  await say1('напоминай пить воду', /раз в час/, 'напоминание о воде: вкл');
  await say1('не напоминай пить воду', /Больше не напоминаю/, 'напоминание о воде: выкл');
  await say1('подними мне настроение', /./, 'поддержка');
  // селфи (окно Феликса рисует картинку, главный процесс сохраняет в FELIX_PICTURES)
  await say1('сделай селфи', /(Улыбочку|причешусь|Фото на память)/, 'селфи: поза');
  const saved = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 9000) { const s = p.says.find(x => /Щёлк/.test(x)); if (s) return s; await sleep(100); } return null; })();
  ok(!!saved, 'селфи: сохранено → ' + saved);
  // вернуть как было
  await say1('сними все аксессуары', /Снимаю/, 'уборка');
  await sleep(3500);
  await say1('надень наушники', /аушники/, 'наушники на месте («сними всё» их не трогает)');
  await sleep(2500);
  await say1('переоденься в мятное', /(переоденусь|ширму|подглядывай)/, 'обратно в мятное');
  await sleep(6500);
  out(`ИТОГ: ${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out('CRASH ' + e.stack); process.exit(2); });
