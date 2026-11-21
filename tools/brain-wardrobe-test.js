// Разбор фраз гардероба, игр и заботы: electron (ELECTRON_RUN_AS_NODE=1) tools/brain-wardrobe-test.js
const path = require('path');
const b = require(path.join(__dirname, '..', 'app', 'lib', 'brain.js'));
const CASES = [
  ['надень корону', { intent: 'wardrobe.wear', id: 'crown' }],
  ['надень ковбойскую шляпу', { intent: 'wardrobe.wear', id: 'cowboy' }],
  ['надень шляпу волшебника', { intent: 'wardrobe.wear', id: 'wizard' }],
  ['надень шляпу', { intent: 'wardrobe.wear', id: 'tophat' }],
  ['надень новогодний колпак', { intent: 'wardrobe.wear', id: 'santa' }],
  ['надень колпак', { intent: 'wardrobe.wear', id: 'party' }],
  ['надень солнечные очки', { intent: 'wardrobe.wear', id: 'sunglasses' }],
  ['надень очки', { intent: 'wardrobe.wear', id: 'glasses' }],
  ['надень звёздные очки', { intent: 'wardrobe.wear', id: 'starglasses' }],
  ['примерь кошачьи ушки', { intent: 'wardrobe.wear', id: 'catears' }],
  ['надень что-нибудь', { intent: 'wardrobe.wear', id: '' }],
  ['надень пижаму', { intent: 'wardrobe.wear', id: null }],
  ['возьми зонт', { intent: 'wardrobe.wear', id: 'umbrella' }],
  ['возьми трубку', { intent: 'phone.answer' }],
  ['надень розовое худи', { intent: 'wardrobe.outfit', id: 'sakura' }],
  ['переоденься', { intent: 'wardrobe.outfit', id: '' }],
  ['переоденься в космос', { intent: 'wardrobe.outfit', id: 'cosmos' }],
  ['смени наряд на камуфляж', { intent: 'wardrobe.outfit', id: 'forest' }],
  ['оденься по погоде', { intent: 'wardrobe.weather' }],
  ['сними очки', { intent: 'wardrobe.off', id: 'glasses' }],
  ['убери крылья', { intent: 'wardrobe.off', id: 'wings' }],
  ['сними все', { intent: 'wardrobe.off', all: true }],
  ['сними с паузы', { intent: 'media', action: 'play' }],
  ['покажи гардероб', { intent: 'wardrobe.open' }],
  ['что на тебе', { intent: 'wardrobe.what' }],
  ['сделай селфи', { intent: 'selfie' }],
  ['давай сыграем в камень ножницы бумага', { intent: 'game.rps' }],
  ['загадай число от 1 до 10', { intent: 'game.guess', from: 1, to: 10 }],
  ['загадай число', { intent: 'game.guess', from: 1, to: 100 }],
  ['случайное число', { intent: 'random' }],
  ['загадай загадку', { intent: 'game.riddle' }],
  ['мне скучно', { intent: 'game.any' }],
  ['запусти помидор', { intent: 'pomodoro.start' }],
  ['стоп помидор', { intent: 'pomodoro.stop' }],
  ['напоминай пить воду', { intent: 'remind.water', on: true }],
  ['не напоминай пить воду', { intent: 'remind.water', on: false }],
  ['напоминай размяться', { intent: 'remind.stretch', on: true }],
  ['подними мне настроение', { intent: 'chat.cheer' }],
  ['спрячься', { intent: 'self.hide' }],
  ['убери хром', { intent: 'app.minimize' }],
  ['закажи пиццу', { intent: 'phone.food', query: 'пицца' }]
];
let fail = 0;
for (const [say, want] of CASES) {
  const got = b.parse(say);
  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  if (!ok) fail++;
  console.log((ok ? 'ok   ' : 'FAIL ') + say + ' => ' + JSON.stringify(got));
}
console.log(fail ? `ОШИБОК: ${fail}` : 'ВСЁ ОК');
process.exit(fail ? 1 : 0);
