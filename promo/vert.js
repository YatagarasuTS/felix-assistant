// Вертикальный ролик «Феликс управляет телефоном» (1080×1920): всё считается от времени t (покадровый рендер, 30 к/с).
// Реплики и время — phone_timeline.json, рот — phone_lipsync.json (make_audio_phone.py).
import * as THREE from 'three';
import { GLTFLoader } from 'felix://app/ui/vendor/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'felix://app/ui/vendor/three-vrm.module.js';
import { decorate } from 'felix://app/ui/felix3d.js';

const $ = s => document.querySelector(s);
const W = 1080, H = 1920;
const TL = await (await fetch('felix://promo/phone_timeline.json')).json();
const LIPS = await (await fetch('felix://promo/phone_lipsync.json')).json();
const FPS = TL.fps;
const L = Object.fromEntries(TL.lines.map(l => [l.id, l]));
const end = l => l.t + l.dur;
const tEnd = L.f_end.t - 0.9;
// сцены
const S = {
  food: [L.u_food.t - 1.0, L.u_taxi.t - 0.9], taxi: [L.u_taxi.t - 0.9, L.u_screen.t - 0.8], screen: [L.u_screen.t - 0.8, L.f_choose.t - 0.7],
  choose: [L.f_choose.t - 0.7, L.f_open.t - 0.6], open: [L.f_open.t - 0.6, tEnd]
};

// ---------------------------------------------------------------- помощники анимации
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const outBack = k => { k = clamp(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const win = (t, a, b, fi = 0.35, fo = 0.35) => (t < a || t > b + fo ? 0 : t < a + fi ? ease((t - a) / fi) : t <= b ? 1 : 1 - ease((t - b) / fo));
function show(el, k, dy = 30, sc = 0.94, extra = '') {
  el.style.opacity = k.toFixed(3);
  el.style.transform = `${extra} translateY(${((1 - k) * dy).toFixed(1)}px) scale(${lerp(sc, 1, k).toFixed(4)})`;
}
const typed = (text, t, t0, cps) => text.slice(0, Math.max(0, Math.floor((t - t0) * cps)));
function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// ---------------------------------------------------------------- экран телефона (вымышленные приложения, свои значки)
const HEAD = 'felix://root/phone/app/src/main/res/drawable-nodpi/felix_head.png';
const CLOVER = '<g fill="currentColor"><circle cx="12" cy="7.2" r="3.6"/><circle cx="16.8" cy="12" r="3.6"/><circle cx="12" cy="16.8" r="3.6"/><circle cx="7.2" cy="12" r="3.6"/></g><circle cx="12" cy="12" r="1.6" fill="#0c6e64"/>';
$('#brandclover').innerHTML = CLOVER; $('#brandclover').style.color = '#fff';
$('#endclover').innerHTML = CLOVER; $('#endclover').style.color = '#fff';
const SBAR = `<div class="cam"></div><div class="sb"><span>18:31</span><span><svg viewBox="0 0 18 14"><path d="M1 13h2V10H1zM5 13h2V7H5zM9 13h2V4H9zM13 13h2V1h-2z" fill="currentColor"/></svg><svg viewBox="0 0 20 14"><path d="M10 13 1.5 4.5a12 12 0 0 1 17 0z" fill="currentColor"/></svg><svg viewBox="0 0 26 14"><rect x="1" y="1" width="21" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="3" width="15" height="8" rx="1.5" fill="currentColor"/></svg></span></div><div class="navl"></div>`;
const HOME_APPS = [['🍕', 'Еда рядом', '#ffb347,#ff7a3d'], ['🚕', 'Поехали', '#ffe066,#f5b700'], ['🗺️', 'Карты', '#6fe3a3,#1f9d63'], ['🎵', 'Lucky Music', '#a79bff,#6C5CFF', 'music'],
  ['🛒', 'Маркет', '#7cc4ff,#2c8fd6'], ['🖼️', 'Фото', '#ff9bb8,#d9577f'], ['📷', 'Камера', '#b8c7d1,#5d7584'], ['', 'Феликс Link', '#9ff5e8,#1FB5A3', 'felix'],
  ['📅', 'Календарь', '#ffd27a,#e0a53a'], ['⛅', 'Погода', '#8ad0ff,#3b82f6'], ['✉️', 'Почта', '#ff8f8f,#e5383b'], ['⚙️', 'Настройки', '#c9d3d8,#7b8a91']];
const FOOD = [['🍕', 'Маргарита', '30–40 мин · ★ 4.9', '549 ₽', '#ffe1b8,#ffb36b'], ['🍕', 'Пепперони', '30–40 мин · ★ 4.8', '629 ₽', '#ffd0c2,#ff8a6b'], ['🧀', 'Четыре сыра', '35–45 мин · ★ 4.9', '689 ₽', '#fff3c2,#ffd24d']];
const ROUTE = 'M120 560 L120 420 L240 420 L240 260 L360 260 L360 150', ROUTE_LEN = 650;
let mapStreets = '';
for (let x = 40; x < 476; x += 80) mapStreets += `<path d="M${x} 0V640" stroke="#1d363d" stroke-width="6"/>`;
for (let y = 20; y < 640; y += 80) mapStreets += `<path d="M0 ${y}H476" stroke="#1d363d" stroke-width="6"/>`;
const MAP = `<svg class="map" viewBox="0 0 476 640"><rect width="476" height="640" fill="#13252b"/>${mapStreets}
  <path d="M-10 500 C 120 450, 220 560, 490 470" stroke="#15405a" stroke-width="44" fill="none"/>
  <rect x="290" y="380" width="150" height="100" rx="16" fill="#183f33"/><rect x="20" y="110" width="120" height="96" rx="14" fill="#183f33"/>
  <path d="M0 260H476M0 420H476M120 0V640M240 0V640M360 0V640" stroke="#2d4f58" stroke-width="14"/>
  <path class="route" d="${ROUTE}" stroke="#5EF0D8" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${ROUTE_LEN}" stroke-dashoffset="${ROUTE_LEN}"/>
  <circle class="pulse" cx="120" cy="560" r="14" fill="none" stroke="#3b82f6" stroke-width="4"/><circle cx="120" cy="560" r="13" fill="#3b82f6" stroke="#fff" stroke-width="4"/>
  <g class="pinB" opacity="0"><rect x="300" y="88" width="124" height="40" rx="12" fill="#1FB5A3"/><text x="362" y="115" text-anchor="middle" fill="#04201D" font-size="20" font-weight="700" font-family="Segoe UI">Работа</text>
  <circle cx="360" cy="150" r="15" fill="#1FB5A3" stroke="#fff" stroke-width="4"/></g></svg>`;
const SVGP = { prev: '<path d="M6 5h2v14H6zM20 5v14L9 12z"/>', play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>', next: '<path d="M16 5h2v14h-2zM4 5v14l11-7z"/>' };
function screenHTML() {
  return SBAR + `
  <div class="lay home" data-l="home"><div class="clock"><b>18:31</b><span>суббота, 21 ноября · +4°</span></div><div class="search"><span class="em">🔍</span>&nbsp; Поиск</div>
    <div class="grid">${HOME_APPS.map(([e, n, g, id]) => `<div class="app" ${id ? `data-app="${id}"` : ''}><i style="background:linear-gradient(160deg,${g})">${id === 'felix' ? `<img src="${HEAD}" alt="">` : e}</i>${n}</div>`).join('')}</div>
    <div class="dock"><i style="background:#3fbf6a">📞</i><i style="background:#2c8fd6">💬</i><i style="background:#ff8a3d">🌐</i><i style="background:#7a6cff">🎧</i></div></div>
  <div class="lay food" data-l="food"><div class="hd"><b>Еда рядом</b><small>📍 ул. Баумана, 10 · доставка 30 мин</small>
      <div class="q"><span class="em">🔍</span><span class="qt"></span><span class="car"></span><span class="ph">Блюдо или ресторан</span></div></div>
    <div class="chips"><span class="on">Пицца</span><span>Суши</span><span>Бургеры</span><span>Роллы</span></div>
    ${FOOD.map(([e, n, d, p, g]) => `<div class="fc"><i style="background:linear-gradient(160deg,${g})">${e}</i><div style="flex:1"><b>${n}</b><small>${d}</small><div class="pr">${p}<span>+</span></div></div></div>`).join('')}</div>
  <div class="lay taxi" data-l="taxi">${MAP}<div class="sheet">
      <div class="row"><i style="background:#3b82f6"></i><div>Моё местоположение<small>Откуда</small></div></div>
      <div class="row"><i style="background:#1FB5A3;border-radius:4px"></i><div><b>Работа</b> · ул. Баумана, 10<small>Куда — вписал Феликс</small></div></div>
      <div class="tar"><div class="on"><b>Эконом</b>320 ₽ · 4 мин</div><div><b>Комфорт</b>410 ₽</div><div><b>Бизнес</b>690 ₽</div></div>
      <div class="go">Заказать</div></div></div>
  <div class="lay music" data-l="music"><div class="cv"></div><b>Lucky Clover</b><small>Felix Beats</small><div class="bar"><b></b></div>
    <div class="ctl"><svg viewBox="0 0 24 24">${SVGP.prev}</svg><span class="pp"><svg viewBox="0 0 24 24" class="ppi">${SVGP.play}</svg></span><svg viewBox="0 0 24 24">${SVGP.next}</svg></div>
    <div class="eq">${'<i></i>'.repeat(16)}</div></div>
  <div class="toast"><img src="${HEAD}" alt=""><div><small>Феликс Link · сейчас</small><b class="tt"></b></div></div>`;
}
const SCR = [$('#scrA'), $('#scrB')];
for (const s of SCR) s.innerHTML = screenHTML();
$('#cwave').innerHTML = '<i></i>'.repeat(10);

/** Что на экране телефона в момент t */
function phoneState(t) {
  const st = { home: 1, food: 0, taxi: 0, music: 0, open: 1, q: '', cards: [0, 0, 0], route: 0, pinB: 0, pulse: 0, toast: 0, tt: '', playing: false, music0: 0 };
  const fOpen = L.f_food.t - 0.15, tOpen = L.f_taxi.t - 0.15, homeAgain = L.f_screen.t - 0.6, mOpen = L.f_screen.t + 1.75;
  const at = (t0, f) => clamp((t - t0) / f);
  if (t >= fOpen && t < tOpen) { const k = at(fOpen, 0.35); st.food = k; st.open = k; st.home = 1 - k; }
  if (t >= tOpen && t < homeAgain) { const k = at(tOpen, 0.35); st.taxi = k; st.food = 1 - k; st.home = 0; st.open = k; }
  if (t >= homeAgain && t < mOpen) { const k = at(homeAgain, 0.3); st.home = k; st.taxi = 1 - k; st.open = 1; }
  if (t >= mOpen) { const k = at(mOpen, 0.3); st.music = k; st.home = 1 - k; st.open = k; }
  st.q = typed('пицца', t, L.f_food.t + 0.35, 9);
  st.cards = [0, 1, 2].map(i => ease((t - L.f_food.t - 1.15 - i * 0.18) / 0.35));
  st.route = ease((t - L.f_taxi.t - 0.3) / 1.2);
  st.pinB = clamp((t - L.f_taxi.t - 1.3) / 0.3);
  st.pulse = t;
  // уведомление «Феликс Link» — телефон получил команду с компьютера
  const toasts = [[end(L.u_food) + 0.05, L.f_food.t + 1.2, 'Открываю «Еда рядом» · ищу «пицца»'], [end(L.u_taxi) + 0.05, L.f_taxi.t + 1.3, 'Открываю «Поехали» · куда: Работа']];
  for (const [a, b, txt] of toasts) { const k = win(t, a, b, 0.25, 0.3); if (k > 0) { st.toast = k; st.tt = txt; } }
  st.playing = t >= L.f_screen.t + 3.05;
  return st;
}
function applyPhone(scr, st, t) {
  const lays = scr.querySelectorAll('.lay');
  for (const l of lays) {
    const k = st[l.dataset.l] || 0;
    l.style.opacity = k.toFixed(3);
    l.style.transform = l.dataset.l === 'home' ? '' : `scale(${lerp(0.88, 1, ease(k)).toFixed(4)})`;
  }
  const sb = scr.querySelector('.sb'); sb.style.color = st.food > 0.5 || st.taxi > 0.5 ? (st.food > 0.5 ? '#fff' : '#fff') : '#fff';
  scr.querySelector('.qt').textContent = st.q;
  scr.querySelector('.ph').style.display = st.q ? 'none' : '';
  scr.querySelector('.car').style.opacity = Math.sin(t * 8) > 0 ? 1 : 0;
  scr.querySelectorAll('.food .fc').forEach((c, i) => { c.style.opacity = st.cards[i]; c.style.transform = `translateY(${(1 - st.cards[i]) * 40}px)`; });
  scr.querySelector('.route').setAttribute('stroke-dashoffset', (ROUTE_LEN * (1 - st.route)).toFixed(1));
  scr.querySelector('.pinB').setAttribute('opacity', st.pinB.toFixed(2));
  const pr = (t * 1.2) % 1; const pu = scr.querySelector('.pulse'); pu.setAttribute('r', (14 + pr * 26).toFixed(1)); pu.setAttribute('opacity', (1 - pr).toFixed(2));
  const sheet = scr.querySelector('.sheet'); sheet.style.transform = `translateY(${(1 - ease((t - L.f_taxi.t - 0.1) / 0.5)) * 470}px)`;
  const go = scr.querySelector('.go'); const gp = t > L.f_taxi.t + 1.8 ? Math.abs(Math.sin((t - L.f_taxi.t) * 4)) : 0; go.style.boxShadow = `0 0 0 ${(gp * 10).toFixed(1)}px rgba(255,210,63,${(0.45 * (1 - gp)).toFixed(2)})`;
  const toast = scr.querySelector('.toast'); toast.style.opacity = st.toast.toFixed(3); toast.style.transform = `translateY(${(-(1 - st.toast) * 120).toFixed(1)}px)`; scr.querySelector('.tt').textContent = st.tt;
  scr.querySelector('.ppi').innerHTML = st.playing ? SVGP.pause : SVGP.play;
  scr.querySelector('.music .bar b').style.width = (st.playing ? 12 + (t - L.f_screen.t - 3.05) * 2.2 : 12).toFixed(1) + '%';
  scr.querySelectorAll('.music .eq i').forEach((b, i) => { b.style.height = (6 + (st.playing ? 40 * Math.abs(Math.sin(t * 116 / 60 * Math.PI + i * 0.7)) * (0.4 + rnd(i + 30) * 0.6) : 0)) + 'px'; });
}

// ---------------------------------------------------------------- 3D Феликс
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0, 0);
const scene = new THREE.Scene();
const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.95); key.position.set(0.6, 1.2, 1.6); scene.add(key);
const rim = new THREE.DirectionalLight(0x5ef0d8, 1.4); rim.position.set(-1.2, 0.8, -0.8); scene.add(rim);
const rim2 = new THREE.DirectionalLight(0x9f8cff, 0.6); rim2.position.set(1.2, 0.4, -0.9); scene.add(rim2);
scene.add(new THREE.AmbientLight(0xffffff, 0.38));
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50); camera.position.set(0, 0, 10);
const root = new THREE.Group(), turn = new THREE.Group(); root.add(turn); scene.add(root);
const lookTarget = new THREE.Object3D(); scene.add(lookTarget);
const loader = new GLTFLoader(); loader.register(p => new VRMLoaderPlugin(p));
const gltf = await loader.loadAsync('felix://root/stage/models/felix.vrm');
const vrm = gltf.userData.vrm;
VRMUtils.removeUnnecessaryVertices(gltf.scene);
if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
vrm.scene.traverse(o => { o.frustumCulled = false; });
vrm.lookAt.target = lookTarget;
decorate(vrm);
turn.add(vrm.scene);
const BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
const B = {}; for (const b of BONES) B[b] = vrm.humanoid.getNormalizedBoneNode(b);
vrm.scene.updateMatrixWorld(true);
const hp = new THREE.Vector3(); B.head.getWorldPosition(hp);
const modelH = hp.y + 0.16;
const hips0 = B.hips.position.y;

// где стоит Феликс: x ступней, y ступней, рост на экране (пиксели)
const POS = { intro: { x: 540, y: 1905, h: 1180 }, main: { x: 270, y: 1890, h: 1040 }, small: { x: 250, y: 1895, h: 720 }, fin: { x: 540, y: 1905, h: 880 } };
function placement(t) {
  const marks = [[0, POS.intro], [4.4, POS.main], [S.screen[0] + 0.3, POS.small], [tEnd, POS.fin]];
  let p = marks[0][1];
  for (let i = 1; i < marks.length; i++) {
    const [t0, to] = marks[i], from = marks[i - 1][1];
    if (t >= t0) { const k = ease((t - t0) / 0.8); p = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), h: lerp(from.h, to.h, k) }; }
  }
  return p;
}
const E = (x = 0, y = 0, z = 0) => ({ x, y, z });
const target = {}, cur = {};
for (const b of BONES) { target[b] = E(); cur[b] = E(); }
let hipsY = 0;
const expr = { happy: 0, relaxed: 0, surprised: 0 };
const facingAt = t => (t < 4.4 || t > tEnd ? (t > tEnd ? -0.12 : 0) : t < S.screen[0] + 0.3 ? 0.32 : 0.22);

function poseAt(t) {
  for (const b of BONES) target[b] = E();
  target.leftUpperArm = E(0, 0, -1.25); target.rightUpperArm = E(0, 0, 1.25);
  target.leftLowerArm = E(0, -0.2, -0.1); target.rightLowerArm = E(0, 0.2, 0.1);
  target.leftUpperLeg = E(0, 0, 0.035); target.rightUpperLeg = E(0, 0, -0.035);
  let hy = 0;
  const ex = { happy: 0, relaxed: 0, surprised: 0 };
  const br = Math.sin(t * 1.6);
  target.chest.x = br * 0.015; target.spine.x = br * 0.01;
  target.hips.z = Math.sin(t * 0.55) * 0.02; target.spine.z = -Math.sin(t * 0.55) * 0.014;
  const lookX = t < 4.4 || t > tEnd ? 0 : 0.35;               // на телефон и карточки справа
  target.head.y = lookX * 0.5 + Math.sin(t * 0.4) * 0.05; target.neck.y = lookX * 0.2;
  lookTarget.position.set(root.position.x + lookX * 3, root.position.y + modelH * 0.92, 4);
  const talking = TL.lines.some(l => l.who === 'felix' && t >= l.t && t <= end(l));
  const listening = TL.lines.some(l => l.who === 'user' && t >= l.t - 0.2 && t <= end(l) + 0.3);
  if (talking) {
    target.head.x += Math.sin(t * 5) * 0.03; target.head.z = Math.sin(t * 1.7) * 0.05;
    target.rightUpperArm = E(-0.35, 0, 1.12); target.rightLowerArm = E(0, 1.25 + Math.sin(t * 3) * 0.15, 0.05); target.rightHand = E(0, 0, 0.2 + Math.sin(t * 4) * 0.1);
  }
  if (listening) { target.head.z = -0.14; target.spine.x = 0.05; target.head.x += 0.05; ex.surprised = 0.15; }
  const wave = (t >= 1.0 && t <= 3.6) || (t >= L.f_end.t - 0.4 && t <= L.f_end.t + 2.6);
  if (wave) {
    const s = t * 10;
    target.rightUpperArm = E(0, -0.4, 0.02); target.rightLowerArm = E(0, 0.1, -1.5 + Math.sin(s) * 0.3); target.rightHand = E(-1.5, 0, Math.sin(s + 0.6) * 0.25);
    target.head.z = 0.08; ex.happy = 0.9;
  }
  // показывает левой рукой на телефон / окно справа
  const point = [[L.f_food.t, 2.4], [L.f_taxi.t, 2.6], [L.f_screen.t, 2.2], [L.f_choose.t, 2.6]].some(([a, d]) => t >= a && t <= a + d);
  if (point) { target.leftUpperArm = E(-0.2, 0.35, -0.5); target.leftLowerArm = E(0, -0.35, -0.08); target.leftHand = E(0, 0, 0.1); ex.happy = Math.max(ex.happy, 0.5); }
  // «готово»: радостный подскок
  for (const [a] of [[L.f_food.t + 1.2], [L.f_taxi.t + 1.5], [L.f_open.t]]) {
    if (t >= a && t <= a + 1.6) { const k = t - a; hy = Math.max(0, Math.sin(k * 9)) * 0.04 * Math.max(0, 1 - k / 1.6); ex.happy = 1; }
  }
  // открытый код: руки в стороны
  if (t >= L.f_open.t + 0.2 && t <= L.f_open.t + 1.9) { target.leftUpperArm = E(0, 0.2, -0.7); target.rightUpperArm = E(0, -0.2, 0.7); target.leftLowerArm = E(0, -0.6, 0); target.rightLowerArm = E(0, 0.6, 0); ex.happy = 0.8; }
  if (t < 0.9) ex.happy = 0.6;
  return { hy, ex };
}
function blinkAt(t) { const ph = (t % 3.7) / 3.7; const k = Math.abs(ph - 0.97) < 0.03 ? 1 - Math.abs(ph - 0.97) / 0.03 : 0; return t > 0.6 ? k : 0; }

let simT = -1;
function step(t, dt) {
  const { hy, ex } = poseAt(t);
  const k = 1 - Math.exp(-dt * 9);
  for (const b of BONES) { const n = B[b]; if (!n) continue; const c = cur[b], g = target[b]; c.x += (g.x - c.x) * k; c.y += (g.y - c.y) * k; c.z += (g.z - c.z) * k; n.rotation.set(c.x, c.y, c.z); }
  hipsY += (hy - hipsY) * k; B.hips.position.y = hips0 + hipsY;
  for (const e of Object.keys(expr)) expr[e] += (ex[e] - expr[e]) * k;
  const em = vrm.expressionManager;
  const fi = Math.min(LIPS.length - 1, Math.max(0, Math.round(t * FPS)));
  const m = Math.min(1, (LIPS[fi] || 0) * 1.25);
  em.setValue('aa', m * 0.75); em.setValue('oh', m * 0.3 * (Math.sin(t * 23) * 0.5 + 0.5)); em.setValue('ih', m * 0.25 * (Math.cos(t * 29) * 0.5 + 0.5));
  em.setValue('happy', expr.happy); em.setValue('relaxed', expr.relaxed); em.setValue('surprised', expr.surprised);
  em.setValue('blink', expr.happy > 0.5 ? 0 : blinkAt(t));
  const sc = t < 0.3 ? 0.001 : t < 1.2 ? outBack((t - 0.3) / 0.9) : 1;
  const spinY = t < 1.2 ? (1 - ease((t - 0.3) / 0.9)) * Math.PI * 2.2 : 0;
  const p = placement(t);
  const pxPerM = p.h / modelH;
  camera.left = -W / 2 / pxPerM; camera.right = W / 2 / pxPerM; camera.top = H / 2 / pxPerM; camera.bottom = -H / 2 / pxPerM; camera.updateProjectionMatrix();
  root.position.set((p.x - W / 2) / pxPerM, (H / 2 - p.y) / pxPerM, 0);
  turn.rotation.y = facingAt(t) + spinY;
  turn.scale.setScalar(Math.max(0.001, sc));
  vrm.update(dt);
  return pxPerM;
}

// ---------------------------------------------------------------- частицы
$('#fx').width = W; $('#fx').height = H;          // размер холста — в пикселях кадра (по умолчанию он 300×150)
const fx = $('#fx').getContext('2d');
function leaf(x, y, r, rot, color, a) {
  fx.save(); fx.globalAlpha = a; fx.translate(x, y); fx.rotate(rot); fx.fillStyle = color;
  for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2; fx.beginPath(); fx.arc(Math.cos(an) * r * 0.62, Math.sin(an) * r * 0.62, r * 0.58, 0, Math.PI * 2); fx.fill(); }
  fx.restore();
}
function burst(t, t0, cx, cy, n, seed, color = '#1FB5A3') {
  const k = t - t0; if (k < 0 || k > 2.2) return;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed + i) * Math.PI * 2, s = 260 + rnd(seed + i + 99) * 620;
    leaf(cx + Math.cos(a) * s * k, cy + Math.sin(a) * s * k + 380 * k * k, 9 + rnd(seed + i * 3) * 13, k * (rnd(seed + i * 7) - 0.5) * 9, rnd(seed + i * 5) < 0.3 ? '#26303F' : color, clamp(1 - k / 2.2));
  }
}
function sparks(t, t0, x, y, seed) {
  const k = t - t0; if (k < 0 || k > 1.2) return;
  for (let i = 0; i < 26; i++) {
    const a = rnd(seed + i) * Math.PI * 2, s = 140 + rnd(seed + i + 5) * 320;
    fx.save(); fx.globalAlpha = clamp(1 - k / 1.2); fx.fillStyle = '#5EF0D8'; fx.shadowColor = '#5EF0D8'; fx.shadowBlur = 14;
    fx.beginPath(); fx.arc(x + Math.cos(a) * s * k, y + Math.sin(a) * s * k + 140 * k * k, 4 + rnd(seed + i * 2) * 3, 0, Math.PI * 2); fx.fill(); fx.restore();
  }
}
function drawFx(t) {
  fx.clearRect(0, 0, W, H);
  const intro = t < 5, fin = t > tEnd - 0.2;
  if (intro || fin) for (let i = 0; i < 30; i++) {
    const sp = 70 + rnd(i) * 80, x = rnd(i + 50) * W + Math.sin(t * 0.8 + i) * 30, y = ((rnd(i + 80) * H + t * sp) % (H + 80)) - 40;
    leaf(x, y, 8 + rnd(i + 3) * 10, t * (rnd(i + 9) - 0.5) * 2, '#5EF0D8', intro ? 0.22 * (1 - clamp((t - 4.4) / 0.6)) : 0.22 * clamp((t - tEnd + 0.2) / 0.6));
  }
  burst(t, 0.3, 540, 1300, 70, 1);
  burst(t, 4.4, 540, 420, 40, 200, '#5EF0D8');
  burst(t, tEnd, 540, 700, 60, 400);
  sparks(t, L.f_food.t + 1.2, 790, 900, 600);
  sparks(t, L.f_taxi.t + 1.5, 900, 560, 700);
  sparks(t, L.f_screen.t + 1.75, 240, 700, 750);
  sparks(t, L.f_choose.t + 2.25, 760, 560, 800);
  sparks(t, L.f_open.t + 1.1, 820, 640, 900);
}

// ---------------------------------------------------------------- облачко Феликса
const bubble = $('#bubble');
function bubbleAt(t, headX, headY) {
  let txt = null, t0 = 0, len = 0;
  for (const l of TL.lines) {
    if (l.who !== 'felix' || l.id === 'hello' || l.id === 'f_end') continue;
    if (t >= l.t - 0.05 && t <= end(l) + 1.2) { txt = l.text; t0 = l.t; len = l.dur; }
  }
  if (!txt) { bubble.style.opacity = 0; return; }
  const shown = typed(txt, t, t0, Math.max(14, txt.length / (len * 0.9)));
  const maxW = t < S.screen[0] + 0.3 ? 480 : 640;
  bubble.style.maxWidth = maxW + 'px'; bubble.style.width = 'auto';
  bubble.textContent = txt; const bw = Math.min(maxW, bubble.offsetWidth + 4);
  bubble.innerHTML = shown + (shown.length < txt.length ? '<i class="caret"></i>' : '');
  bubble.style.width = bw + 'px';
  const left = clamp(headX - bw * 0.3, 30, W - bw - 30);
  bubble.style.left = left + 'px';
  bubble.style.setProperty('--tail', clamp(headX - left, 50, bw - 50) + 'px');
  bubble.style.top = 'auto'; bubble.style.bottom = (H - headY + 40) + 'px';
  const k = clamp((t - t0 + 0.05) / 0.25) * (1 - clamp((t - (t0 + len + 0.9)) / 0.3));
  show(bubble, k, 20, 0.9);
}

// ---------------------------------------------------------------- кадр
const els = { brand: $('#brand'), intro: $('#intro'), endtxt: $('#endtxt'), caption: $('#caption'), phone: $('#phone'), pc: $('#pc'), choose: $('#choose'), oss: $('#oss'), flash: $('#flash'), cursor: $('#cursor'), ripple: $('#ripple'), rootEl: $('#root') };
const rel = el => { const r = el.getBoundingClientRect(), o = els.rootEl.getBoundingClientRect(); return { x: r.left - o.left + r.width / 2, y: r.top - o.top + r.height / 2 }; };
function cursorAt(t) {
  // путь курсора: [время, точка или функция, клик?]
  const musicIcon = () => rel($('#scrB [data-app="music"] i')), playBtn = () => rel($('#scrB .pp')), sel = () => rel($('#selFood')), opt2 = () => rel($('#dd div:nth-child(2)'));
  const a = L.f_screen.t, c = L.f_choose.t;
  const PATH = [[a + 0.5, { x: 980, y: 980 }], [a + 1.5, musicIcon], [a + 1.7, musicIcon, true], [a + 2.8, playBtn], [a + 3.0, playBtn, true], [a + 4.4, { x: 1000, y: 1000 }],
    [c + 0.2, { x: 1000, y: 1100 }], [c + 0.75, sel], [c + 0.85, sel, true], [c + 1.6, opt2], [c + 2.2, opt2, true], [c + 3.3, { x: 1020, y: 1100 }]];
  const vis = win(t, a + 0.4, a + 4.2, 0.25, 0.3) + win(t, c + 0.1, c + 3.0, 0.25, 0.3);
  els.cursor.style.opacity = clamp(vis).toFixed(3);
  els.ripple.style.opacity = 0;
  if (vis <= 0) return;
  const pt = p => (typeof p === 'function' ? p() : p);
  let pos = pt(PATH[0][1]);
  for (let i = 1; i < PATH.length; i++) {
    const [t1, p1] = PATH[i], [t0, p0] = PATH[i - 1];
    if (t >= t1) pos = pt(p1);
    else if (t >= t0) { const k = ease((t - t0) / (t1 - t0)), A = pt(p0), Bp = pt(p1); pos = { x: lerp(A.x, Bp.x, k), y: lerp(A.y, Bp.y, k) }; break; }
  }
  els.cursor.style.transform = `translate(${(pos.x - 6).toFixed(1)}px, ${(pos.y - 4).toFixed(1)}px)`;
  for (const [tc, p, click] of PATH) {
    if (!click) continue;
    const k = (t - tc) / 0.45;
    if (k >= 0 && k <= 1) { const q = pt(p); els.ripple.style.left = q.x + 'px'; els.ripple.style.top = q.y + 'px'; els.ripple.style.opacity = (1 - k).toFixed(3); els.ripple.style.transform = `scale(${(0.4 + k * 1.2).toFixed(3)})`; }
  }
}

function ui(t) {
  // фон и заголовки
  els.brand.style.opacity = win(t, 4.4, tEnd - 0.3, 0.4, 0.4).toFixed(3);
  for (const id of Object.keys(S)) { const [a, b] = S[id]; const k = win(t, a + 0.1, b - 0.3, 0.35, 0.3); show($('#t_' + id), k, 24, 0.96); }
  show(els.intro, win(t, 0.6, 4.1, 0.45, 0.35), 40, 0.96);
  els.flash.style.opacity = (Math.max(0, 1 - Math.abs(t - 4.42) / 0.12) * 0.4 + Math.max(0, 1 - Math.abs(t - tEnd) / 0.12) * 0.4).toFixed(3);
  // фраза пользователя
  const u = TL.lines.find(l => l.who === 'user' && t >= l.t - 0.35 && t <= end(l) + 0.6);
  if (u) {
    show(els.caption, win(t, u.t - 0.35, end(u) + 0.25, 0.25, 0.3), 20, 0.96, 'translateX(-50%)');
    $('#ctext').textContent = '«' + typed(u.text, t, u.t, u.text.length / (u.dur * 0.85)) + '»';
    $('#cwave').querySelectorAll('i').forEach((b, i) => { b.style.height = (6 + (t < end(u) ? 26 * Math.abs(Math.sin(t * 9 + i * 1.3)) * (0.5 + rnd(i) * 0.5) : 0)) + 'px'; });
  } else els.caption.style.opacity = 0;
  // телефон: на сценах еды и такси — крупно справа, на сцене «экран на ПК» — маленький внизу справа
  const kp = win(t, S.food[0] + 0.2, S.screen[1] - 0.4, 0.5, 0.45);
  const km = ease((t - S.screen[0] - 0.2) / 0.8);
  els.phone.style.opacity = kp.toFixed(3);
  els.phone.style.transform = `translate(${(km * 65).toFixed(1)}px, ${((1 - kp) * 140 + km * 790).toFixed(1)}px) rotate(${((1 - kp) * 5).toFixed(2)}deg) scale(${lerp(1, 0.62, km).toFixed(4)})`;
  const st = phoneState(t);
  applyPhone($('#scrA'), st, t);
  // окно «Телефон» на компьютере — тот же экран
  const kpc = win(t, L.f_screen.t - 0.5, S.screen[1] - 0.3, 0.45, 0.35);
  show(els.pc, kpc, 40, 0.9);
  if (kpc > 0) applyPhone($('#scrB'), st, t);
  // настройки: выбор приложения доставки
  const kc = win(t, L.f_choose.t - 0.5, S.choose[1] - 0.3, 0.45, 0.35);
  show(els.choose, kc, 40, 0.92);
  const c = L.f_choose.t;
  const ddOpen = t >= c + 0.85 && t < c + 2.25;
  const dd = $('#dd'); const sf = $('#selFood');
  dd.style.top = (sf.offsetTop + sf.offsetHeight + 8) + 'px';
  dd.style.opacity = ddOpen ? clamp((t - c - 0.85) / 0.15).toFixed(3) : 0;
  dd.querySelectorAll('div').forEach((d, i) => d.classList.toggle('hl', i === (t >= c + 1.45 ? 1 : 0)));
  sf.classList.toggle('on', ddOpen || (t >= c + 2.25 && t < c + 3.4));
  $('#selFoodV').textContent = t >= c + 2.25 ? 'Пицца & Ко' : 'Еда рядом';
  // открытый код
  show(els.oss, win(t, L.f_open.t - 0.5, S.open[1] - 0.2, 0.45, 0.35), 40, 0.92);
  $('#star').textContent = t >= L.f_open.t + 1.1 ? '★ Starred' : '☆ Star';
  $('#star').style.background = t >= L.f_open.t + 1.1 ? 'rgba(255,210,63,.25)' : '';
  // финал
  const ke = clamp((t - tEnd - 0.2) / 0.6);
  els.endtxt.style.opacity = ke; els.endtxt.style.transform = `translateY(${(30 * (1 - ease(ke))).toFixed(1)}px)`;
  els.endtxt.querySelector('.cta').style.transform = `scale(${(1 + 0.04 * Math.max(0, Math.sin((t - tEnd) * 3.5))).toFixed(4)})`;
  cursorAt(t);
}

const headV = new THREE.Vector3();
window.renderFrame = function (t) {
  const dt = 1 / FPS;
  if (simT < 0 || t < simT || t - simT > 3) simT = Math.max(0, t - 3);
  let pxPerM = 0;
  while (simT <= t + 1e-6) { pxPerM = step(simT, dt); simT += dt; }
  renderer.render(scene, camera);
  B.head.getWorldPosition(headV);
  const hx = headV.x * pxPerM + W / 2, hy = H / 2 - headV.y * pxPerM;
  ui(t);
  bubbleAt(t, hx, hy - 0.16 * pxPerM);
  drawFx(t);
  return true;
};
// съёмка полосами: сдвиг всей сцены вверх (окно ниже кадра)
window.setStrip = y => { $('#root').style.transform = y ? `translateY(${-y}px)` : ''; return true; };
window.promoDur = TL.dur;
window.promoSize = [W, H];
