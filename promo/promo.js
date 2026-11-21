// Рекламный ролик «Феликса»: всё считается от времени t (покадровый рендер, 30 к/с).
// Тайм-лайн реплик — timeline.json (из make_audio.py), рот — lipsync.json.
import * as THREE from 'three';
import { GLTFLoader } from 'felix://app/ui/vendor/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'felix://app/ui/vendor/three-vrm.module.js';
import { decorate, makePhone, holdPhone, phonePose } from 'felix://app/ui/felix3d.js';

const $ = s => document.querySelector(s);
const W = 1920, H = 1080;
const TL = await (await fetch('felix://promo/timeline.json')).json();
const LIPS = await (await fetch('felix://promo/lipsync.json')).json();
const FPS = TL.fps;
const L = Object.fromEntries(TL.lines.map(l => [l.id, l]));
const end = l => l.t + l.dur;

// ---------------------------------------------------------------- помощники анимации
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const outBack = k => { k = clamp(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
/** 0→1 на [a, a+fi], 1 до b, 1→0 на [b, b+fo] */
const win = (t, a, b, fi = 0.35, fo = 0.35) => (t < a || t > b + fo ? 0 : t < a + fi ? ease((t - a) / fi) : t <= b ? 1 : 1 - ease((t - b) / fo));
function show(el, k, dy = 30, sc = 0.94) {
  el.style.opacity = k.toFixed(3);
  el.style.transform = `translateY(${((1 - k) * dy).toFixed(1)}px) scale(${lerp(sc, 1, k).toFixed(4)})`;
}
const typed = (text, t, t0, cps) => text.slice(0, Math.max(0, Math.floor((t - t0) * cps)));

// ---------------------------------------------------------------- декор: значки, файлы, иконки (всё своё, без чужих логотипов)
const CLOVER = '<g fill="currentColor"><circle cx="12" cy="7.2" r="3.6"/><circle cx="16.8" cy="12" r="3.6"/><circle cx="12" cy="16.8" r="3.6"/><circle cx="7.2" cy="12" r="3.6"/></g><circle cx="12" cy="12" r="1.6" fill="#0c6e64"/>';
$('#trayclover').innerHTML = CLOVER; $('#trayclover').style.color = '#5EF0D8';
$('#endclover').innerHTML = CLOVER; $('#endclover').style.color = '#ffffff';
const DI = [['Корзина', 'linear-gradient(160deg,#9fb6c4,#5d7584)'], ['Документы', 'linear-gradient(160deg,#ffd27a,#e0a53a)'], ['Фото', 'linear-gradient(160deg,#ff9bb8,#d9577f)'], ['Игры', 'linear-gradient(160deg,#9a8cff,#5b4bd8)'], ['Музыка', 'linear-gradient(160deg,#6fe3d3,#1b9c8e)']];
$('#dicons').innerHTML = DI.map(([n, g]) => `<div class="dicon"><i style="background:${g}"></i>${n}</div>`).join('');
const TB = ['#2c8fd6', '#ffb347', '#1FB5A3', '#e0567a', '#7a6cff', '#3fbf6a'];
$('#tb').innerHTML = TB.map((c, i) => `<i style="background:linear-gradient(160deg, ${c}, ${c}aa)" class="${i === 1 ? 'tbf' : ''}"></i>`).join('');
const FILES = [['Каникулы.zip', '#7a6cff'], ['Отчёт.pdf', '#e0567a'], ['Фото_с_моря.jpg', '#2c8fd6'], ['Плейлист.mp3', '#1FB5A3'], ['Резюме.docx', '#3b82f6'], ['Рецепт.txt', '#9fb6c4'], ['Скриншот.png', '#ffb347'], ['Презентация.pptx', '#ff8a3d']];
$('#files').innerHTML = FILES.map(([n, c]) => `<div class="file"><i style="background:linear-gradient(160deg, ${c}, ${c}88)"></i>${n}</div>`).join('');
$('#eq').innerHTML = '<i></i>'.repeat(14);
$('#cwave').innerHTML = '<i></i>'.repeat(10);
$('#wicon').innerHTML = `<path transform="translate(0 -2)" d="M15 38h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0 1 13z" fill="#E9F3F2"/><g stroke="#6FB7FF" stroke-width="2.4" stroke-linecap="round"><path d="M18 41l-2 5M26 41l-2 5M34 41l-2 5"/></g>`;
const FEAT = ['Понимает речь без интернета', 'Говорит своим голосом — тоже офлайн', 'Отвечает на любые вопросы', 'Пульт на Android — «Феликс Link»', 'Бесплатно · Windows 10 и 11'];
$('#feat').innerHTML = FEAT.map(f => `<div class="f"><svg viewBox="0 0 24 24" style="color:#5EF0D8">${CLOVER}</svg>${f}</div>`).join('');

// ---------------------------------------------------------------- 3D
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
const phone = makePhone(); holdPhone(vrm, phone);
turn.add(vrm.scene);
const BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
const B = {}; for (const b of BONES) B[b] = vrm.humanoid.getNormalizedBoneNode(b);
vrm.scene.updateMatrixWorld(true);
const hp = new THREE.Vector3(); B.head.getWorldPosition(hp);
const modelH = hp.y + 0.16;
const hips0 = B.hips.position.y;

// где стоит Феликс: x ступней (пиксели), y ступней, рост на экране (пиксели)
function placement(t) {
  const intro = { x: 1260, y: 1160, h: 980 }, title = { x: 1530, y: 1130, h: 950 }, desk = { x: 1600, y: 1040, h: 640 }, fin = { x: 1400, y: 1120, h: 990 };
  const tEndCard = L.f_end.t - 0.9;
  let p;
  if (t < 3.6) p = intro;
  else if (t < 5.8) { const k = ease((t - 3.6) / 0.9); p = { x: lerp(intro.x, title.x, k), y: lerp(intro.y, title.y, k), h: lerp(intro.h, title.h, k) }; }
  else if (t < tEndCard) { const k = ease((t - 5.8) / 0.8); p = { x: lerp(title.x, desk.x, k), y: lerp(title.y, desk.y, k), h: lerp(title.h, desk.h, k) }; }
  else { const k = ease((t - tEndCard) / 0.9); p = { x: lerp(desk.x, fin.x, k), y: lerp(desk.y, fin.y, k), h: lerp(desk.h, fin.h, k) }; }
  return p;
}

// ---------------------------------------------------------------- позы: цели по времени, сглаживание по кадрам
const E = (x = 0, y = 0, z = 0) => ({ x, y, z });
const target = {}, cur = {};
for (const b of BONES) { target[b] = E(); cur[b] = E(); }
let hipsY = 0;
const expr = { happy: 0, relaxed: 0, surprised: 0 };
let spinY = 0;

function during(t, id, before = 0, after = 0) { const l = L[id]; return t >= l.t - before && t <= end(l) + after; }

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
  // взгляд: в интро — в камеру, на столе — на окно/карточку слева
  const p = placement(t);
  const lookX = t < 5.8 || t > L.f_end.t - 0.9 ? 0 : -0.35;
  target.head.y = lookX * 0.6 + Math.sin(t * 0.4) * 0.05; target.neck.y = lookX * 0.2;
  lookTarget.position.set(root.position.x + lookX * 3, root.position.y + modelH * 0.92, 4);

  const talking = TL.lines.some(l => l.who === 'felix' && t >= l.t && t <= end(l));
  const listening = TL.lines.some(l => l.who === 'user' && t >= l.t - 0.2 && t <= end(l) + 0.3);
  if (talking) {
    target.head.x += Math.sin(t * 5) * 0.03; target.head.z = Math.sin(t * 1.7) * 0.05;
    // небольшой жест: локоть у бока, предплечье вперёд, кисть покачивается
    target.rightUpperArm = E(-0.35, 0, 1.12); target.rightLowerArm = E(0, 1.25 + Math.sin(t * 3) * 0.15, 0.05); target.rightHand = E(0, 0, 0.2 + Math.sin(t * 4) * 0.1);
  }
  if (listening) { target.head.z = 0.14; target.spine.x = 0.05; target.head.x += 0.05; ex.surprised = 0.15; }
  const wave = (t >= 1.0 && t <= 3.3) || (t >= L.f_end.t - 0.4 && t <= L.f_end.t + 2.6);
  if (wave) {
    const s = t * 10;
    target.rightUpperArm = E(0, -0.4, 0.02); target.rightLowerArm = E(0, 0.1, -1.5 + Math.sin(s) * 0.3); target.rightHand = E(-1.5, 0, Math.sin(s + 0.6) * 0.25);   // ладонью к зрителю
    target.head.z = 0.08; ex.happy = 0.9;
  }
  // загрузки: показывает рукой на окно
  if (t >= L.f_dl.t && t <= L.f_dl.t + 2.2) { target.rightUpperArm = E(-0.2, -0.35, 0.3); target.rightLowerArm = E(0, 0.25, 0.08); target.rightHand = E(0, 0, -0.1); ex.happy = 0.5; }
  // приложение для телефона: показывает рукой на телефон
  if (t >= L.f_link.t && t <= end(L.f_link) + 0.3) { target.rightUpperArm = E(-0.2, -0.35, 0.3); target.rightLowerArm = E(0, 0.25, 0.08); target.rightHand = E(0, 0, -0.1); ex.happy = 0.6; }
  if (t >= L.f_phone.t && t <= L.f_phone.t + 1.8) { const k = t - L.f_phone.t; hy = Math.max(0, Math.sin(k * 9)) * 0.035 * Math.max(0, 1 - k / 1.8); ex.happy = 0.9; }
  // таймер и громкость: радостный подскок
  for (const id of ['f_timer', 'f_music']) {
    const l = L[id];
    if (t >= l.t && t <= l.t + 1.8) {
      const k = (t - l.t);
      hy = Math.max(0, Math.sin(k * 9)) * 0.045 * Math.max(0, 1 - k / 1.8);
      target.leftUpperArm = E(0, 0, -0.85); target.rightUpperArm = E(0, 0, 0.85); target.leftLowerArm = E(0, -0.9, 0); target.rightLowerArm = E(0, 0.9, 0);
      ex.happy = 1;
    }
  }
  // музыка погромче: руки на наушниках, качает головой в такт (112 ударов в минуту)
  if (t >= L.f_music.t + 1.8 && t <= L.u_sky.t - 0.3) {
    const beat = t * 112 / 60 * Math.PI * 2;
    target.leftUpperArm = E(-0.5, 0.3, -0.5); target.leftLowerArm = E(0, -2.1, 0);
    target.rightUpperArm = E(-0.5, -0.3, 0.5); target.rightLowerArm = E(0, 2.1, 0);
    target.head.x += Math.sin(beat) * 0.09; target.head.z = Math.sin(beat / 2) * 0.08; target.spine.z = Math.sin(beat / 2) * 0.04;
    hy = Math.abs(Math.sin(beat / 2)) * 0.02; ex.happy = 0.8; ex.relaxed = 0.3;
  }
  // небо: достаёт телефон, печатает
  const phoneOn = t >= L.f_sky1.t + 0.6 && t <= L.f_sky2.t - 0.15;
  if (phoneOn) { phonePose(target, t); ex.relaxed = 0.3; }
  phone.visible = phoneOn;
  if (t >= L.f_sky2.t - 0.15 && t <= L.f_sky2.t + 0.8) { target.rightUpperArm = E(-0.55, 0, 1.05); target.rightLowerArm = E(0, 2.25, 0); target.rightHand = E(0.3, 0, 0.4); }
  if (t >= end(L.f_sky2) - 0.2 && t <= end(L.f_sky2) + 1) ex.happy = 0.7;
  // офлайн-фичи: уверенно, руки в стороны
  if (t >= L.f_offline.t - 0.2 && t <= L.f_offline.t + 1.6) { target.leftUpperArm = E(0, 0.2, -0.7); target.rightUpperArm = E(0, -0.2, 0.7); target.leftLowerArm = E(0, -0.6, 0); target.rightLowerArm = E(0, 0.6, 0); ex.happy = 0.6; }
  if (t < 0.9) ex.happy = 0.6;
  return { hy, ex };
}

// моргание — по расписанию
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
  // появление: вращение и рост из ноля
  const sc = t < 0.3 ? 0.001 : t < 1.2 ? outBack((t - 0.3) / 0.9) : 1;
  spinY = t < 1.2 ? (1 - ease((t - 0.3) / 0.9)) * Math.PI * 2.2 : 0;
  const p = placement(t);
  const pxPerM = p.h / modelH;
  camera.left = -W / 2 / pxPerM; camera.right = W / 2 / pxPerM; camera.top = H / 2 / pxPerM; camera.bottom = -H / 2 / pxPerM; camera.updateProjectionMatrix();
  root.position.set((p.x - W / 2) / pxPerM, (H / 2 - p.y) / pxPerM, 0);
  const facing = t < 5.8 || t > L.f_end.t - 0.9 ? (t > L.f_end.t - 0.9 ? -0.25 : 0) : -0.3;
  turn.rotation.y = facing + spinY;
  turn.scale.setScalar(Math.max(0.001, sc));
  vrm.update(dt);
  return pxPerM;
}

// ---------------------------------------------------------------- частицы (детерминированные)
const fx = $('#fx').getContext('2d');
function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function leaf(x, y, r, rot, color, a) {
  fx.save(); fx.globalAlpha = a; fx.translate(x, y); fx.rotate(rot); fx.fillStyle = color;
  for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2; fx.beginPath(); fx.arc(Math.cos(an) * r * 0.62, Math.sin(an) * r * 0.62, r * 0.58, 0, Math.PI * 2); fx.fill(); }
  fx.restore();
}
function burst(t, t0, cx, cy, n, seed, color = '#1FB5A3') {
  const k = t - t0; if (k < 0 || k > 2.2) return;
  for (let i = 0; i < n; i++) {
    const a = rnd(seed + i) * Math.PI * 2, s = 260 + rnd(seed + i + 99) * 620;
    const x = cx + Math.cos(a) * s * k, y = cy + Math.sin(a) * s * k + 380 * k * k;
    leaf(x, y, 8 + rnd(seed + i * 3) * 12, k * (rnd(seed + i * 7) - 0.5) * 9, rnd(seed + i * 5) < 0.3 ? '#26303F' : color, clamp(1 - k / 2.2));
  }
}
function drawFx(t) {
  fx.clearRect(0, 0, W, H);
  const intro = t < 6.2, fin = t > L.f_end.t - 1.0;
  if (intro || fin) {
    // плавно падающие листики на тёмном фоне
    for (let i = 0; i < 26; i++) {
      const sp = 60 + rnd(i) * 70, x = rnd(i + 50) * W + Math.sin(t * 0.8 + i) * 30, y = ((rnd(i + 80) * H + t * sp) % (H + 80)) - 40;
      leaf(x, y, 7 + rnd(i + 3) * 9, t * (rnd(i + 9) - 0.5) * 2, '#5EF0D8', intro ? 0.22 * (1 - clamp((t - 5.6) / 0.6)) : 0.22 * clamp((t - L.f_end.t + 1.0) / 0.6));
    }
  }
  burst(t, 0.3, 960, 640, 70, 1);
  burst(t, 3.6, 1400, 560, 40, 200, '#5EF0D8');
  burst(t, L.f_end.t - 0.9, 1380, 560, 60, 400);
  // вспышки искр на «готово»
  for (const [id, x, y, seed] of [['f_timer', 820, 400, 600], ['f_music', 820, 360, 700], ['f_sky2', 1300, 560, 800], ['f_phone', 800, 700, 900]]) {
    const k = t - L[id].t; if (k < 0 || k > 1.2) continue;
    for (let i = 0; i < 24; i++) {
      const a = rnd(seed + i) * Math.PI * 2, s = 120 + rnd(seed + i + 5) * 300;
      fx.save(); fx.globalAlpha = clamp(1 - k / 1.2); fx.fillStyle = '#5EF0D8'; fx.shadowColor = '#5EF0D8'; fx.shadowBlur = 12;
      fx.beginPath(); fx.arc(x + Math.cos(a) * s * k, y + Math.sin(a) * s * k + 120 * k * k, 3 + rnd(seed + i * 2) * 3, 0, Math.PI * 2); fx.fill(); fx.restore();
    }
  }
}

// ---------------------------------------------------------------- облачко Феликса над головой
const bubble = $('#bubble');
function bubbleAt(t, headX, headY) {
  let txt = null, think = false, t0 = 0, len = 0;
  for (const l of TL.lines) {
    if (l.who !== 'felix' || l.id === 'hello' || l.id === 'f_end') continue;
    if (t >= l.t - 0.05 && t <= end(l) + 1.3) { txt = l.text; t0 = l.t; len = l.dur; }
  }
  if (t >= end(L.f_sky1) + 0.2 && t < L.f_sky2.t - 0.1) { txt = 'Спрашиваю нейросеть…'; think = true; t0 = end(L.f_sky1) + 0.2; }
  if (!txt) { bubble.style.opacity = 0; return; }
  const cps = think ? 999 : Math.max(14, txt.length / (len * 0.9));
  const shown = think ? txt : typed(txt, t, t0, cps);
  bubble.innerHTML = (think ? 'Спрашиваю нейросеть <span class="think"><i></i><i></i><i></i></span>' : shown + (shown.length < txt.length ? '<i class="caret"></i>' : ''));
  if (think) bubble.querySelectorAll('.think i').forEach((d, i) => { d.style.opacity = 0.3 + 0.7 * Math.max(0, Math.sin(t * 6 - i * 0.8)); d.style.transform = `translateY(${-5 * Math.max(0, Math.sin(t * 6 - i * 0.8))}px)`; });
  const k = clamp((t - t0 + 0.05) / 0.25);
  // ширина облачка — по всей фразе (чтобы не прыгала при печати), правый край — над головой
  bubble.style.width = 'auto';
  const probe = bubble.innerHTML; bubble.textContent = txt + (think ? '   ' : ''); const bw = Math.min(560, bubble.offsetWidth + 4); bubble.innerHTML = probe;
  bubble.style.width = bw + 'px';
  bubble.style.left = (headX - bw + 150) + 'px';
  bubble.style.top = 'auto';
  bubble.style.bottom = (H - headY + 40) + 'px';
  show(bubble, k * (1 - clamp((t - (think ? L.f_sky2.t - 0.1 : t0 + len + 1.0)) / 0.3)), 20, 0.9);
}

// ---------------------------------------------------------------- кадр
const els = { intro: $('#intro'), end: $('#end'), desk: $('#desk'), hello: $('#hello'), title: $('#title'), dl: $('#dl'), timer: $('#timer'), weather: $('#weather'), music: $('#music'), vol: $('#vol'), caption: $('#caption'), feat: $('#feat'), endtxt: $('#endtxt'), flash: $('#flash') };
function ui(t) {
  const tEnd = L.f_end.t - 0.9;
  els.intro.style.opacity = (1 - clamp((t - 5.8) / 0.5)).toFixed(3);
  els.desk.style.opacity = (clamp((t - 5.8) / 0.5) * (1 - clamp((t - tEnd) / 0.6))).toFixed(3);
  els.end.style.opacity = clamp((t - tEnd) / 0.6).toFixed(3);
  els.desk.style.transform = `scale(${lerp(1.06, 1, ease((t - 5.8) / 1.2)).toFixed(4)})`;
  // интро
  show(els.hello, win(t, 1.0, 3.3, 0.3, 0.3), 20);
  const hs = typed('Привет!\nЯ Феликс.', t, 1.0, 11);
  els.hello.innerHTML = hs.replace('\n', '<br>').replace('Феликс', '<em>Феликс</em>').replace(/Ф(е(л(и(к(с)?)?)?)?)?$/, m => `<em>${m}</em>`);
  const kt = win(t, 3.6, 5.6, 0.45, 0.4);
  els.title.style.opacity = kt; els.title.style.transform = `translateX(${(-60 * (1 - kt)).toFixed(1)}px)`;
  els.flash.style.opacity = (Math.max(0, 1 - Math.abs(t - 3.62) / 0.12) * 0.55 + Math.max(0, 1 - Math.abs(t - tEnd) / 0.12) * 0.4).toFixed(3);
  // подпись: что говорит пользователь
  const u = TL.lines.find(l => l.who === 'user' && t >= l.t - 0.35 && t <= end(l) + 0.6);
  if (u) {
    show(els.caption, win(t, u.t - 0.35, end(u) + 0.25, 0.25, 0.3), 24, 0.96);
    els.caption.style.transform += ' translateX(-50%)';
    $('#ctext').textContent = '«' + typed(u.text, t, u.t, u.text.length / (u.dur * 0.85)) + (t > end(u) ? '' : '') + '»';
    $('#cwave').querySelectorAll('i').forEach((b, i) => { b.style.height = (6 + (t < end(u) ? 22 * Math.abs(Math.sin(t * 9 + i * 1.3)) * (0.5 + rnd(i) * 0.5) : 0)) + 'px'; });
  } else els.caption.style.opacity = 0;
  // окно «Загрузки»
  const kd = win(t, L.f_dl.t - 0.1, L.u_timer.t - 0.4, 0.4, 0.35);
  show(els.dl, kd, 40, 0.9);
  // таймер
  const ktm = win(t, L.f_timer.t - 0.1, L.u_weather.t - 0.4, 0.35, 0.35);
  show(els.timer, ktm, 30, 0.85);
  const left = Math.max(0, 300 - Math.max(0, t - L.f_timer.t));
  $('#tnum').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  $('#tprog').style.width = (100 * left / 300) + '%';
  // погода
  show(els.weather, win(t, L.f_weather.t - 0.1, L.u_music.t - 0.4, 0.35, 0.35), 30, 0.88);
  $('#wicon').style.transform = `translateY(${(Math.sin(t * 2) * 4).toFixed(1)}px)`;
  // музыка и громкость
  show(els.music, win(t, L.u_music.t - 0.1, L.u_sky.t - 0.4, 0.35, 0.35), 30, 0.9);
  const kv = win(t, L.f_music.t - 0.2, L.f_music.t + 2.6, 0.25, 0.35);
  show(els.vol, kv, 20, 0.9);
  const vol = Math.round(lerp(40, 70, ease((t - L.f_music.t) / 0.8)));
  $('#volb').style.width = vol + '%'; $('#voln').textContent = vol;
  const loud = t > L.f_music.t ? 1 : 0.55;
  $('#eq').querySelectorAll('i').forEach((b, i) => { b.style.height = (8 + 40 * loud * Math.abs(Math.sin(t * 112 / 60 * Math.PI + i * 0.7)) * (0.4 + rnd(i + 30) * 0.6)) + 'px'; });
  // «Феликс Link»: телефон с приложением → «🎤 Сказать» → распознавание → ответ Феликса → будильник
  const ph = $('#phone');
  const kp = win(t, L.f_link.t - 0.45, L.f_offline.t - 0.75, 0.5, 0.45);
  ph.style.opacity = kp.toFixed(3);
  ph.style.transform = `translateY(${((1 - kp) * 120).toFixed(1)}px) rotate(${((1 - kp) * -5).toFixed(2)}deg) scale(0.93)`;
  $('#phMic').classList.toggle('press', t >= L.u_phone.t - 0.55 && t < L.u_phone.t - 0.3);
  const ks = win(t, L.u_phone.t - 0.35, end(L.u_phone) + 0.15, 0.25, 0.25);
  $('#phSheet').style.transform = `translateY(${(320 * (1 - ks)).toFixed(1)}px)`;
  $('#phSheet').style.setProperty('--pulse', (1 + 0.14 * Math.abs(Math.sin(t * 7))).toFixed(3));
  const said = 'поставь будильник на 7 утра';
  $('#phSay').textContent = typed(said, t, L.u_phone.t, said.length / (L.u_phone.dur * 0.85));
  $('#phRep').innerHTML = t > L.f_phone.t + 0.1 ? `<div class="fx">Феликс: ${L.f_phone.text}</div>` : t > end(L.u_phone) + 0.25 ? `<div class="me">Вы: ${said}</div>` : '';
  const kt2 = win(t, L.f_phone.t + 0.65, L.f_offline.t - 1.0, 0.25, 0.3);
  $('#phToast').style.opacity = kt2.toFixed(3);
  $('#phToast').style.transform = `translateY(${(-(1 - kt2) * 110).toFixed(1)}px)`;
  // фичи
  const kf0 = L.f_offline.t - 0.4;
  els.feat.querySelectorAll('.f').forEach((f, i) => { const k = win(t, kf0 + i * 0.45, tEnd - 0.2, 0.35, 0.4); f.style.opacity = k; f.style.transform = `translateX(${(-50 * (1 - k)).toFixed(1)}px)`; });
  // финал
  const ke = clamp((t - tEnd - 0.2) / 0.6);
  els.endtxt.style.opacity = ke; els.endtxt.style.transform = `translateY(${(30 * (1 - ease(ke))).toFixed(1)}px)`;
  const cta = els.endtxt.querySelector('.cta');
  cta.style.transform = `scale(${(1 + 0.04 * Math.max(0, Math.sin((t - tEnd) * 3.5))).toFixed(4)})`;
}

const headV = new THREE.Vector3();
window.renderFrame = function (t) {
  const dt = 1 / FPS;
  // догоняем симуляцию (кадры идут по порядку; для отдельных кадров — разгоняемся с t-3 с)
  if (simT < 0 || t < simT || t - simT > 3) simT = Math.max(0, t - 3);
  let pxPerM = 0;
  while (simT <= t + 1e-6) { pxPerM = step(simT, dt); simT += dt; }
  renderer.render(scene, camera);
  B.head.getWorldPosition(headV);
  const hx = (headV.x * pxPerM) + W / 2, hy = H / 2 - headV.y * pxPerM;
  ui(t);
  bubbleAt(t, hx, hy - 0.16 * pxPerM);
  drawFx(t);
  return true;
};
window.ready = Promise.resolve(true);
window.promoDur = TL.dur;
