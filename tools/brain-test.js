// Разбор фраз: electron (ELECTRON_RUN_AS_NODE=1) tools/brain-test.js → tools/brain-test.txt
const path = require('path');
const b = require(path.join(__dirname, '..', 'app', 'lib', 'brain.js'));
const cases = ['феликс открой загрузки', 'феликс в какая погода', 'эй феликс таймер на пять минут', 'ну вот феликс сверни все окна', 'феликс поставь будильник на семь тридцать', 'феликс спрячься', 'феликс спроси у нейросети почему небо голубое', 'феликс почему тебя зовут феликс', 'феликс включи трек группа крови', 'феликс переключи звук на наушники', 'привет как дела', 'феликс перейди влево', 'феликс смени тему на закат'];
const out = cases.map(c => { const w = b.wake(c); return c + ' => ' + JSON.stringify(w) + ' => ' + JSON.stringify(b.parse(w.rest)); });
require('fs').writeFileSync(path.join(__dirname, 'brain-test.txt'), out.join('\n'));
