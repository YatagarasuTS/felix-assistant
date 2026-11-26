// Проверка голосовых команд для телефона: electron (ELECTRON_RUN_AS_NODE=1) tools/brain-phone-test.js
const path = require('path');
const b = require(path.join(__dirname, '..', 'app', 'lib', 'brain.js'));
const pa = require(path.join(__dirname, '..', 'app', 'lib', 'phoneapps.js'));

const CASES = [
  ['закажи пиццу', { intent: 'phone.food', query: 'пицца' }],
  ['закажи пиццу маргариту на телефоне', { intent: 'phone.food', query: 'пицца маргарита' }],
  ['закажи еду', { intent: 'phone.food', query: '' }],
  ['хочу есть', { intent: 'phone.food', query: '' }],
  ['закажи суши', { intent: 'phone.food', query: 'суши' }],
  ['вызови такси', { intent: 'phone.taxi', to: '' }],
  ['вызови мне такси до работы', { intent: 'phone.taxi', to: 'работа' }],
  ['такси домой', { intent: 'phone.taxi', to: 'дом' }],
  ['закажи такси в аэропорт шереметьево', { intent: 'phone.taxi', to: 'аэропорт шереметьево' }],
  ['вызови такси до улицы ленина 5', { intent: 'phone.taxi', to: 'улица ленина 5' }],
  ['закажи такси на восемь утра', { intent: 'phone.taxi', to: '' }],
  ['проложи маршрут до вокзала', { intent: 'phone.route', to: 'вокзала' }],
  ['маршрут домой', { intent: 'phone.route', to: 'дом' }],
  ['как доехать до красной площади', { intent: 'phone.route', to: 'красной площади' }],
  ['найди на карте аптеку', { intent: 'phone.map', query: 'аптеку' }],
  ['найди на озоне наушники', { intent: 'phone.shop', store: 'озоне', query: 'наушники' }],
  ['купи кроссовки', { intent: 'phone.shop', query: 'кроссовки' }],
  ['покажи экран телефона', { intent: 'phone.panel' }],
  ['открой телефон на компьютере', { intent: 'phone.panel' }],
  ['на телефоне назад', { intent: 'phone.nav', action: 'back' }],
  ['телефон домой', { intent: 'phone.nav', action: 'home' }],
  ['заблокируй телефон', { intent: 'phone.nav', action: 'lock' }],
  ['сделай скриншот на телефоне', { intent: 'phone.nav', action: 'screenshot' }],
  ['напиши на телефоне привет как дела', { intent: 'phone.type', text: 'привет как дела' }],
  ['открой ссылку на телефоне', { intent: 'phone.url' }],
  ['отправь текст на телефон', { intent: 'phone.clip' }],
  ['включи на телефоне песню группа крови', { intent: 'phone.music', query: 'группа крови' }],
  // старые команды не сломались
  ['открой на телефоне телеграм', { intent: 'phone.open', app: 'телеграм' }],
  ['позвони маме', { intent: 'phone.call', name: 'маме' }],
  ['громче на телефоне', { intent: 'phone.volume', stream: 'music', delta: 15 }],
  ['сделай скриншот', { intent: 'screenshot' }],
  ['заблокируй компьютер', { intent: 'power', action: 'lock' }],
  ['открой загрузки', { intent: 'open', target: 'загрузки' }],
  ['включи трек группа крови', { intent: 'music.play', query: 'группа крови' }],
  ['какая погода завтра', { intent: 'weather', city: '', day: 1 }],
  ['напечатай привет', { intent: 'type', text: 'привет' }],
  // 1.3: найденное в журнале — «открой покупки» не находилось, «убери телеграм» открывало телеграм
  ['открой покупки', { intent: 'phone.shop', query: '', open: true }],
  ['открой магазин', { intent: 'phone.shop', query: '', open: true }],
  ['открой такси', { intent: 'phone.taxi', to: '' }],
  ['открой доставку', { intent: 'phone.food', query: '' }],
  ['убери телеграм', { intent: 'app.minimize', target: 'телеграм' }],
  ['открой телеграм', { intent: 'open', target: 'телеграм' }],
  ['открой телеграм чат с мамой', { intent: 'tg.open' }],
  ['включи музыку', { intent: 'media', action: 'play' }],
  ['подбрось монетку', { intent: 'coin' }],
  ['брось кубик', { intent: 'dice' }],
  ['орел или решка', { intent: 'coin' }]
];

let fail = 0;
for (const [say, want] of CASES) {
  const got = b.parse(say);
  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + say + ' => ' + JSON.stringify(got));
}

// каталог: подсказки, ссылки, выбор голосом
const apps = [{ pkg: 'ru.sbcs.store', label: 'Самокат' }, { pkg: 'ru.foodfox.client', label: 'Яндекс Еда' }, { pkg: 'com.example.pizza', label: 'Пицца Сити' }, { pkg: 'ru.yandex.taxi', label: 'Яндекс Go' }];
const food = pa.suggest('food', apps);
const chk = (cond, what) => { if (!cond) fail++; console.log((cond ? 'ok   ' : 'FAIL ') + what); };
chk(food.map(a => a.pkg).join() === 'ru.foodfox.client,ru.sbcs.store,com.example.pizza', 'suggest food: ' + food.map(a => a.label).join(', '));
chk(pa.suggest('taxi', apps).length === 1, 'suggest taxi: одно приложение');
chk(pa.links('maps', 'ru.yandex.yandexmaps', 'route')[0].includes('rtext='), 'links maps route (Яндекс Карты)');
chk(pa.links('maps', 'com.unknown.maps', 'place')[0].startsWith('geo:'), 'links maps (любое приложение) → geo:');
chk(pa.storePkg('озоне') === 'ru.ozon.app.android', 'storePkg озоне');
chk(pa.pickByVoice('яндекс еду', food, b.translit)?.pkg === 'ru.foodfox.client', 'голосом: «яндекс еду»');
chk(pa.pickByVoice('самокат', food, b.translit)?.pkg === 'ru.sbcs.store', 'голосом: «самокат»');
chk(pa.pickByVoice('второе', food, b.translit)?.pkg === 'ru.sbcs.store', 'голосом: «второе»');
chk(pa.pickByVoice('не знаю', food, b.translit) === null, 'голосом: непонятное → null');
chk(b.serviceWord('покупки') === 'shop' && b.serviceWord('доставку') === 'food' && b.serviceWord('навигатор') === 'maps' && b.serviceWord('калькулятор') === null, 'serviceWord: покупки/доставку/навигатор, калькулятор — нет');
console.log(fail ? `ОШИБОК: ${fail}` : 'ВСЁ ОК');
process.exit(fail ? 1 : 0);
