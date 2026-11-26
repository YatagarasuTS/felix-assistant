// Эмулятор «Феликс Link» 1.1: управление телефоном с компьютера — дела (доставка, такси, маршрут, магазин),
// выбор приложения голосом, кнопки телефона, ввод текста, окно «Телефон» (экран и снимки).
// Запуск: Феликс с FELIX_DATA=test\data_phone (phone.enabled, код TESTCODE), затем
//   electron (ELECTRON_RUN_AS_NODE=1) test\link_phone_test.js TESTCODE <файл-отчёт>
const net = require('net'), crypto = require('crypto'), fs = require('fs');
const [CODE, OUT] = process.argv.slice(2);
const lines = [];
const out = s => { lines.push(new Date().toISOString().slice(11, 23) + ' ' + s); fs.writeFileSync(OUT, lines.join('\n') + '\n'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = c => crypto.pbkdf2Sync(String(c).toUpperCase().replace(/[^A-Z0-9]/g, ''), 'FelixLink1', 100000, 32, 'sha256');
const enc = (key, o) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(JSON.stringify(o)), c.final()]); return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64'); };
const dec = (key, line) => { try { const a = Buffer.from(line, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', key, a.subarray(0, 12)); d.setAuthTag(a.subarray(a.length - 16)); return JSON.parse(Buffer.concat([d.update(a.subarray(12, a.length - 16)), d.final()]).toString()); } catch { return null; } };

// приложения «на телефоне»: две доставки (Феликс спросит, какую), одно такси, одни карты, Ozon
const APPS = [['ru.foodfox.client', 'Яндекс Еда'], ['ru.sbcs.store', 'Самокат'], ['ru.yandex.taxi', 'Яндекс Go'], ['ru.yandex.yandexmaps', 'Яндекс Карты'], ['ru.ozon.app.android', 'Ozon'], ['org.telegram.messenger', 'Telegram']]
  .map(([pkg, label]) => ({ pkg, label }));
// маленький JPEG 2×2 — «снимок экрана»
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAACAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//aAAgBAQAAAAE//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oACAEBAAAAEH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==';

function phone(code) {
  return new Promise(res => {
    const key = keyOf(code), s = net.connect(47890, '127.0.0.1');
    let buf = '', n = 0, nonce = null, ready = false;
    const api = { s, cmds: [], says: [], send: o => s.write(enc(key, { ...o, n: ++n }) + '\n') };
    const reply = (m, ok, text, data) => api.send({ t: 'res', id: m.id, ok, text: text || '', data: data === undefined ? null : data });
    s.on('data', ch => {
      buf += ch; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!nonce) { if (line.startsWith('FELIXLINK1 ')) { nonce = line.slice(11); api.send({ t: 'hello', nonce, device: 'Эмулятор', model: 'Test Phone', android: '14', app: '1.1' }); } continue; }
        const m = dec(key, line);
        if (!m) continue;
        if (m.t === 'welcome') { ready = true; res(api); continue; }
        if (m.t === 'say') { api.says.push(m.text); out('  <- say «' + m.text + '»'); continue; }
        if (m.t !== 'cmd') continue;
        api.cmds.push(m);
        if (m.cmd !== 'shot') out('  <- cmd ' + m.cmd + ' ' + JSON.stringify({ ...m, t: undefined, n: undefined, id: undefined }));
        switch (m.cmd) {
          case 'apps': reply(m, true, '', APPS.map(a => ({ ...a, icon: m.icons ? 'iVBORw0KGgo=' : undefined }))); break;
          case 'service': {
            const a = APPS.find(x => x.pkg === m.pkg);
            if (!a) { reply(m, false, 'приложение не установлено на телефоне'); break; }
            const link = (m.links || []).length > 0 && (!(m.links[0].includes('{lat}')) || m.dest);
            reply(m, true, a.label, { how: link ? 'link' : 'app', typed: !link && !!(m.query || m.dest), clip: !!(m.query || m.dest), label: a.label, geo: !!m.dest });
            break;
          }
          case 'screen': reply(m, true, '', { acc: true, canShot: true, android: 34, w: 1080, h: 2340 }); break;
          case 'shot': reply(m, true, '', { jpeg: JPEG, w: 2, h: 2 }); break;
          default: reply(m, true);
        }
      }
    });
    s.on('error', e => res({ error: e.message }));
    s.on('close', () => { if (!ready) res({ closed: true }); });
  });
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, what) => { cond ? pass++ : fail++; out((cond ? 'PASS ' : 'FAIL ') + what); };
  const p = await phone(CODE);
  ok(!p.error && !p.closed, 'сопряжение с app=1.1');
  if (p.error || p.closed) { out(`ИТОГ: ${pass} ок, ${fail} ошибок`); process.exit(1); }
  const waitSay = async (re, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const i = p.says.findIndex(s => re.test(s)); if (i >= 0) return p.says.splice(i, 1)[0]; await sleep(100); } return null; };
  const waitCmd = async (pred, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const i = p.cmds.findIndex(pred); if (i >= 0) return p.cmds.splice(i, 1)[0]; await sleep(100); } return null; };
  const felix = text => p.send({ t: 'felix', text });

  // 1. доставка: две подходящие → Феликс спрашивает, ответ голосом «самокат» → запоминает
  felix('Феликс, закажи пиццу');
  ok(!!await waitCmd(c => c.cmd === 'apps'), 'закажи пиццу → список приложений телефона');
  const ask = await waitSay(/Через какое приложение/);
  ok(ask && /Яндекс Еда/.test(ask) && /Самокат/.test(ask), 'спрашивает, какую доставку: ' + ask);
  felix('самокат');
  let c = await waitCmd(x => x.cmd === 'service');
  ok(c && c.pkg === 'ru.sbcs.store' && c.query === 'пицца', 'ответ «самокат» → service ru.sbcs.store, query=пицца');
  ok(!!await waitSay(/Самокат.*пицца/), 'ответ: открыл Самокат и ищет пиццу');

  // 2. выбор запомнен
  felix('закажи суши');
  c = await waitCmd(x => x.cmd === 'service');
  ok(c && c.pkg === 'ru.sbcs.store' && c.query === 'суши', 'второй заказ сразу в Самокат (выбор запомнен)');
  await waitSay(/суши/);

  // 3. такси: одно приложение — выбирается само; ссылка с координатами; город из погоды — подсказка геокодеру
  felix('вызови такси до улицы ленина 5');
  c = await waitCmd(x => x.cmd === 'service');
  ok(c && c.pkg === 'ru.yandex.taxi' && /^yandextaxi:\/\/route\?end-lat=\{lat\}/.test((c.links || [])[0] || '') && c.dest === 'улица ленина 5' && c.near && Math.abs(c.near.lat - 55.75) < 0.1, 'такси → Яндекс Go, ссылка-маршрут, адрес и город: ' + JSON.stringify(c && { links: c.links, dest: c.dest, near: c.near }));
  const taxi = await waitSay(/Яндекс Go/);
  ok(taxi && /маршрут до «улица ленина 5»/.test(taxi) && /закажи/.test(taxi) && /в настройках/.test(taxi), 'ответ про такси (не заказывает сам): ' + taxi);

  // 4. «такси домой» без адреса дома → просит вписать в настройках
  felix('такси домой');
  ok(!!await waitSay(/Не знаю, где твой дом/), '«такси домой» без адреса → просит адрес в настройках');

  // 5. маршрут — в карты
  felix('проложи маршрут до вокзала');
  c = await waitCmd(x => x.cmd === 'service');
  ok(c && c.pkg === 'ru.yandex.yandexmaps' && /rtext=~\{lat\},\{lon\}/.test((c.links || [])[0] || '') && c.dest === 'вокзала', 'маршрут → Яндекс Карты rtext');
  await waitSay(/маршрут|Карты/);

  // 6. магазин назван в команде
  felix('найди на озоне наушники');
  c = await waitCmd(x => x.cmd === 'service');
  ok(c && c.pkg === 'ru.ozon.app.android' && c.query === 'наушники' && /ozon\.ru\/search/.test((c.links || [])[0] || ''), 'найди на озоне → Ozon, поиск');
  await waitSay(/Ozon|наушники/);

  // 6б. «открой покупки» / «открой навигатор»: на компьютере таких нет — дела телефона (1.3; раньше «не нашёл приложение»)
  felix('открой покупки');
  c = await waitCmd(x => x.cmd === 'service');
  ok(c && c.pkg === 'ru.ozon.app.android' && !c.query, 'открой покупки → магазин на телефоне (Ozon): ' + JSON.stringify(c && { pkg: c.pkg, query: c.query }));
  await waitSay(/Ozon/);
  felix('открой навигатор');
  c = await waitCmd(x => x.cmd === 'service');
  ok(c && c.pkg === 'ru.yandex.yandexmaps', 'открой навигатор → карты на телефоне');
  await waitSay(/Карты/);

  // 7. кнопки и текст
  felix('на телефоне назад');
  c = await waitCmd(x => x.cmd === 'nav');
  ok(c && c.action === 'back', 'на телефоне назад → nav back');
  felix('напиши на телефоне привет как дела');
  c = await waitCmd(x => x.cmd === 'text');
  ok(c && c.text === 'привет как дела', 'напиши на телефоне → text');

  // 8. окно «Телефон»: открывается, спрашивает экран и тянет снимки
  felix('покажи экран телефона');
  ok(!!await waitSay(/Вот твой телефон/), 'покажи экран телефона → окно');
  ok(!!await waitCmd(x => x.cmd === 'screen', 12000), 'окно «Телефон» спросило экран');
  const shots = await (async () => { await sleep(3000); return p.cmds.filter(x => x.cmd === 'shot').length; })();
  ok(shots >= 3, `окно тянет снимки экрана (${shots} за 3 с)`);
  fs.writeFileSync(OUT + '.panel', '1');
  await sleep(4000);                                   // тут снимается окно для проверки

  out(`ИТОГ: ${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})().catch(e => { out('CRASH ' + e.stack); process.exit(2); });
