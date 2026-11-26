// Разбор голосовых команд Феликса (русский язык, офлайн).
// parse(text) → { intent, ... } ; wake(text) → { woke, rest }

// Как офлайн-Vosk слышит «Феликс»: проверено синтезом трёх голосов — «феликс» узнаётся 6 из 6 раз.
// Иногда добавляет «в» («феликс в какая погода») или слышит «филикс», «феликса».
const NAME = '(?:феликс|феликса|феликсу|феликсе|филикс|фелекс|феликз|фелиск)';
const WAKE = new RegExp(`^(?:(?:эй|слушай|ну|а|о)\\s+)?${NAME}(?:\\s+в(?=\\s))?(?:\\s|,|$)+`);
// «Феликс» в обычной речи бывает редко (имя), поэтому «слабым» считаем только обращение посреди фразы
const WEAK = new Set();

function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:«»"()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Есть ли в начале обращение «Феликс». Обращение посреди фразы — «слабое»: пройдут только команды, не болтовня. */
function wake(text) {
  let t = norm(text);
  let m = t.match(WAKE);
  if (!m) {
    // Vosk иногда склеивает фоновую речь с командой: «…ну вот феликс открой загрузки».
    const mid = t.match(new RegExp(`(?:^|\\s)${NAME}\\s+((?:(?!\\s${NAME}\\s).)+)$`));
    if (mid && t.indexOf(mid[0]) > 0) return { woke: true, weak: true, rest: mid[1].trim() };
    return { woke: false, rest: t };
  }
  let weak = WEAK.has(m[0].trim());
  t = t.slice(m[0].length).trim();
  const m2 = t.match(WAKE);
  if (m2 && t.length > m2[0].length) t = t.slice(m2[0].length).trim();
  return { woke: true, weak, rest: t };
}

// ---------------------------------------------------------------- числа словами (Vosk пишет «двадцать пять»)
const NUM_WORDS = {
  ноль: 0, нуль: 0, один: 1, одна: 1, одну: 1, одной: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9,
  десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17,
  восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70,
  восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700,
  восемьсот: 800, девятьсот: 900,
  // родительный падеж: «от одного до десяти»
  одного: 1, двух: 2, трех: 3, четырех: 4, пяти: 5, шести: 6, семи: 7, восьми: 8, девяти: 9, десяти: 10, двадцати: 20, тридцати: 30,
  сорока: 40, пятидесяти: 50, шестидесяти: 60, семидесяти: 70, восьмидесяти: 80, девяноста: 90, ста: 100
};
const BIG = { тысяча: 1000, тысячи: 1000, тысяч: 1000, миллион: 1e6, миллиона: 1e6, миллионов: 1e6 };

/** Заменяет числа словами на цифры: «двадцать пять минут» → «25 минут», «полтора» → 1.5 */
function wordsToDigits(text) {
  const out = []; let cur = null, total = 0;
  const flush = () => { if (cur !== null || total) { out.push(String(total + (cur || 0))); cur = null; total = 0; } };
  for (const w of String(text).split(' ')) {
    if (/^\d+([.,]\d+)?$/.test(w)) { flush(); out.push(w.replace(',', '.')); continue; }
    if (w in NUM_WORDS) { cur = (cur || 0) + NUM_WORDS[w]; continue; }
    if (w in BIG) { total += (cur || 1) * BIG[w]; cur = null; continue; }
    if (w === 'полтора' || w === 'полторы') { flush(); out.push('1.5'); continue; }
    flush(); out.push(w);
  }
  flush();
  return out.join(' ');
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function spellDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const parts = [];
  if (h) parts.push(`${h} ${plural(h, 'час', 'часа', 'часов')}`);
  if (m) parts.push(`${m} ${plural(m, 'минуту', 'минуты', 'минут')}`);
  if (s && !h) parts.push(`${s} ${plural(s, 'секунду', 'секунды', 'секунд')}`);
  return parts.join(' ') || '0 секунд';
}

function sayNumber(x) {
  if (!isFinite(x)) return 'бесконечность';
  const r = Math.round(x * 1000) / 1000;
  return String(r).replace('.', ',').replace('-', 'минус ');
}

/** «пять минут», «полчаса», «час двадцать», «30 секунд» → секунды */
function parseDuration(t) {
  t = wordsToDigits(t);
  let sec = 0, m;
  if (/полчаса/.test(t)) sec += 1800;
  if (/(^|\s)(час|часик)(\s|$)/.test(t) && !/\d+(\.\d+)?\s+час/.test(t)) sec += 3600;
  if (/(^|\s)(минуту|минутку)(\s|$)/.test(t) && !/\d+\s+минут/.test(t)) sec += 60;
  const re = /(\d+(?:\.\d+)?)\s*(час|мин|сек)/g;
  while ((m = re.exec(t))) sec += parseFloat(m[1]) * (m[2] === 'час' ? 3600 : m[2] === 'мин' ? 60 : 1);
  if (!sec && (m = t.match(/^(\d+(?:\.\d+)?)$/))) sec = parseFloat(m[1]) * 60;   // «таймер на пять» — минуты
  return Math.round(sec);
}

/** «сколько будет 2 плюс 2 умножить на 3» → { expr, result } */
function parseCalc(t) {
  let s = ' ' + wordsToDigits(t) + ' ';
  s = s.replace(/ (умножить|умноженное|умножь) на /g, ' * ').replace(/ (разделить|деленное|подели|раздели) на /g, ' / ')
    .replace(/ (плюс|прибавить) /g, ' + ').replace(/ (минус|отнять) /g, ' - ').replace(/ на /g, ' * ')
    .replace(/ в квадрате /g, ' ^ 2 ').replace(/ в степени /g, ' ^ ').replace(/ процентов от /g, ' % ');
  const tokens = s.trim().split(/\s+/).filter(x => /^(\d+(\.\d+)?|[-+*/^%])$/.test(x));
  if (tokens.length < 3) return { expr: '', result: null };
  // разбор с приоритетами: ^, затем * / %, затем + -
  const nums = [], ops = [];
  const prec = o => (o === '^' ? 3 : o === '+' || o === '-' ? 1 : 2);
  const apply = () => { const b = nums.pop(), a = nums.pop(), o = ops.pop(); nums.push(o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : o === '/' ? a / b : o === '%' ? a * b / 100 : Math.pow(a, b)); };
  let expectNum = true;
  for (const tk of tokens) {
    if (expectNum) { if (!/^\d/.test(tk)) return { expr: '', result: null }; nums.push(parseFloat(tk)); expectNum = false; }
    else { if (/^\d/.test(tk)) return { expr: '', result: null }; while (ops.length && prec(ops[ops.length - 1]) >= prec(tk) && tk !== '^') apply(); ops.push(tk); expectNum = true; }
  }
  if (expectNum) return { expr: '', result: null };
  while (ops.length) apply();
  const words = { '+': 'плюс', '-': 'минус', '*': 'умножить на', '/': 'разделить на', '^': 'в степени', '%': 'процентов от' };
  return { expr: tokens.map(x => words[x] || x.replace('.', ',')).join(' '), result: nums[0] };
}

const RU2LAT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function translit(s) { return norm(s).split('').map(c => RU2LAT[c] ?? c).join(''); }

const THEME_WORDS = [
  { id: 'mint', re: /(мят|бирюз|стандарт|по умолчанию|обычн)/ },
  { id: 'midnight', re: /(полноч|ночн|син|фиолет)/ },
  { id: 'sunset', re: /(закат|оранж|рыж|теплн|тепл)/ },
  { id: 'sakura', re: /(сакур|розов)/ },
  { id: 'ember', re: /(красн|огн|углей|уголь)/ },
  { id: 'snow', re: /(светл|снеж|бел)/ }
];

function num(s) {
  const m = String(s).match(/\d+/);
  if (m) return parseInt(m[0], 10);
  const words = { ноль: 0, десять: 10, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, половин: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, максимум: 100 };
  for (const [w, v] of Object.entries(words)) if (s.includes(w)) return v;
  return null;
}

// ---------------------------------------------------------------- телефон и будильник
const PHONE_RE = /(^|\s)(на |в |с )?(телефон\S*|смартфон\S*|мобильн\S*)(?=\s|$)/;

// ---------------------------------------------------------------- гардероб: наряды и аксессуары (каталог — app/ui/wardrobe-catalog.json)
const WCAT = require('../ui/wardrobe-catalog.json');
/** Вещь по словам: побеждает самое длинное совпадение основы («ковбойскую шляпу» → ковбойская, а не цилиндр) */
function wardrobeMatch(s, list) {
  let best = null, len = 0;
  for (const it of list) for (const stem of it.say) if (s.includes(stem) && stem.length > len) { best = it; len = stem.length; }
  return best;
}

/** Куда ехать: «до работы» → «работа», «домой» → «дом», «до улицы Ленина 5» → «улица ленина 5». Время («на восемь утра») — не адрес. */
function place(s) {
  s = norm(s).replace(/^(пожалуйста|сейчас|срочно)\s+/, '').replace(/\s+(пожалуйста|срочно|сейчас)$/, '');
  if (!s) return '';
  if (/(^|\s)(утра|вечера|дня|ночи|минут\S*|час\S{0,2})(\s|$)/.test(s) || /^((на|к|через|в)\s+)?\d/.test(wordsToDigits(s))) return '';
  s = s.replace(/^(до|в|во|на|к|ко)\s+/, '');
  if (/^(дом|домой|дома|дому|хату|хаты)$/.test(s)) return 'дом';
  if (/^(работ\S*|офис\S*)$/.test(s)) return 'работа';
  return s.replace(/^улицы\s/, 'улица ').replace(/^площади\s/, 'площадь ');
}

/** «пиццу маргариту» → «пицца маргарита» (поиск в приложениях лучше понимает именительный падеж); «еду», «поесть» → пусто */
function foodQuery(s) {
  s = norm(s).replace(/^(мне|нам|себе|пожалуйста|доставку|доставкой)\s+/, '').replace(/\s+(на дом|домой|с доставкой|пожалуйста|быстро|побыстрее)$/, '').trim();
  if (!s || /^(еду|еды|поесть|покушать|перекусить|ужин|обед|завтрак|доставку|доставку еды|что-нибудь|что нибудь|что-нибудь поесть|что нибудь поесть)$/.test(s)) return '';
  return s.split(' ').map(w => (w.length >= 4 && /[бвгджзклмнпрстфхцчшщ]у$/.test(w) ? w.slice(0, -1) + 'а' : w)).join(' ');
}

/**
 * Время будильника: «на семь тридцать», «на 7:30», «в восемь утра», «на девять вечера», «через 20 минут».
 * Числа словами разбираем сами: «семь тридцать» — это 7:30, а не 37.
 */
function parseAlarm(s) {
  s = norm(s).replace(/^(на|в|к)\s+/, '');
  if (!s) return null;
  if (/через/.test(s)) { const sec = parseDuration(s.replace(/^.*через\s+/, '')); return sec ? { inSec: sec } : null; }
  let h = null, mi = 0, m;
  if ((m = s.match(/(\d{1,2})[:.\s](\d{2})(?!\d)/))) { h = +m[1]; mi = +m[2]; }
  else {
    const nums = [];
    for (const w of s.split(' ')) {
      if (/^\d+$/.test(w)) nums.push(+w);
      else if (w in NUM_WORDS) nums.push(NUM_WORDS[w]);
      else if (/^(час|часа)$/.test(w) && !nums.length) nums.push(1);
    }
    if (!nums.length) return /полдень/.test(s) ? { hour: 12, minute: 0 } : /полночь/.test(s) ? { hour: 0, minute: 0 } : null;
    let i = 1;
    h = nums[0];
    if (h === 20 && nums[1] > 0 && nums[1] < 4) { h += nums[1]; i = 2; }            // «двадцать три»
    mi = nums.slice(i).reduce((a, b) => a + b, 0);                                 // «тридцать пять»
    // «будильник на 20 минут» — это не время, а через сколько
    if (/минут/.test(s) && !/час/.test(s) && nums.length === 1) return { inSec: h * 60 };
  }
  if (/(вечера|дня)/.test(s) && h < 12) h += 12;
  if (/ночи/.test(s) && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { hour: h, minute: mi };
}

// ---------------------------------------------------------------- Telegram / Discord
const TG_RE = /(^|\s)(в |во |из |на )?(телеграм\S*|телеграмм\S*|телег\S*|тг)(?=\s|$)/;
const DS_RE = /(^|\s)(в |во |из |на )?(дискорд\S*|дс)(?=\s|$)/;

/** «открой в телеграме чат с мамой» → { query: 'мамой', kind: 'чат' }; «открой телеграм» → null (просто программа) */
function chatTarget(t, appRe) {
  if (!appRe.test(t)) return null;
  let s = t.replace(appRe, ' ').replace(/\s+/g, ' ').trim();
  if (/^(закрой|закрыть|выключи|сверни|разверни|убей|заверши|спрячь|убери|выйди|выйти|скрой|отключи)(\s|$)/.test(s)) return null;
  s = s.replace(/^(открой|открыть|найди|покажи|зайди|перейди|напиши|пиши|включи|запусти|давай|переключись|переключи|вернись)(\s+|$)/, '').replace(/^(в|на|во)(\s+|$)/, '');
  let kind = '';
  const km = s.match(/^(личк\S*|личные сообщения|личные|лс|чат|канал|группу|группа|переписку|диалог|беседу|контакт|сервер|сервера|голосовой канал|голосовой|войс|текстовый канал)(\s+|$)/);
  if (km) { kind = km[1]; s = s.slice(km[0].length); }
  s = s.replace(/^(с|со|к|ко|для|на|в|во|от)\s+/, '').trim();
  return s ? { query: s, kind } : null;
}

function dsKind(k) {
  if (/сервер/.test(k)) return 'server';
  if (/(голосов|войс)/.test(k)) return 'voice';
  if (/канал/.test(k)) return 'channel';
  if (/(личк|лс|личн|чат|переписк|диалог|беседу|контакт)/.test(k)) return 'dm';
  return '';
}

/** Имена в косвенном падеже → основа для поиска по началу слова: «мамой» → «мам», «братом» → «брат» */
function stemQuery(q) {
  return norm(q).split(' ').map(w => (w.length >= 5 ? w.replace(/(ой|ей|ом|ем|ою|ею|ым|им|ах|ях|ам|ям|ов|ев|у|ю|е|ы|и|а|я)$/, '') : w)).join(' ');
}

// ---------------------------------------------------------------- браузер
const BROWSER = [
  [/^(новая вкладка|открой новую вкладку|новую вкладку)$/, 'newtab'],
  [/^(закрой|закрыть) (эту |текущую )?вкладку$/, 'closetab'],
  [/^(верни|восстанови|открой обратно|открой снова) (закрытую |последнюю )?вкладку$/, 'reopentab'],
  [/^(следующая|следующую) вкладк\S*$|^вкладка вправо$/, 'nexttab'],
  [/^(предыдущая|предыдущую) вкладк\S*$|^вкладка влево$/, 'prevtab'],
  [/^(назад|вернись назад|страница назад|на страницу назад)$/, 'back'],
  [/^(вперед|страница вперед)$/, 'forward'],
  [/^(обнови|обнови страницу|перезагрузи страницу|обновить страницу)$/, 'reload'],
  [/^((листай|прокрути|пролистай|промотай|мотай)( страницу)?( вниз)?|вниз)$/, 'down'],
  [/^((листай|прокрути|пролистай|промотай|мотай)( страницу)? вверх|вверх)$/, 'up'],
  [/^(в начало страницы|наверх|в самый верх)$/, 'top'],
  [/^(в конец страницы|в самый низ)$/, 'bottom'],
  [/^((увеличь|приблизь) (масштаб|страницу|шрифт)|крупнее)$/, 'zoomin'],
  [/^((уменьши|отдали) (масштаб|страницу|шрифт)|мельче)$/, 'zoomout'],
  [/^(обычный|нормальный|сбрось) масштаб$/, 'zoomreset'],
  [/^((открой |покажи )?историю браузера|история браузера)$/, 'history'],
  [/^(открой |покажи )?загрузки браузера$/, 'downloads'],
  [/^(открой )?(режим )?(инкогнито|приватный режим|приватное окно)$/, 'incognito'],
  [/^(добавь в закладки|в закладки|сохрани в закладки)$/, 'bookmark'],
  [/^(адресная строка|строка адреса)$/, 'address']
];

function ordinal(w) {
  if (/^[1-9]$/.test(w)) return +w;
  const O = [[/^(перв|один|одна)/, 1], [/^(втор|два|две)/, 2], [/^(трет|три)/, 3], [/^(четв|четыре)/, 4], [/^(пят|пять)/, 5], [/^(шест|шесть)/, 6], [/^(седьм|семь)/, 7], [/^(восьм|восемь)/, 8], [/^последн/, 9]];
  for (const [re, n] of O) if (re.test(w)) return n;
  return null;
}

// ---------------------------------------------------------------- погода и валюты
const WEATHER_FILLER = /(^|\s)(какая|какой|какое|какие|сейчас|будет|будут|ли|погода|погоду|погоде|погодка|погоды|прогноз|на|улице|сегодня|послезавтра|завтра|скажи|узнай|расскажи|там|а|ну|как|холодно|жарко|дождь|дожди|дождя|зонт|зонтик|снег|снега|сколько|градусов|нужен|брать|в|во|городе|город|мне|у|нас|пойдет|идет|ожидается|феликс)(?=\s|$)/g;
const CUR_WORDS = 'доллар\\S*|бакс\\S*|евро|юан\\S*|рубл\\S*|тенге|фунт\\S*|иен\\S*|йен\\S*|лир\\S*|гривн\\S*|франк\\S*|злот\\S*';
function curCode(w) {
  const C = [[/^(доллар|бакс)/, 'USD'], [/^евро/, 'EUR'], [/^юан/, 'CNY'], [/^рубл/, 'RUB'], [/^тенге/, 'KZT'], [/^фунт/, 'GBP'], [/^(иен|йен)/, 'JPY'], [/^лир/, 'TRY'], [/^гривн/, 'UAH'], [/^франк/, 'CHF'], [/^злот/, 'PLN']];
  for (const [re, c] of C) if (re.test(w)) return c;
  return null;
}

function parse(raw) {
  const t = norm(raw);
  let m;
  if (!t) return { intent: 'call' };

  // подтверждение / отмена
  if (/^(да|конечно|давай|подтверждаю|ага|угу|точно|выполняй)( да)?$/.test(t)) return { intent: 'yes' };
  if (/^(нет|не надо|отмена|отмени|стоп|не)$/.test(t)) return { intent: 'no' };

  // сам Феликс. Vosk часто слышит «спрячься» как «спрячешься» или «справишься» — принимаем и их (короткие фразы)
  const short = t.split(' ').length <= 4;
  // слово «спрячься» должно стоять в конце: «спрячь телеграм» — это уже про окно, а не про Феликса
  if (short && /(^|\s)(спряч\S*|спрят\S*|справишь\S*|справь\S*|скройся|скрой себя|исчезни|исчезнешь|сверн(ись|и себя)|уйди|уходи|отдохни|не мешай|убери себя|пропади|отойди|иди спать)( себя| пожалуйста| ненадолго| обратно| в шар| в сферу)?$/.test(t)) return { intent: 'self.hide' };
  if (short && /(^|\s)(покаж(ись|ешься|ись-ка)|появ\S*|по явись|вернись|вернешься|разверн(ись|и себя)|выйди|выходи|вылезай|вылези|где ты|ты где|иди сюда|покажи себя|проснись|приди|ты тут)( ко мне| пожалуйста| сюда| обратно)?$/.test(t)) return { intent: 'self.show' };
  if (/(опустись|спустись|пониже|(сядь|встань|стой) ниже|^ниже$)/.test(t)) return { intent: 'self.lift', delta: -40 };
  if (/(поднимись|повыше|(сядь|встань|стой) выше|^выше$)/.test(t)) return { intent: 'self.lift', delta: 40 };
  if (/((стань|сделайся) (больше|побольше|крупнее)|увеличься|подрасти)/.test(t)) return { intent: 'self.scale', delta: 0.1 };
  if (/((стань|сделайся) (меньше|поменьше)|уменьшись)/.test(t)) return { intent: 'self.scale', delta: -0.1 };
  if (/(станцуй|потанцуй|танцуй|потанцуем)/.test(t)) return { intent: 'self.dance' };
  if (/(помаши|махни)/.test(t)) return { intent: 'self.wave' };
  if (/(перейди|переместись|иди|встань|сядь) (влево|налево|в левый угол|слева)/.test(t)) return { intent: 'self.side', side: 'left' };
  if (/(перейди|переместись|иди|встань|сядь) (вправо|направо|в правый угол|справа)/.test(t)) return { intent: 'self.side', side: 'right' };
  if (/^(повтори|еще раз|что ты сказал|что-что|не расслышал|не расслышала)( пожалуйста)?$/.test(t)) return { intent: 'repeat' };

  // ---- гардероб: аксессуары надеваются руками, наряды меняются за ширмой
  if (/^(покажи|открой)( свой| мой| твой)? гардероб|^гардероб$/.test(t)) return { intent: 'wardrobe.open' };
  if (/(оденься|одевайся|переоденься|приоденься|оденься-ка) по погоде/.test(t)) return { intent: 'wardrobe.weather' };
  if (/^(что (на тебе|ты надел|у тебя надето)|как ты одет|какой (у тебя|твой|сегодня) (наряд|образ|прикид))/.test(t)) return { intent: 'wardrobe.what' };
  if (/^(сделай |давай |сделаем )?(селфи|сфоткайся|сфотографируйся|сфоткай себя|фото на память)/.test(t)) return { intent: 'selfie' };
  if ((m = t.match(/^(переоденься|переодевайся|приоденься|оденься|смени (?:наряд|одежду|прикид|образ|худи|костюм)|поменяй (?:наряд|одежду|прикид|образ|худи|костюм))(?:\s+(?:в|во|на)?\s*(.+))?$/))) {
    const o = m[2] ? wardrobeMatch(m[2], WCAT.outfits) : null;
    // «переоденься» — любой другой наряд; «переоденься в пижаму» (такого нет) — null, Феликс скажет, что нет
    return { intent: 'wardrobe.outfit', id: o ? o.id : m[2] && !/^(что-нибудь|что нибудь|другое|другой|любой|новое)/.test(m[2]) ? null : '', asked: m[2] || '' };
  }
  if ((m = t.match(/^(надень|одень|примерь|нацепи|напяль|возьми|достань)\s+(.+)$/))) {
    const rest = m[2];
    if (/^(что-нибудь|что нибудь|что-то|аксессуар|любой аксессуар|что хочешь|какой-нибудь аксессуар)/.test(rest)) return { intent: 'wardrobe.wear', id: '' };
    const a = wardrobeMatch(rest, WCAT.accessories), o = wardrobeMatch(rest, WCAT.outfits);
    if (/^(возьми|достань)$/.test(m[1]) && !(a && a.slot === 'hand')) { /* «возьми …» — не про гардероб */ }
    else {
      if (a && !(o && /(худи|наряд|костюм|одежд|кофт|прикид)/.test(rest))) return { intent: 'wardrobe.wear', id: a.id };
      if (o) return { intent: 'wardrobe.outfit', id: o.id, asked: rest };
      return { intent: 'wardrobe.wear', id: null, asked: rest };
    }
  }
  if ((m = t.match(/^(сними|снимай|убери|скинь)\s+(.+)$/))) {
    if (/^(все|всё|все аксессуары|аксессуары|все вещи|с себя все|с себя всё)$/.test(m[2])) return { intent: 'wardrobe.off', all: true };
    const a = wardrobeMatch(m[2], WCAT.accessories);
    if (a) return { intent: 'wardrobe.off', id: a.id };
    if (/^(шапку|шляпу|головной убор|с головы)/.test(m[2])) return { intent: 'wardrobe.off', slot: 'head' };
  }

  // ---- игры, помидор, напоминания, поддержка
  if (/камень,? ножниц|цу е фа|цуефа/.test(t)) return { intent: 'game.rps' };
  if ((m = wordsToDigits(t).match(/^(?:давай |сыграем |поиграем )*(?:в )?(?:загадай число|угадай число|угадайка)(?:\s+от\s+(\d+))?(?:\s+до\s+(\d+))?$/))) return { intent: 'game.guess', from: m[1] ? +m[1] : 1, to: m[2] ? +m[2] : 100 };
  if (/^(загадай|загадай мне|давай|расскажи)( мне)? загадк|^загадк/.test(t)) return { intent: 'game.riddle' };
  if (/^(давай поиграем|давай сыграем|поиграем|сыграем во что-нибудь|сыграем во что нибудь|поиграй со мной|мне скучно|во что поиграем)/.test(t)) return { intent: 'game.any' };
  if (/(помидор|помодоро|pomodoro)/.test(t)) {
    if (/(стоп|останови|выключи|отмени|хватит|закончи|прекрати)/.test(t)) return { intent: 'pomodoro.stop' };
    if (/(сколько|осталось)/.test(t)) return { intent: 'pomodoro.left' };
    return { intent: 'pomodoro.start' };
  }
  if ((m = t.match(/^(не |перестань |хватит |больше не )?(напоминай|напоминать)( мне)? (пить воду|про воду|о воде|попить|выпить воды|пить)/))) return { intent: 'remind.water', on: !m[1] };
  if ((m = t.match(/^(не |перестань |хватит |больше не )?(напоминай|напоминать)( мне)? (размяться|разминаться|про разминку|о разминке|делать разминку|вставать|встать|отдыхать|про перерыв)/))) return { intent: 'remind.stretch', on: !m[1] };
  if (/((скажи|сделай)( мне)? комплимент|подними( мне)? настроение|(за)?мотивируй|поддержи меня|похвали меня|мне грустно|мне плохо|подбодри)/.test(t)) return { intent: 'chat.cheer' };

  const ph = PHONE_RE.test(t);
  // ---- куда идёт звук: колонки / наушники / монитор
  if (!ph) {
    if ((m = t.match(/(наушник\S*|колонк\S*|динамик\S*|акустик\S*|монитор\S*|hdmi)/)) && /(звук|переключи|выведи|переведи|включи|сделай|давай|перекинь|верни)/.test(t) && !/(громче|тише|громкост|выключи звук|ресурс)/.test(t)) {
      return { intent: 'audio.output', target: m[1] };
    }
    if (/^(переключи звук|смени (устройство|выход) звука|другое устройство звука|переключи устройство звука)$/.test(t)) return { intent: 'audio.output', target: 'next' };
    if (/(куда (идет|выводится) звук|где (сейчас )?звук|откуда (идет )?звук)/.test(t)) return { intent: 'audio.output', which: true };
  }

  // ---- будильник: на телефоне, если «Феликс Link» на связи, иначе на компьютере
  if ((m = t.match(/^(поставь |заведи |установи |включи |сделай )?(будильник|разбуди меня)\s*(на телефоне\s*)?(.*)$/))) {
    const a = parseAlarm(m[4]);
    if (a) return { intent: 'alarm', ...a };
    return { intent: 'alarm', ask: true };
  }

  // ---- телефон («Феликс Link»): звонки, громкость, поиск, уведомления…
  if (/^(прими|ответь|возьми|подними|принять)( на)?( звонок| трубку| вызов| телефон)?$/.test(t)) return { intent: 'phone.answer' };
  if (/^(отклони|отбей|не отвечай|не бери|сбрось)( звонок| вызов)?$/.test(t)) return { intent: 'phone.decline' };
  if (/^(положи трубку|заверши звонок|закончи звонок|сбрось звонок|заверши вызов|закончи разговор)$/.test(t)) return { intent: 'phone.hangup' };
  if (/^((включи |поставь |давай )?(на )?громк\S*( связь)?|включи динамик)$/.test(t)) return { intent: 'phone.speaker', on: true };
  if (/^(выключи|убери|отключи) (громк\S*( связь)?|динамик)$/.test(t)) return { intent: 'phone.speaker', on: false };
  if (/^кто (звонит|там звонит|это звонит)$/.test(t)) return { intent: 'phone.who' };
  if (/(где (мой )?телефон|найди (мой )?телефон|потерял\S* (мой )?телефон|позвони на (мой )?телефон)/.test(t)) return { intent: 'phone.find', on: true };
  if (/^(нашел|нашла|я нашел|я нашла|нашел телефон|хватит звенеть|телефон нашелся|выключи звонок на телефоне)$/.test(t)) return { intent: 'phone.find', on: false };
  if (ph && /таймер/.test(t)) return { intent: 'phone.timer', seconds: parseDuration(t.replace(PHONE_RE, ' ').replace(/^.*таймер\s*(на)?\s*/, '')) };
  if (/(включи|выключи|отключи|убери) (режим )?(не беспокоить)/.test(t)) return { intent: 'phone.dnd', on: /включи/.test(t) };
  if (/^(прочитай|покажи|что в|какие) (последние )?(уведомлени\S*|сообщени\S* на телефоне)/.test(t)) return { intent: 'phone.notifs' };

  // ---- дела на телефоне: такси, доставка, маршрут, покупки (приложения выбирает пользователь в настройках)
  const tp = ph ? t.replace(PHONE_RE, ' ').replace(/\s+/g, ' ').trim() : t;
  if ((m = tp.match(/^(?:(?:вызови|закажи|вызвать|заказать|поймай|найди|нужно|нужен|хочу|давай|мне нужно|открой|запусти)\s+)?(?:мне\s+|нам\s+)?такси(?:\s+(.*))?$/))) {
    return { intent: 'phone.taxi', to: place(m[1] || '') };
  }
  if ((m = tp.match(/^(?:(?:проложи|построй|покажи|сделай|открой)\s+)?маршрут\s+((?:до|в|во|на|к|ко)\s+.+|домой)$/)) || (m = tp.match(/^как (?:доехать|добраться|дойти|пройти|проехать)\s+((?:до|в|во|на|к|ко)\s+.+|домой)$/)) ||
    (m = tp.match(/^(?:поехали|едем|веди меня|навигатор|навигация)\s+((?:до|в|во|на|к|ко)\s+.+|домой)$/))) return { intent: 'phone.route', to: place(m[1]) };
  if ((m = tp.match(/^(?:найди|покажи|открой|поищи)\s+(?:на карте|на картах|в картах)\s+(.+)$/)) || (m = tp.match(/^(?:найди|покажи|поищи)\s+(.+?)\s+на (?:карте|картах)$/))) return { intent: 'phone.map', query: m[1] };
  if ((m = tp.match(/^(?:закажи|купи|найди|поищи|ищи|посмотри)\s+(?:на|в|во)\s+(озон\S*|ozon|вайлдберриз\S*|валдберриз\S*|вайлдбериз\S*|вб|wildberries|маркете|яндекс маркете|алиэкспресс\S*|aliexpress|али|авито|амазон\S*)\s+(.+)$/))) return { intent: 'phone.shop', store: m[1], query: m[2] };
  if ((m = tp.match(/^купи(?:\s+мне)?\s+(.+)$/))) return { intent: 'phone.shop', query: m[1] };
  if (/^(открой|запусти|покажи)\s+(покупк\S*|магазин|маркетплейс\S*|шопинг)$/.test(tp)) return { intent: 'phone.shop', query: '', open: true };
  if (/^(хочу есть|я голоден|я голодна|я проголодал\S*|есть хочу|кушать хочу|что бы поесть|что поесть|доставка еды|открой доставку( еды)?|закажи (что-нибудь|что нибудь) (поесть|покушать))$/.test(tp)) return { intent: 'phone.food', query: '' };
  if ((m = tp.match(/^(?:закажи|заказать|закажем|давай закажем|хочу заказать|можешь заказать)\s+(.+)$/))) return { intent: 'phone.food', query: foodQuery(m[1]) };

  if (ph) {
    // экран телефона на компьютере и кнопки телефона
    if (/(выключи|погаси|заблокируй|блокировк\S*) (экран|телефон)|^(заблокируй|блокировка)$/.test(tp) || /(заблокируй|выключи экран|погаси экран)/.test(t)) return { intent: 'phone.nav', action: 'lock' };
    if (/(скриншот|снимок экрана|скрин)/.test(tp)) return { intent: 'phone.nav', action: 'screenshot' };
    if (/(экран телефон|телефон на (компьютере|экране|пк|мониторе)|управлени\S* телефон|пульт телефон|окно телефон|зеркал)/.test(t) || /^(покажи|открой) телефон$/.test(t)) return { intent: 'phone.panel' };
    if (/^(назад|вернись назад|нажми назад|кнопка назад)$/.test(tp)) return { intent: 'phone.nav', action: 'back' };
    if (/^(домой|на главный( экран)?|главный экран|на рабочий стол|рабочий стол|нажми домой|кнопка домой)$/.test(tp)) return { intent: 'phone.nav', action: 'home' };
    if (/^(недавние|последние приложения|обзор|все приложения|переключи приложение|открытые приложения)$/.test(tp)) return { intent: 'phone.nav', action: 'recents' };
    if (/^(открой |опусти |покажи )?(шторку|уведомления)$/.test(tp)) return { intent: 'phone.nav', action: 'notifications' };
    if (/^(включи экран|разбуди)$/.test(tp)) return { intent: 'phone.nav', action: 'wake' };
    if ((m = tp.match(/^(?:напиши|напечатай|введи|впиши)\s+(.+)$/))) return { intent: 'phone.type', text: m[1] };
    if (/(ссылк|это)/.test(tp) && /^(отправь|открой|скинь|перекинь)/.test(tp)) return { intent: 'phone.url' };
    if (/^(отправь|скинь|перекинь|скопируй) (текст|буфер\S*( обмена)?|скопированное)?$/.test(tp)) return { intent: 'phone.clip' };
    if ((m = tp.match(/^(?:включи|поставь|найди|запусти)\s+(?:трек|песню|музыку|альбом|исполнителя|группу)\s+(.+)$/))) return { intent: 'phone.music', query: m[1] };
    const stream = /звонк|рингтон/.test(t) ? 'ring' : 'music';
    if ((m = wordsToDigits(t).match(/громкость.*?(\d+)/))) return { intent: 'phone.volume', stream, level: +m[1] };
    if (/(громче|погромче|прибавь|увеличь)/.test(t)) return { intent: 'phone.volume', stream, delta: 15 };
    if (/(тише|потише|убавь|уменьши)/.test(t)) return { intent: 'phone.volume', stream, delta: -15 };
    if (/(выключи звук|без звука|беззвучн|отключи звук|убери звук)/.test(t)) return { intent: 'phone.ringer', mode: 'silent' };
    if (/вибр/.test(t)) return { intent: 'phone.ringer', mode: 'vibrate' };
    if (/(включи звук|верни звук|обычный режим|со звуком)/.test(t)) return { intent: 'phone.ringer', mode: 'normal' };
    if (/(заряд|батаре|аккумулятор)/.test(t)) return { intent: 'phone.battery' };
    if (/(пауза|останови)/.test(t)) return { intent: 'phone.media', action: 'pause' };
    if (/следующ/.test(t)) return { intent: 'phone.media', action: 'next' };
    if (/(предыдущ|прошл)/.test(t)) return { intent: 'phone.media', action: 'prev' };
    if (/(продолжи|включи музыку|играй)/.test(t)) return { intent: 'phone.media', action: 'play' };
    if ((m = t.match(/^(открой|запусти|включи)\s+(на|в)\s+(телефоне|смартфоне)\s+(.+)$/)) || (m = t.match(/^(открой|запусти|включи)\s+(.+?)\s+(на|в)\s+(телефоне|смартфоне)$/))) {
      return { intent: 'phone.open', app: (m[4] && !/телефоне|смартфоне/.test(m[4]) ? m[4] : m[2]).trim() };
    }
  }
  if ((m = t.match(/^(позвони|набери|звони|вызови|набери номер)\s+(.+)/)) && !PHONE_RE.test(m[2])) return { intent: 'phone.call', name: m[2].replace(/^(мне\s+)/, '').trim() };

  // таймеры и напоминания
  if (/(отмени|сбрось|выключи|убери|останови) (все )?(таймер|напоминани)/.test(t)) return { intent: 'timer.cancel' };
  if (/^(сколько осталось|сколько еще ждать|сколько до таймера)( времени)?$/.test(t)) return { intent: 'timer.left' };
  if ((m = t.match(/^напомни( мне)?\s+через\s+(.+)$/))) {
    // «напомни через десять минут выключить чайник»: самое длинное начало, которое заканчивается единицей времени
    const words = m[2].split(' ');
    for (let i = words.length; i >= 1; i--) {
      const head = words.slice(0, i).join(' ');
      if (/(час|часа|часов|минут\S*|секунд\S*|полчаса)$/.test(head) && parseDuration(head)) return { intent: 'timer', seconds: parseDuration(head), text: words.slice(i).join(' ').replace(/^(что|чтобы|про|о|об)\s+/, '') };
    }
    return { intent: 'timer', seconds: 0 };
  }
  if ((m = t.match(/^напомни( мне)?\s+(.+?)\s+через\s+(.+)$/)) && parseDuration(m[3])) return { intent: 'timer', seconds: parseDuration(m[3]), text: m[2].replace(/^(что|чтобы|про|о|об)\s+/, '') };
  if ((m = t.match(/(таймер|засеки|разбуди меня|будильник)\s*(на|через)?\s*(.*)/))) return { intent: 'timer', seconds: parseDuration(m[3]) };

  // ---- музыка: «включи трек группа крови» → поиск трека (YouTube Music или Яндекс Музыка, в настройках)
  if ((m = t.match(/^(включи|поставь|запусти|сыграй|играй|вруби|врубай|давай)\s+(трек|песню|песенку|композицию|музыку|песни)\s+(.+)/)) && !/^(громче|погромче|тише|потише|на паузу|дальше|снова)$/.test(m[3])) {
    return { intent: 'music.play', query: m[3].replace(/^(группы|исполнителя|певца|певицы)\s+/, '').trim() };
  }

  // ---- Telegram и Discord (раньше «выключи микрофон» самого Феликса и раньше общих «открой …»)
  if (/(микрофон|микро)/.test(t) && DS_RE.test(t)) return { intent: 'ds.key', key: 'mute' };
  if (/(звук|наушники|оглуши)/.test(t) && DS_RE.test(t)) return { intent: 'ds.key', key: 'deafen' };
  if (TG_RE.test(t) && /(избранное|сохраненн\S*|сохраненки)/.test(t)) return { intent: 'tg.saved' };
  let ct;
  if ((ct = chatTarget(t, TG_RE))) return { intent: 'tg.open', query: ct.query, kind: ct.kind };
  if ((ct = chatTarget(t, DS_RE))) return { intent: 'ds.open', query: ct.query, kind: dsKind(ct.kind) };
  if ((m = t.match(/^(зайди|подключись|войди)\s+(в|во)\s+(голосовой|войс)\s*(канал)?\s+(.+)/))) return { intent: 'ds.open', query: m[5], kind: 'voice' };
  if ((m = t.match(/^(открой|зайди на|перейди на)\s+сервер\s+(.+)/))) return { intent: 'ds.open', query: m[2], kind: 'server' };

  // ---- браузер и окна программ
  for (const [re, action] of BROWSER) if (re.test(t)) return { intent: 'browser', action };
  if ((m = t.match(/^(вкладка|открой вкладку|перейди на вкладку|переключись на вкладку)( номер)? (\S+)$/)) && ordinal(m[3])) return { intent: 'browser', action: 'tab', n: ordinal(m[3]) };
  if ((m = t.match(/^(найди|поищи|ищи) на (этой )?странице (.+)/))) return { intent: 'browser', action: 'find', query: m[3] };
  if ((m = t.match(/^((зайди|перейди|открой) (на )?сайт|открой в браузере|зайди на)\s+(.+)/))) return { intent: 'site', query: m[4] };
  if ((m = t.match(/^(напечатай|введи|набери|впиши)\s+(.+)/))) return { intent: 'type', text: m[2] };
  if ((m = t.match(/^(переключись|переключи|перейди|вернись|зайди)\s+(на|в|во|к)\s+(.+)/))) return { intent: 'focus', target: m[3] };
  if ((m = t.match(/^(сверни|спрячь|убери)\s+(.+)/)) && !/^(все|всё|это|окно|это окно|все окна|себя)$/.test(m[2])) return { intent: 'app.minimize', target: m[2] };
  if ((m = t.match(/^разверни\s+(.+)/)) && !/^(окно|это|это окно|на весь экран)$/.test(m[1])) return { intent: 'app.maximize', target: m[1] };

  // ---- погода, время в городах, валюты, справка
  if (/(погод|на улице|холодно|жарко|дожд|зонт|снег|сколько градусов)/.test(t) && !/(процессор|видеокарт|компьютер)/.test(t) && !/^(найди|поищи|открой|загугли|включи)\s/.test(t)) {
    const day = /послезавтра/.test(t) ? 2 : /завтра/.test(t) ? 1 : 0;
    const city = t.replace(WEATHER_FILLER, ' ').replace(/\s+/g, ' ').trim();
    return { intent: 'weather', city, day };
  }
  if ((m = t.match(/(который час|сколько времени|сколько сейчас времени|какое время|время)\s+(сейчас\s+)?(в|во)\s+(.+)/))) return { intent: 'time.city', city: m[4] };
  if (/(восход|закат|рассвет)/.test(t) && !/(тем[уаы]|оформлени|стиль)/.test(t)) return { intent: 'sun' };
  if ((m = wordsToDigits(t).match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s+(${CUR_WORDS})\\s+(в|на)\\s+(${CUR_WORDS})`)))) return { intent: 'currency', amount: parseFloat(m[1]), from: curCode(m[2]), to: curCode(m[4]) };
  if ((m = t.match(new RegExp(`(курс|сколько стоит|сколько стоят|почем)\\s+(${CUR_WORDS}|валют\\S*)`)))) return { intent: 'currency', amount: 1, from: curCode(m[2]), to: 'RUB' };
  if ((m = t.match(/^(что такое|кто такой|кто такая|кто такие|что значит|что означает|расскажи (мне )?(про|о|об))\s+(.+)/)) && !/^(себе|тебе|тебя)$/.test(m[4])) return { intent: 'wiki', query: m[4] };
  if (/(интересный факт|расскажи факт|удиви меня|какой-нибудь факт)/.test(t)) return { intent: 'fact' };
  if ((m = t.match(/сколько (дней )?(осталось )?(дней )?до\s+(.+)/))) return { intent: 'daysuntil', what: m[4] };

  // ---- заметки, файлы, буфер обмена, таймер выключения
  if ((m = t.match(/^(запиши|запомни|сделай заметку|добавь заметку|заметка)\s+(заметку\s+|что\s+)?(.+)/))) return { intent: 'note.add', text: m[3] };
  if (/^(прочитай|что в|что у меня в) (мои )?заметк/.test(t)) return { intent: 'note.read' };
  if (/^(открой|покажи) (мои )?заметки$/.test(t)) return { intent: 'note.open' };
  if (/(последн\S* (загрузк|скачанн|скачан|файл из загрузок)|что я (скачал|скачивал) последн)/.test(t)) return { intent: 'last.download' };
  if (/последн\S* (скриншот|снимок)/.test(t)) return { intent: 'last.screenshot' };
  if (/((прочитай|что в|что у меня в) буфер\S*( обмена)?|что я скопировал)/.test(t)) return { intent: 'clipboard' };
  if ((m = t.match(/(выключи|выключить|выключение) (компьютер|пк|комп)?\s*через\s+(.+)/)) && parseDuration(m[3])) return { intent: 'power.timer', seconds: parseDuration(m[3]) };
  if (/(отмени|отменить|отмена) (выключени|перезагрузк)/.test(t)) return { intent: 'power.cancel' };

  // калькулятор и случайности
  if ((m = t.match(/^(сколько будет|посчитай|вычисли|сосчитай|сколько)\s+(.+)/))) {
    const c = parseCalc(m[2]);
    if (c.result !== null || m[1] !== 'сколько') return { intent: 'calc', expr: c.expr, result: c.result };
  }
  if (/(подбрось|подкинь|брось) (монет|монетк)|орел или решка/.test(t)) return { intent: 'coin' };
  if (/(брось|кинь|подбрось) (кубик|кости|кость)/.test(t)) return { intent: 'dice' };
  if ((m = wordsToDigits(t).match(/(случайное число|загадай число)(?:\s+от\s+(\d+))?(?:\s+до\s+(\d+))?/))) return { intent: 'random', from: m[2] ? +m[2] : 1, to: m[3] ? +m[3] : 100 };

  // компьютер
  if (/(сколько (времени )?работает (компьютер|комп|пк|система)|время работы|аптайм)/.test(t)) return { intent: 'uptime' };
  if (/(сколько (свободного )?места|свободное место|место на диск|сколько на диске)/.test(t)) return { intent: 'disk' };
  if (/(сколько (свободной )?памяти|оперативн|оперативк)/.test(t)) return { intent: 'ram' };
  if (/((переключи|смени|поменяй) (раскладку|язык)|другой язык)/.test(t)) return { intent: 'layout' };
  if (/^((переключи|следующее|другое) окно|переключись|переключи)$/.test(t)) return { intent: 'alttab' };
  if (/((очисти|очистить|почисти) корзину|вынеси мусор)/.test(t)) return { intent: 'recycle.empty' };

  // интернет
  if ((m = t.match(/^(найди|поищи|включи|открой|покажи)\s+(на|в)\s+(ютубе|youtube|ю тубе)\s+(.+)/))) return { intent: 'youtube', query: m[4] };
  if ((m = t.match(/^(переведи|перевод)\s+(на английский\s+|на русский\s+)?(.+)/))) return { intent: 'translate', query: m[3], to: /русский/.test(m[2] || '') ? 'ru' : 'en' };
  if ((m = t.match(/^как (будет|сказать) (по-английски|по английски|на английском)\s+(.+)/))) return { intent: 'translate', query: m[3], to: 'en' };
  if (/(не слушай|выключи микрофон|перестань слушать)/.test(t)) return { intent: 'self.mute' };

  // тема оформления
  if ((m = t.match(/(смени|поменяй|поставь|включи)\s+(тему|оформление|стиль)\s*(на\s+)?(.*)/)) || (m = t.match(/^(тема)\s+(.*)/))) {
    const rest = m[4] ?? m[2] ?? '';
    const th = THEME_WORDS.find(x => x.re.test(rest));
    return { intent: 'theme', theme: th ? th.id : null };
  }

  // окна
  if (/(сверни все|покажи рабочий стол|убери все окна|сверни всё)/.test(t)) return { intent: 'win.minimizeAll' };
  if (/^(сверни)( это)?( окно)?$/.test(t)) return { intent: 'win.minimize' };
  if (/(разверни (окно|это)|на весь экран)/.test(t)) return { intent: 'win.maximize' };
  if (/^(закрой)( это| текущее)?( окно)?$/.test(t)) return { intent: 'win.close' };

  // громкость и музыка
  if (/(выключи звук|без звука|отключи звук|замолчи все)/.test(t)) return { intent: 'volume', mute: true };
  if (/(включи звук|верни звук)/.test(t)) return { intent: 'volume', mute: false };
  if ((m = t.match(/громкость\s+(на\s+)?(.+)/)) && num(m[2]) !== null) return { intent: 'volume', level: num(m[2]) };
  if (/(громче|погромче|прибавь|увеличь громкость)/.test(t)) return { intent: 'volume', delta: 10 };
  if (/(тише|потише|убавь|уменьши громкость)/.test(t)) return { intent: 'volume', delta: -10 };
  // музыка: любой плеер, который сейчас играет (системное управление медиа Windows)
  if (/^(следующ\S* (трек|песн\S*|композици\S*)|переключи (трек|песню|музыку)|другой трек|другую песню|пропусти( трек| песню| эту)?|скипни|некст|следующий|дальше)$/.test(t)) return { intent: 'media', action: 'next' };
  if (/^(предыдущ\S* (трек|песн\S*|композици\S*)|прошл\S* (трек|песн\S*)|верни (трек|песню|прошлый трек|предыдущий трек|прошлую песню)|предыдущий)$/.test(t)) return { intent: 'media', action: 'prev' };
  if (/^(пауза|на паузу|поставь на паузу|поставь (музыку|трек|песню) на паузу|останови (музыку|трек|песню|видео|воспроизведение)|выключи музыку|стоп музыка|хватит музыки|музыку на паузу)$/.test(t)) return { intent: 'media', action: 'pause' };
  if (/^(продолжи|продолжай|играй|включи музыку|продолжи (музыку|играть|воспроизведение|трек)|сними с паузы|сними паузу|убери паузу|сыграй)$/.test(t)) return { intent: 'media', action: 'play' };
  if (/(что (сейчас |это )?(играет|за трек|за песня|звучит)|как называется (эта |этот )?(песня|трек)|какой (сейчас )?трек)/.test(t)) return { intent: 'media', action: 'info' };

  // питание
  if (/(выключи (компьютер|пк|комп)|заверши работу|выключение)/.test(t)) return { intent: 'power', action: 'shutdown', confirm: true };
  if (/(перезагрузи|перезагрузка|перезапусти (компьютер|пк|комп))/.test(t)) return { intent: 'power', action: 'restart', confirm: true };
  if (/(спящий режим|усыпи|в сон|режим сна)/.test(t)) return { intent: 'power', action: 'sleep', confirm: true };
  if (/(заблокируй|блокировка|блокируй)/.test(t)) return { intent: 'power', action: 'lock' };

  // снимок экрана
  if (/(скриншот|снимок экрана|сфоткай экран|скрин)/.test(t)) return { intent: 'screenshot' };

  // поиск
  if ((m = t.match(/(найди|поищи|загугли|спроси)\s+(в|во)\s+(интернете|сети|гугле|яндексе|браузере)\s+(.+)/))) return { intent: 'web', query: m[4] };
  if ((m = t.match(/^(загугли|погугли)\s+(.+)/))) return { intent: 'web', query: m[2] };
  if ((m = t.match(/^(найди|поищи|где лежит|где находится|где мой|где моя|где мои)\s+(файл|файлы|папку|документ|фото|картинку)?\s*(.*)/))) return { intent: 'find', query: m[3] || '' };

  // информация
  if (/(который час|сколько времени|сколько сейчас времени|время сейчас)/.test(t)) return { intent: 'time' };
  if (/(какое (сегодня )?число|какой (сегодня )?день|какая (сегодня )?дата|какое сегодня)/.test(t)) return { intent: 'date' };
  if (/(температур|нагрузк|как (там )?(компьютер|система|процессор|видеокарта|комп)|состояние (системы|компьютера)|вентилятор|кулер)/.test(t)) return { intent: 'status' };

  // открыть / закрыть
  if ((m = t.match(/^(открой|запусти|включи|покажи|открыть|запустить)\s+(.+)/))) return { intent: 'open', target: m[2] };
  if ((m = t.match(/^(закрой|выключи|заверши|убей)\s+(.+)/))) return { intent: 'close', target: m[2] };

  // Claude
  if ((m = t.match(/^(спроси|спросить)\s+(у\s+)?(клода|клод|claude|клауда|клауд|нейросеть|нейросети|ии|искусственного интеллекта|чат бота)\s*(.*)/))) return { intent: 'ai', query: m[4] };

  // разговор
  if (/^(привет|здравствуй|здравствуйте|хай|приветик|доброе утро|добрый день|добрый вечер)/.test(t)) return { intent: 'chat.hello' };
  if (/(как дела|как ты|как поживаешь|как настроение)/.test(t)) return { intent: 'chat.how' };
  if (/(кто ты|как тебя зовут|ты кто|представься|расскажи о себе|расскажи про себя)/.test(t)) return { intent: 'chat.who' };
  if (/(что ты умеешь|помощь|помоги|что ты можешь|команды)/.test(t)) return { intent: 'chat.help' };
  if (/(спасибо|благодарю|спс|молодец|умница)/.test(t)) return { intent: 'chat.thanks' };
  if (/(ты (лучший|крутой|классный|милый|красавчик)|люблю тебя|красавчик|няшка)/.test(t)) return { intent: 'chat.compliment' };
  if (/(спокойной ночи|пока|до свидания|я ухожу|я спать)/.test(t)) return { intent: 'chat.bye' };
  if (/(расскажи шутку|пошути|анекдот)/.test(t)) return { intent: 'chat.joke' };
  if (/(почему (тебя зовут|ты) феликс|что значит (твое имя|феликс)|откуда (твое )?имя)/.test(t)) return { intent: 'chat.name' };

  return { intent: 'unknown', text: t };
}

// Встроенные цели для «открой ...»
const SPECIAL = [
  { re: /^(загрузк)/, kind: 'folder', folder: 'downloads', name: 'Загрузки' },
  { re: /^(документ)/, kind: 'folder', folder: 'documents', name: 'Документы' },
  { re: /^(рабоч(ий|его) стол)/, kind: 'folder', folder: 'desktop', name: 'Рабочий стол' },
  { re: /^(изображени|картинк|фото|фотограф|галере)/, kind: 'folder', folder: 'pictures', name: 'Изображения' },
  { re: /^(музык)/, kind: 'folder', folder: 'music', name: 'Музыка' },
  { re: /^(видео)/, kind: 'folder', folder: 'videos', name: 'Видео' },
  { re: /^(корзин)/, kind: 'shell', target: 'shell:RecycleBinFolder', name: 'Корзина' },
  { re: /^(этот компьютер|мой компьютер|компьютер|диски)/, kind: 'shell', target: 'shell:MyComputerFolder', name: 'Этот компьютер' },
  { re: /^(диск)\s*([a-zа-я])/, kind: 'drive', name: 'Диск' },
  { re: /^(проводник|папк)/, kind: 'path', target: 'explorer.exe', name: 'Проводник' },
  { re: /^(настройки (феликса|феликс|ассистента|помощника|оформлени|темы)|твои настройки|свои настройки)/, kind: 'settings', name: 'Настройки Феликса' },
  { re: /^((настройки|параметры) (звука|звук)|микшер)/, kind: 'uri', target: 'ms-settings:sound', name: 'Настройки звука' },
  { re: /^(настройки|параметры) (экрана|дисплея|монитор)/, kind: 'uri', target: 'ms-settings:display', name: 'Настройки экрана' },
  { re: /^((настройки|параметры) )?(блютуз|блютус|bluetooth)/, kind: 'uri', target: 'ms-settings:bluetooth', name: 'Bluetooth' },
  { re: /^(настройки|параметры) (сети|интернета|вай ?фая|wi-?fi)/, kind: 'uri', target: 'ms-settings:network-status', name: 'Настройки сети' },
  { re: /^((настройки|центр) обновлени|обновлени)/, kind: 'uri', target: 'ms-settings:windowsupdate', name: 'Центр обновления Windows' },
  { re: /^(настройки|параметры) (приложений|программ)|^(установка и )?удаление программ/, kind: 'uri', target: 'ms-settings:appsfeatures', name: 'Приложения' },
  { re: /^(настройки|параметры) (мыши|мышки)/, kind: 'uri', target: 'ms-settings:mousetouchpad', name: 'Настройки мыши' },
  { re: /^(настройки|параметры) (клавиатуры|языка|раскладки)/, kind: 'uri', target: 'ms-settings:regionlanguage', name: 'Язык и раскладка' },
  { re: /^((настройки|параметры) )?(принтер)/, kind: 'uri', target: 'ms-settings:printers', name: 'Принтеры' },
  { re: /^(настройки|параметры) (питания|электропитания|сна)/, kind: 'uri', target: 'ms-settings:powersleep', name: 'Питание' },
  { re: /^(настройки|параметры) (уведомлений)/, kind: 'uri', target: 'ms-settings:notifications', name: 'Уведомления' },
  { re: /^(настройки|параметры) (времени|даты)/, kind: 'uri', target: 'ms-settings:dateandtime', name: 'Дата и время' },
  { re: /^(диспетчер устройств)/, kind: 'path', target: 'C:\\Windows\\System32\\devmgmt.msc', name: 'Диспетчер устройств' },
  { re: /^(управление дисками)/, kind: 'path', target: 'C:\\Windows\\System32\\diskmgmt.msc', name: 'Управление дисками' },
  { re: /^(службы)/, kind: 'path', target: 'C:\\Windows\\System32\\services.msc', name: 'Службы' },
  { re: /^(монитор ресурсов)/, kind: 'path', target: 'C:\\Windows\\System32\\resmon.exe', name: 'Монитор ресурсов' },
  { re: /^(очистк[уа] диска)/, kind: 'path', target: 'C:\\Windows\\System32\\cleanmgr.exe', name: 'Очистка диска' },
  { re: /^(сведения о системе)/, kind: 'path', target: 'C:\\Windows\\System32\\msinfo32.exe', name: 'Сведения о системе' },
  { re: /^(ножницы)/, kind: 'aumid', target: 'Microsoft.ScreenSketch_8wekyb3d8bbwe!App', name: 'Ножницы' },
  { re: /^(настройки|параметры)( windows| виндовс| системы| компьютера)?$/, kind: 'uri', target: 'ms-settings:', name: 'Параметры Windows' },
  { re: /^(панель управления)/, kind: 'path', target: 'control.exe', name: 'Панель управления' },
  { re: /^(диспетчер задач)/, kind: 'path', target: 'taskmgr.exe', name: 'Диспетчер задач' },
  { re: /^(терминал|командн(ую|ая) строк|консол|powershell|пауэршелл)/, kind: 'aumid', target: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App', fallback: 'cmd.exe', name: 'Терминал' },
  { re: /^(блокнот)/, kind: 'path', target: 'notepad.exe', name: 'Блокнот' },
  { re: /^(калькулятор)/, kind: 'aumid', target: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App', fallback: 'calc.exe', name: 'Калькулятор' },
  { re: /^(paint|пейнт|рисовалк)/, kind: 'aumid', target: 'Microsoft.Paint_8wekyb3d8bbwe!App', fallback: 'mspaint.exe', name: 'Paint' },
  { re: /^(браузер|интернет|edge|эдж|эйдж)/, kind: 'aumid', target: 'MSEdge', name: 'Microsoft Edge' },
  { re: /^(магазин|microsoft store|стор)/, kind: 'uri', target: 'ms-windows-store:', name: 'Microsoft Store' },
  { re: /^(поиск|поисковик|поиск файлов)$/, kind: 'search', name: 'Поиск' },
  { re: /^(все приложения|приложения|меню пуск|пуск)/, kind: 'shell', target: 'shell:AppsFolder', name: 'Все приложения' },
  { re: /^(клод|claude|клауд|клауди)/, kind: 'app', target: 'Claude', name: 'Claude' },
  { re: /^(ютуб|youtube|ю туб)/, kind: 'url', target: 'https://www.youtube.com', name: 'YouTube' },
  { re: /^(вк|вконтакте|в контакте)/, kind: 'url', target: 'https://vk.com', name: 'ВКонтакте' },
  { re: /^(гугл|google)/, kind: 'url', target: 'https://www.google.com', name: 'Google' },
  { re: /^(яндекс)/, kind: 'url', target: 'https://ya.ru', name: 'Яндекс' },
  { re: /^(гитхаб|github)/, kind: 'url', target: 'https://github.com', name: 'GitHub' },
  { re: /^(твич|twitch)/, kind: 'url', target: 'https://www.twitch.tv', name: 'Twitch' },
  { re: /^(почт)/, kind: 'url', target: 'https://mail.google.com', name: 'Почта' },
  { re: /^(переводчик)/, kind: 'url', target: 'https://translate.google.com', name: 'Переводчик' },
  { re: /^(википеди|вики)/, kind: 'url', target: 'https://ru.wikipedia.org', name: 'Википедию' },
  { re: /^(кинопоиск)/, kind: 'url', target: 'https://www.kinopoisk.ru', name: 'Кинопоиск' },
  { re: /^(карты|карту|яндекс карты)/, kind: 'url', target: 'https://yandex.ru/maps', name: 'Карты' },
  { re: /^(озон|ozon)/, kind: 'url', target: 'https://www.ozon.ru', name: 'Озон' },
  { re: /^(вайлдберриз|валберис|вайлдбериз|wildberries)/, kind: 'url', target: 'https://www.wildberries.ru', name: 'Wildberries' },
  { re: /^(чат ?гпт|chatgpt)/, kind: 'url', target: 'https://chatgpt.com', name: 'ChatGPT' },
  { re: /^(клод в браузере|claude ai)/, kind: 'url', target: 'https://claude.ai', name: 'Claude в браузере' }
];

const ALIASES = {
  'телеграм': 'telegram', 'телеграмм': 'telegram', 'тг': 'telegram', 'дискорд': 'discord', 'стим': 'steam', 'стим клиент': 'steam',
  'обс': 'obs', 'винрар': 'winrar', 'фотошоп': 'photoshop', 'хром': 'chrome', 'гугл хром': 'chrome', 'фаерфокс': 'firefox',
  'ворд': 'word', 'эксель': 'excel', 'пауэрпоинт': 'powerpoint', 'вс код': 'visual studio code', 'визуал студио код': 'visual studio code',
  'спотифай': 'spotify', 'вэлорант': 'valorant', 'валорант': 'valorant', 'кс': 'counter-strike', 'контра': 'counter-strike',
  'роблокс': 'roblox', 'майнкрафт': 'minecraft', 'эпик': 'epic games', 'убисофт': 'ubisoft', 'фейсит': 'faceit',
  'яндекс музыка': 'яндекс.музыка', 'вк музыка': 'vk', 'ножницы': 'ножницы', 'камера': 'камера', 'медиаплеер': 'медиаплеер',
  'фотографии': 'фотографии', 'часы': 'часы', 'записки': 'записки', 'пайчарм': 'pycharm', 'андроид студио': 'android studio',
  'врод': 'vroid', 'вроид': 'vroid', 'обои': 'wallpaper engine', 'валлпейпер': 'wallpaper engine',
  'ютуб': 'youtube', 'ю туб': 'youtube', 'ватсап': 'whatsapp', 'вотсап': 'whatsapp', 'ватсапп': 'whatsapp', 'инстаграм': 'instagram', 'инста': 'instagram',
  'тикток': 'tiktok', 'тик ток': 'tiktok', 'вайбер': 'viber', 'нетфликс': 'netflix', 'кинопоиск': 'кинопоиск', 'шазам': 'shazam',
  'гугл карты': 'maps', 'карты': 'карты', 'галерея': 'галерея', 'хром браузер': 'chrome', 'опера': 'opera', 'яндекс браузер': 'yandex'
};

/** Нечёткий поиск приложения по названию среди apps [{name,id}] */
function matchApp(query, apps) {
  const q = norm(query).replace(/^(приложение|программу|программа|игру|игра)\s+/, '');
  if (!q) return null;
  const candidates = [q, ALIASES[q], translit(q)].filter(Boolean);
  let best = null, bestScore = 0;
  for (const a of apps) {
    const n = norm(a.name);
    for (const c of candidates) {
      let s = 0;
      if (n === c) s = 100;
      else if (n.startsWith(c)) s = 80;
      else if (n.includes(c)) s = 60;
      else if (c.length >= 4 && c.includes(n) && n.length >= 4) s = 50;
      else {
        const sim = similarity(n, c);
        if (sim > 0.72) s = 40 * sim;
      }
      if (/(uninstall|удал|manual|documentation|readme|help|справк)/.test(n)) s -= 30;
      if (s > bestScore) { bestScore = s; best = a; }
    }
  }
  return bestScore >= 30 ? best : null;
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

/** «Покупки», «доставку», «такси», «навигатор» — дела телефона (раздел «Телефон» в настройках) */
function serviceWord(target) {
  const t = norm(target);
  if (/^(покупк\S*|магазин\S*|маркетплейс\S*|шопинг)$/.test(t)) return 'shop';
  if (/^(доставк\S*( еды)?|еду|еда|ед[уы] на дом)$/.test(t)) return 'food';
  if (/^(такси|таксишк\S*)$/.test(t)) return 'taxi';
  if (/^(карт[уыа]|навигатор\S*|навигаци\S*)$/.test(t)) return 'maps';
  return null;
}

/** Варианты названия программы для поиска окна: как сказано, по словарю, латиницей */
function candidates(target) {
  const t = norm(target);
  const out = [t, ALIASES[t], translit(t)];
  if (t.length > 4) out.push(ALIASES[t.slice(0, -1)]);           // «телеграма», «дискорда»
  if (ALIASES[t]) out.push(translit(ALIASES[t]));
  return [...new Set(out.filter(Boolean))];
}

function special(target) {
  const t = norm(target);
  for (const s of SPECIAL) {
    const m = t.match(s.re);
    if (m) {
      if (s.kind === 'drive') return { ...s, target: (RU2LAT[m[2]] || m[2]).toUpperCase().slice(0, 1) + ':\\' };
      return s;
    }
  }
  return null;
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const SAY = {
  call: ['Слушаю! Что сделать?', 'Да? Я слушаю.', 'Я здесь. Что нужно?'],
  hello: n => [`Привет${n ? ', ' + n : ''}! Рад тебя видеть.`, `Здравствуй${n ? ', ' + n : ''}! Чем займёмся?`, 'Хей! Я на месте.'],
  how: ['Отлично! Компьютер в порядке, я на подхвате. А у тебя как?', 'Всё хорошо. Сегодня мне везёт, значит, и тебе повезёт!', 'Бодро! Готов помогать.'],
  who: ['Я Феликс, твой ассистент на рабочем столе. Открываю программы, ищу файлы, слежу за погодой, таймерами и музыкой, а сложные вопросы задаю нейросети.', 'Меня зовут Феликс. Живу в уголке экрана и помогаю с компьютером голосом.'],
  name: ['Феликс по-латыни значит «удачливый». Так что со мной тебе будет везти!', 'Феликс — значит «счастливый». Поэтому у меня на худи клевер.'],
  help: ['Скажи «Феликс», а потом команду. Например: открой загрузки, найди файл отчёт, громче, какая погода, сверни все окна, спрячься. А ещё: таймер на пять минут, напомни через час позвонить маме, будильник на семь тридцать, сколько будет двенадцать на семь, сколько места на диске, найди на ютубе музыку, подбрось монетку. Погода в любом городе: погода в Казани завтра. Браузер: новая вкладка, назад, листай вниз, зайди на хабр. Телеграм и Дискорд: открой в телеграме чат с мамой. Окна: сверни телеграм, переключись на браузер. Музыка: включи трек, пауза, следующий трек. Телефон: закажи пиццу, вызови такси до работы, маршрут до вокзала, покажи экран телефона. Сложные вопросы я передам нейросети.'],
  dance: ['Опа! Только никому не показывай.', 'Смотри, как умею!', 'Танцую, пока никто не видит.'],
  cheer: n => [`${n ? n + ', ты' : 'Ты'} справляешься лучше, чем думаешь. Правда!`, 'Знаешь, что общего у тебя и четырёхлистного клевера? Вы оба приносите удачу.', 'Ты сегодня молодец. Даже если кажется, что нет — я-то вижу.',
    'Маленький шаг — тоже шаг. Давай сделаем ещё один, а я посижу рядом.', 'Если бы у меня было три желания, одно ушло бы на то, чтобы у тебя всё получилось. Хотя ты и так справишься.', 'Сделай глубокий вдох. Готово? Ты уже немного сильнее, чем минуту назад.',
    'У тебя отличный вкус: ты выбрал меня в помощники!', 'Всё получится. Я, конечно, ассистент, но в людях разбираюсь.'],
  petted: ['Хи-хи, щекотно!', 'Ой, мне нравится!', 'Мур… то есть, спасибо!', 'Ещё, ещё! Шучу. Но можно.', 'Это так трогательно.', 'Удача увеличена на десять процентов!', 'Ммм, приятно. Причёску только не растрепи!', 'Всё, теперь у меня отличное настроение.'],
  dropped: ['Ух! Вот это полёт!', 'Мягкая посадка! Почти.', 'Голова кружится… Но было весело!', 'Эй, я не мячик! Хотя… ещё раз?', 'Приземлился! Где это я?'],
  riddles: [
    ['Зимой и летом одним цветом.', ['ель', 'елка', 'ёлка', 'сосна']], ['Сидит дед, во сто шуб одет. Кто его раздевает, тот слёзы проливает.', ['лук', 'луковица']],
    ['Не лает, не кусает, а в дом не пускает.', ['замок']], ['Без окон, без дверей, полна горница людей.', ['огурец', 'тыква']],
    ['Что можно увидеть с закрытыми глазами?', ['сон', 'сны']], ['Чем больше из неё берёшь, тем больше она становится.', ['яма']],
    ['У кого есть шляпа, но нет головы, есть нога, но нет ботинка?', ['гриб']], ['Висит груша — нельзя скушать.', ['лампочка', 'лампа']],
    ['Что принадлежит тебе, но другие пользуются этим чаще?', ['имя']], ['Его бросают, когда он нужен, и поднимают, когда не нужен.', ['якорь']],
    ['Сто одёжек — и все без застёжек.', ['капуста', 'кочан']], ['Что идёт, не двигаясь с места?', ['время', 'часы']],
    ['Какой клавишей можно открыть любую дверь в программе?', ['enter', 'ентер', 'энтер', 'ввод']], ['Четыре листа, а не книга; приносит удачу, а не почтальон.', ['клевер']]
  ],
  facts: [
    'Имя Феликс происходит от латинского felix — «счастливый, удачливый».',
    'Найти четырёхлистный клевер — примерно один шанс из пяти тысяч.',
    'Первый компьютерный «баг» был настоящим мотыльком, застрявшим в реле компьютера Mark II в 1947 году.',
    'Осьминог имеет три сердца и голубую кровь.',
    'Мёд не портится: съедобный мёд находили в египетских гробницах возрастом три тысячи лет.',
    'Свет от Солнца идёт до Земли примерно восемь минут двадцать секунд.',
    'В одном грамме ДНК можно записать около двухсот пятнадцати петабайт данных.',
    'Банан с точки зрения ботаники — ягода, а клубника — нет.',
    'Самая короткая война в истории, между Англией и Занзибаром, длилась меньше сорока минут.',
    'У улитки может быть больше двадцати тысяч зубов.'
  ],
  wave: ['Привет-привет!', 'Машу тебе!', 'Я тут!'],
  thanks: ['Всегда пожалуйста!', 'Рад помочь!', 'Обращайся в любое время.'],
  compliment: ['Эй, спасибо! Ты тоже ничего.', 'Стараюсь!', 'Ну всё, теперь я загордился.'],
  bye: ['Спокойной ночи! Я посторожу компьютер.', 'До встречи! Я буду здесь.'],
  joke: ['Почему программисты путают Хэллоуин и Рождество? Потому что тридцать один в восьмеричной — это двадцать пять в десятичной.', 'Говорят, мне всегда везёт. Но пароль от вайфая я всё равно угадать не могу.', 'Я хотел рассказать шутку про оперативную память, но забыл.'],
  unknown: ['Хм, не понял. Повтори, пожалуйста?', 'Такой команды я не знаю. Скажи «что ты умеешь», и я подскажу.'],
  hide: ['Хорошо, спрячусь. Позови, если понадоблюсь.', 'Ухожу. Скажи «Феликс, покажись», и я вернусь.'],
  show: ['Я тут!', 'Вернулся!', 'Ку-ку! Я снова здесь.'],
  opened: n => [`Открываю ${n}.`, `${n} — уже открываю.`, `Секунду, запускаю ${n}.`],
  notFound: n => [`Не нашёл приложение «${n}».`, `Хм, «${n}» на компьютере не вижу.`],
  confirm: { shutdown: 'Точно выключить компьютер? Скажи «да».', restart: 'Перезагрузить компьютер? Скажи «да».', sleep: 'Отправить компьютер в сон? Скажи «да».' },
  cancelled: ['Хорошо, отменяю.', 'Отменил.'],
  welcomeBack: n => [`С возвращением${n ? ', ' + n : ''}! Я тут немного погулял по рабочему столу.`, 'О, ты вернулся! Я ничего не трогал. Почти.', `${n ? n + ', я' : 'Я'} уже заскучал!`],
  greetBoot: n => [`Привет${n ? ', ' + n : ''}! Феликс на связи.`, `С возвращением${n ? ', ' + n : ''}. Я рядом, если что.`, `Хей${n ? ', ' + n : ''}! Компьютер загружен, удача включена.`]
};

module.exports = { parse, wake, norm, matchApp, special, translit, SAY, pick, candidates, serviceWord, similarity, spellDuration, sayNumber, plural, wordsToDigits, parseDuration, parseCalc, stemQuery, parseAlarm };
