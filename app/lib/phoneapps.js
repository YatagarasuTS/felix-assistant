// Дела на телефоне: доставка еды, такси, карты, покупки, музыка («Феликс Link» 1.1+).
// Какое приложение открывать, выбирает пользователь (Настройки → Телефон → «Приложения для дел»).
// Здесь — известные приложения (их предлагаем первыми) и их ссылки для телефона (deep links).
// Любое другое приложение тоже подойдёт: Феликс его запустит и впишет запрос в поиск (служба спец. возможностей).
// В ссылках: {q} — запрос, {addr} — адрес, {lat}/{lon} — координаты адреса (их находит геокодер телефона).

const CATS = {
  food: {
    name: 'Доставка еды', gen: 'приложений доставки еды', icon: '🍕',
    kw: /(еда|еду|food|eats|delivery|доставк|пицц|pizza|суши|sushi|ролл|бургер|burger|kfc|rostic|додо|dodo|самокат|лавка|вкусвилл|купер|kuper|кухн|ресторан|wolt|glovo|шаурм|шаверм)/i,
    apps: [
      ['ru.foodfox.client', 'Яндекс Еда'], ['com.deliveryclub', 'Delivery Club'], ['ru.sbcs.store', 'Самокат'], ['com.yandex.lavka', 'Яндекс Лавка'],
      ['ru.instamart', 'Купер'], ['ru.vkusvill', 'ВкусВилл'], ['ru.dodopizza.app', 'Додо Пицца'], ['com.ubercab.eats', 'Uber Eats'],
      ['com.glovo', 'Glovo'], ['com.wolt.android', 'Wolt'], ['com.dd.doordash', 'DoorDash']
    ],
    links: {}
  },
  taxi: {
    name: 'Такси', gen: 'приложений такси', icon: '🚕',
    kw: /(такси|taxi|uber|bolt|indrive|indriver|максим|maxim|ситимобил|citymobil|lyft|yandex go|яндекс go|\bgo\b)/i,
    apps: [
      ['ru.yandex.taxi', 'Яндекс Go'], ['com.ubercab', 'Uber'], ['ee.mtakso.client', 'Bolt'], ['sinet.startup.inDriver', 'inDrive'],
      ['com.taxsee.taxsee', 'Максим'], ['com.lyft.android', 'Lyft']
    ],
    links: {
      'ru.yandex.taxi': ['yandextaxi://route?end-lat={lat}&end-lon={lon}&level=econom'],
      'com.ubercab': ['uber://?action=setPickup&pickup=my_location&dropoff[latitude]={lat}&dropoff[longitude]={lon}&dropoff[formatted_address]={addr}'],
      'com.lyft.android': ['lyft://ridetype?id=lyft&destination[latitude]={lat}&destination[longitude]={lon}']
    }
  },
  maps: {
    name: 'Карты и навигатор', gen: 'карт и навигаторов', icon: '🗺️',
    kw: /(карт|maps|навигат|navi|2гис|2gis|дубльгис|waze|osmand|gps)/i,
    apps: [
      ['ru.yandex.yandexmaps', 'Яндекс Карты'], ['ru.yandex.yandexnavi', 'Яндекс Навигатор'], ['com.google.android.apps.maps', 'Google Карты'],
      ['ru.dublgis.dgismobile', '2ГИС'], ['com.waze', 'Waze'], ['net.osmand', 'OsmAnd'], ['net.osmand.plus', 'OsmAnd+']
    ],
    // route — маршрут до адреса, place — найти место
    links: {
      'ru.yandex.yandexmaps': { route: ['yandexmaps://maps.yandex.ru/?rtext=~{lat},{lon}&rtt=auto'], place: ['yandexmaps://maps.yandex.ru/?text={q}'] },
      'ru.yandex.yandexnavi': { route: ['yandexnavi://build_route_on_map?lat_to={lat}&lon_to={lon}'], place: ['yandexnavi://map_search?text={q}'] },
      'com.google.android.apps.maps': { route: ['google.navigation:q={lat},{lon}', 'google.navigation:q={addr}'], place: ['geo:0,0?q={q}'] },
      'ru.dublgis.dgismobile': { route: ['dgis://2gis.ru/routeSearch/rsType/car/to/{lon},{lat}'], place: ['dgis://2gis.ru/search/{q}'] },
      'com.waze': { route: ['waze://?ll={lat},{lon}&navigate=yes', 'waze://?q={addr}&navigate=yes'], place: ['waze://?q={q}'] },
      '*': { route: ['geo:{lat},{lon}?q={lat},{lon}', 'geo:0,0?q={addr}'], place: ['geo:0,0?q={q}'] }
    }
  },
  shop: {
    name: 'Покупки', gen: 'магазинов', icon: '🛒',
    kw: /(ozon|озон|wildberries|вайлдберриз|маркет|market|aliexpress|алиэкспресс|авито|avito|amazon|мегамаркет|lamoda|ламода|shop|магазин)/i,
    apps: [
      ['ru.ozon.app.android', 'Ozon'], ['com.wildberries.ru', 'Wildberries'], ['ru.beru.android', 'Яндекс Маркет'],
      ['com.alibaba.aliexpresshd', 'AliExpress'], ['com.avito.android', 'Авито'], ['com.amazon.mShop.android.shopping', 'Amazon']
    ],
    links: {
      'ru.ozon.app.android': ['https://www.ozon.ru/search/?text={q}'],
      'com.wildberries.ru': ['https://www.wildberries.ru/catalog/0/search.aspx?search={q}'],
      'ru.beru.android': ['https://market.yandex.ru/search?text={q}'],
      'com.alibaba.aliexpresshd': ['https://aliexpress.ru/wholesale?SearchText={q}', 'https://www.aliexpress.com/wholesale?SearchText={q}'],
      'com.avito.android': ['https://www.avito.ru/all?q={q}'],
      'com.amazon.mShop.android.shopping': ['https://www.amazon.com/s?k={q}']
    }
  },
  music: {
    name: 'Музыка', gen: 'музыкальных приложений', icon: '🎵',
    kw: /(music|музык|spotify|спотифай|звук|zvuk|boom|deezer|soundcloud)/i,
    apps: [
      ['ru.yandex.music', 'Яндекс Музыка'], ['com.spotify.music', 'Spotify'], ['com.google.android.apps.youtube.music', 'YouTube Music'],
      ['com.uma.musicvk', 'VK Музыка'], ['com.zvooq.openplay', 'Звук'], ['com.apple.android.music', 'Apple Music']
    ],
    links: {
      'ru.yandex.music': ['https://music.yandex.ru/search?text={q}'],
      'com.spotify.music': ['spotify:search:{q}'],
      'com.google.android.apps.youtube.music': ['https://music.youtube.com/search?q={q}']
    }
  }
};
const KINDS = Object.keys(CATS);

// «найди на озоне …», «закажи на вайлдберриз …» — магазин назван прямо в команде
const STORES = [
  [/^(озон\S*|ozon)$/, 'ru.ozon.app.android'], [/^(вайлдберриз\S*|валдберриз\S*|вб|wildberries|вайлдбериз\S*)$/, 'com.wildberries.ru'],
  [/^((яндекс )?маркет\S*)$/, 'ru.beru.android'], [/^(али|алиэкспресс\S*|aliexpress)$/, 'com.alibaba.aliexpresshd'],
  [/^(авито)$/, 'com.avito.android'], [/^(амазон\S*|amazon)$/, 'com.amazon.mShop.android.shopping']
];
function storePkg(word) {
  const w = String(word || '').toLowerCase().trim();
  for (const [re, pkg] of STORES) if (re.test(w)) return pkg;
  return null;
}

/** Ссылки для приложения pkg: kind — вид дела, mode — 'route' | 'place' (карты) */
function links(kind, pkg, mode = '') {
  const c = CATS[kind];
  if (!c) return [];
  let l = c.links[pkg];
  if (kind === 'maps') { const m = l || c.links['*']; return (m && m[mode || 'place']) || []; }
  return Array.isArray(l) ? l : [];
}

/** Подходящие приложения на телефоне: сначала известные (в порядке каталога), потом похожие по названию */
function suggest(kind, apps) {
  const c = CATS[kind];
  if (!c || !Array.isArray(apps)) return [];
  const byPkg = new Map(apps.map(a => [a.pkg, a]));
  const out = [];
  for (const [pkg, name] of c.apps) if (byPkg.has(pkg)) out.push({ pkg, label: byPkg.get(pkg).label || name, known: true });
  for (const a of apps) if (!out.some(o => o.pkg === a.pkg) && c.kw.test(a.label || '')) out.push({ pkg: a.pkg, label: a.label, known: false });
  return out;
}

const knownName = pkg => { for (const k of KINDS) for (const [p, n] of CATS[k].apps) if (p === pkg) return n; return null; };

/** Сказанное «яндекс еду», «самокат», «первое» → одно из предложенных приложений */
function pickByVoice(text, options, translit = s => s) {
  const n = String(text || '').toLowerCase().replace(/ё/g, 'е');
  const ORD = [/(^|\s)(перв|один|одн)/, /(^|\s)(втор|два|две)/, /(^|\s)(трет|три)/, /(^|\s)(четв|четыре)/];
  for (let i = 0; i < Math.min(ORD.length, options.length); i++) if (ORD[i].test(n) && n.split(' ').length <= 3) return options[i];
  const words = [...n.split(/\s+/), ...translit(n).split(/\s+/)].filter(Boolean);
  let best = null, bestScore = 0, tie = false;
  for (const o of options) {
    const toks = String(o.label || '').toLowerCase().replace(/ё/g, 'е').split(/[\s\-.]+/).filter(t => t.length >= 2);
    let s = 0;
    for (const tk of toks) {
      const pre = tk.slice(0, Math.max(2, Math.min(4, tk.length - 1)));
      if (words.some(w => w.startsWith(pre))) s += tk.length;
    }
    if (s > bestScore) { best = o; bestScore = s; tie = false; } else if (s && s === bestScore) tie = true;
  }
  return bestScore && !tie ? best : null;
}

module.exports = { CATS, KINDS, links, suggest, storePkg, knownName, pickByVoice };
