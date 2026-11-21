// Вертикальный ролик «Гардероб Феликса» (1080×1920): всё считается от времени t (покадровый рендер, 30 к/с).
// Вещи, наряды, ширма и анимации надевания — из программы (app/ui/wardrobe3d.js), реплики — wardrobe_timeline.json.
import * as THREE from 'three';
import { GLTFLoader } from 'felix://app/ui/vendor/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'felix://app/ui/vendor/three-vrm.module.js';
import * as WR from 'felix://app/ui/wardrobe3d.js';
import qrcode from 'felix://app/ui/vendor/qrcode.mjs';

const $ = s => document.querySelector(s);
const W = 1080, H = 1920;
const TL = await (await fetch('felix://promo/wardrobe_timeline.json')).json();
const LIPS = await (await fetch('felix://promo/wardrobe_lipsync.json')).json();
const CAT = await (await fetch('felix://app/ui/wardrobe-catalog.json')).json(); WR.setCatalog(CAT);
const FPS = TL.fps;
const L = Object.fromEntries(TL.lines.map(l => [l.id, l]));
const end = l => l.t + l.dur;
const tEnd = L.f_qr.t - 0.9;
const S = { acc: [4.5, L.u_outfit.t - 0.4], outfit: [L.u_outfit.t - 0.4, L.u_weather.t - 0.3], weather: [L.u_weather.t - 0.3, L.u_rps.t - 0.4], games: [L.u_rps.t - 0.4, tEnd] };

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const outBack = k => { k = clamp(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const win = (t, a, b, fi = 0.35, fo = 0.35) => (t < a || t > b + fo ? 0 : t < a + fi ? ease((t - a) / fi) : t <= b ? 1 : 1 - ease((t - b) / fo));
function show(el, k, dy = 30, sc = 0.94, extra = '') { el.style.opacity = k.toFixed(3); el.style.transform = `${extra} translateY(${((1 - k) * dy).toFixed(1)}px) scale(${lerp(sc, 1, k).toFixed(4)})`; }
const typed = (text, t, t0, cps) => text.slice(0, Math.max(0, Math.floor((t - t0) * cps)));
function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

const CLOVER = '<g fill="currentColor"><circle cx="12" cy="7.2" r="3.6"/><circle cx="16.8" cy="12" r="3.6"/><circle cx="12" cy="16.8" r="3.6"/><circle cx="7.2" cy="12" r="3.6"/></g><circle cx="12" cy="12" r="1.6" fill="#0c6e64"/>';
for (const id of ['#brandclover', '#endclover']) { $(id).innerHTML = CLOVER; $(id).style.color = '#fff'; }
$('#cwave').innerHTML = '<i></i>'.repeat(10);
// QR-код на GitHub (qrcode-generator из программы)
const REPO = 'https://github.com/YatagarasuTS/felix-assistant';
{ const q = qrcode(0, 'M'); q.addData(REPO); q.make(); $('#qrimg').src = q.createDataURL(12, 1); }

// ---------------------------------------------------------------- сценарий гардероба
const acc = id => CAT.accessories.find(a => a.id === id), outfit = id => CAT.outfits.find(o => o.id === id);
const E1 = end(L.u_crown) + 0.2;
const MONTAGE = ['catears', 'sunglasses', 'wings', 'wizard'];
const WEARS = [[E1, 'crown', WR.WEAR_T], ...MONTAGE.map((id, i) => [L.f_more.t - 0.3 + i * 1.2, id, 1.4]), [L.f_weather.t + 0.1, 'beanie', 1.4], [L.f_weather.t + 1.4, 'scarf', 1.4]];
const CLEAR = L.f_weather.t - 0.25;                         // перед «по погоде» лишнее исчезает с хлопком
const OB = L.f_out1.t - 0.1, OT = WR.OUTFIT_T;             // переодевание за ширмой
const SWAPS = ['sakura', 'sunset', 'lemon', 'forest', 'fire', 'denim', 'midnight'].map((id, i) => [L.f_ten.t + 0.1 + i * 0.38, id]);
const outfitAt = t => { let id = t >= OB + 0.42 * OT ? 'cosmos' : 'mint'; for (const [a, o] of SWAPS) if (t >= a) id = o; if (t >= CLEAR) id = 'snow'; return id; };
const PAT = [L.f_pat.t - 1.7, L.f_pat.t - 0.15];          // мышь гладит по голове

// ---------------------------------------------------------------- 3D
const renderer = new THREE.WebGLRenderer({ canvas: $('#gl'), alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0, 0);
const scene = new THREE.Scene();
const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.95); key.position.set(0.6, 1.2, 1.6); scene.add(key);
const rim = new THREE.DirectionalLight(0x5ef0d8, 1.4); rim.position.set(-1.2, 0.8, -0.8); scene.add(rim);
const rim2 = new THREE.DirectionalLight(0xff9cc2, 0.5); rim2.position.set(1.2, 0.4, -0.9); scene.add(rim2);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
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
turn.add(vrm.scene);
WR.attachAccessory(vrm, WR.makeAccessory('headphones'));
const meshes = WEARS.map(([, id]) => WR.makeAccessory(id));
const screenObj = WR.makeScreen(); screenObj.position.set(0.62, 0, 0.06); root.add(screenObj);
const cloth = WR.makeCloth(outfit('mint').main); cloth.visible = false; root.add(cloth);
for (const o of CAT.outfits) WR.prepareOutfit(vrm, o);       // все наряды заранее — без рывков в кадре
let outfitNow = 'mint';

const BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
const B = {}; for (const b of BONES) B[b] = vrm.humanoid.getNormalizedBoneNode(b);
vrm.scene.updateMatrixWorld(true);
const hp = new THREE.Vector3(); B.head.getWorldPosition(hp);
const modelH = hp.y + 0.16, hips0 = B.hips.position.y;

const POS = { intro: { x: 540, y: 1905, h: 1180 }, acc: { x: 390, y: 1890, h: 1150 }, outfit: { x: 300, y: 1890, h: 860 }, right: { x: 760, y: 1890, h: 980 }, fin: { x: 540, y: 1915, h: 700 } };
function placement(t) {
  const marks = [[0, POS.intro], [4.4, POS.acc], [S.outfit[0], POS.outfit], [S.weather[0], POS.right], [tEnd, POS.fin]];
  let p = marks[0][1];
  for (let i = 1; i < marks.length; i++) { const [t0, to] = marks[i], from = marks[i - 1][1]; if (t >= t0) { const k = ease((t - t0) / 0.8); p = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), h: lerp(from.h, to.h, k) }; } }
  return p;
}

// вещи на момент t: надевается / надето / уже заменено или снято
let dress = null;
const poofs = [];                                           // [время, x, y] — хлопки при смене вещей (для частиц)
function dressAt(t) {
  dress = null;
  WEARS.forEach(([a, id, d], i) => {
    const m = meshes[i], slot = WR.slotOf(id);
    const replaced = WEARS.some(([a2, id2], j) => j > i && WR.slotOf(id2) === slot && a2 <= t);
    const cleared = t >= CLEAR && a < CLEAR;
    if (t < a || replaced || cleared) { if (m.parent) m.removeFromParent(); m.userData.on = false; return; }
    const k = Math.min(1, (t - a) / d), r = WR.wearStep(scene, vrm, m, k);
    if (k < 1) dress = { slot, raise: r.raise, k, id };
  });
}

const E = (x = 0, y = 0, z = 0) => ({ x, y, z });
const target = {}, cur = {};
for (const b of BONES) { target[b] = E(); cur[b] = E(); }
let hipsY = 0;
const expr = { happy: 0, relaxed: 0, surprised: 0 };

function poseAt(t) {
  for (const b of BONES) target[b] = E();
  target.leftUpperArm = E(0, 0, -1.25); target.rightUpperArm = E(0, 0, 1.25);
  target.leftLowerArm = E(0, -0.2, -0.1); target.rightLowerArm = E(0, 0.2, 0.1);
  target.leftUpperLeg = E(0, 0, 0.035); target.rightUpperLeg = E(0, 0, -0.035);
  let hy = 0;
  const ex = { happy: 0, relaxed: 0, surprised: 0 };
  const br = Math.sin(t * 1.6);
  target.chest.x = br * 0.015; target.spine.x = br * 0.01; target.hips.z = Math.sin(t * 0.55) * 0.02;
  const lookX = t < 4.4 || t > tEnd ? 0 : t < S.weather[0] ? 0.25 : -0.3;
  target.head.y = lookX * 0.5 + Math.sin(t * 0.4) * 0.05; target.neck.y = lookX * 0.2;
  lookTarget.position.set(root.position.x + lookX * 3, root.position.y + modelH * 0.92, 4);
  const talking = TL.lines.some(l => l.who === 'felix' && t >= l.t && t <= end(l));
  const listening = TL.lines.some(l => l.who === 'user' && t >= l.t - 0.2 && t <= end(l) + 0.3);
  if (talking) { target.head.x += Math.sin(t * 5) * 0.03; target.head.z = Math.sin(t * 1.7) * 0.05; target.rightUpperArm = E(-0.35, 0, 1.12); target.rightLowerArm = E(0, 1.25 + Math.sin(t * 3) * 0.15, 0.05); target.rightHand = E(0, 0, 0.2 + Math.sin(t * 4) * 0.1); }
  if (listening) { target.head.z = 0.14; target.spine.x = 0.05; target.head.x += 0.05; ex.surprised = 0.15; }
  const wave = (t >= 1.0 && t <= 3.8) || (t >= L.f_end.t - 0.3 && t <= L.f_end.t + 2.6);
  if (wave) { const s = t * 10; target.rightUpperArm = E(0, -0.4, 0.02); target.rightLowerArm = E(0, 0.1, -1.5 + Math.sin(s) * 0.3); target.rightHand = E(-1.5, 0, Math.sin(s + 0.6) * 0.25); target.head.z = 0.08; ex.happy = 0.9; }
  // надевание: руки к месту вещи
  if (dress) { WR.wearPose(target, dress.slot, dress.raise, t); ex.happy = Math.max(ex.happy, 0.4); }
  // приземлилась вещь — радостный подскок
  for (const [a, , d] of WEARS) { const k = t - (a + d * 0.72); if (k >= 0 && k < 1.2) { hy = Math.max(hy, Math.max(0, Math.sin(k * 9)) * 0.035 * (1 - k / 1.2)); ex.happy = 1; } }
  // переодевание: идёт за ширму и обратно
  if (t >= OB && t <= OB + OT) {
    const st = WR.outfitStep((t - OB) / OT, 1);
    if (st.walking) { const ph = t * 8.5, amp = 0.42; target.leftUpperLeg.x = Math.sin(ph) * amp; target.rightUpperLeg.x = -Math.sin(ph) * amp; target.leftLowerLeg.x = Math.max(0, -Math.sin(ph - 0.6)) * amp * 1.4; target.rightLowerLeg.x = Math.max(0, Math.sin(ph - 0.6)) * amp * 1.4; target.leftUpperArm.x = -Math.sin(ph) * 0.3; target.rightUpperArm.x = Math.sin(ph) * 0.3; hy = -Math.abs(Math.cos(ph)) * 0.025; target.head.y = 0; }
    if (st.happy) { const k = t - (OB + 0.8 * OT); hy = Math.max(0, Math.sin(k * 9)) * 0.05; target.leftUpperArm = E(0, 0, -0.85); target.rightUpperArm = E(0, 0, 0.85); target.leftLowerArm = E(0, -0.9, 0); target.rightLowerArm = E(0, 0.9, 0); ex.happy = 1; }
  }
  // быстрая смена нарядов: на каждой — лёгкий подскок
  for (const [a] of SWAPS) { const k = t - a; if (k >= 0 && k < 0.36) { hy = Math.max(hy, Math.sin(k / 0.36 * Math.PI) * 0.03); ex.happy = 1; } }
  // камень-ножницы-бумага: «ты победил» — смущённо чешет затылок; гладят по голове — тоже
  const shy = (t >= L.f_rps.t + 0.5 && t <= end(L.f_rps) + 0.6) || (t >= PAT[0] + 0.6 && t <= end(L.f_pat) + 0.5);
  if (shy) { target.rightUpperArm = E(-0.5, 0.2, -0.6); target.rightLowerArm = E(0, 0.3, -1.9); target.rightHand = E(0, 0, Math.sin(t * 12) * 0.15); target.head.x += 0.12; target.head.z = -0.1; ex.happy = 0.9; ex.relaxed = 0.4; }
  if (t < 0.9) ex.happy = 0.6;
  return { hy, ex };
}
function blinkAt(t) { const ph = (t % 3.7) / 3.7; const k = Math.abs(ph - 0.97) < 0.03 ? 1 - Math.abs(ph - 0.97) / 0.03 : 0; return t > 0.6 ? k : 0; }

let simT = -1;
function step(t, dt) {
  dressAt(t);
  const id = outfitAt(t); if (id !== outfitNow) { WR.applyOutfit(vrm, outfit(id)); outfitNow = id; }
  const { hy, ex } = poseAt(t);
  const k = 1 - Math.exp(-dt * 9);
  for (const b of BONES) { const n = B[b]; if (!n) continue; const c = cur[b], g = target[b]; c.x += (g.x - c.x) * k; c.y += (g.y - c.y) * k; c.z += (g.z - c.z) * k; n.rotation.set(c.x, c.y, c.z); }
  hipsY += (hy - hipsY) * k; B.hips.position.y = hips0 + hipsY;
  for (const e of Object.keys(expr)) expr[e] += (ex[e] - expr[e]) * k;
  const em = vrm.expressionManager, fi = Math.min(LIPS.length - 1, Math.max(0, Math.round(t * FPS))), m = Math.min(1, (LIPS[fi] || 0) * 1.25);
  em.setValue('aa', m * 0.75); em.setValue('oh', m * 0.3 * (Math.sin(t * 23) * 0.5 + 0.5)); em.setValue('ih', m * 0.25 * (Math.cos(t * 29) * 0.5 + 0.5));
  em.setValue('happy', expr.happy); em.setValue('relaxed', expr.relaxed); em.setValue('surprised', expr.surprised);
  em.setValue('blink', expr.happy > 0.5 ? 0 : blinkAt(t));
  const sc = t < 0.3 ? 0.001 : t < 1.2 ? outBack((t - 0.3) / 0.9) : 1;
  const spinY = t < 1.2 ? (1 - ease((t - 0.3) / 0.9)) * Math.PI * 2.2 : 0;
  const p = placement(t), pxPerM = p.h / modelH;
  camera.left = -W / 2 / pxPerM; camera.right = W / 2 / pxPerM; camera.top = H / 2 / pxPerM; camera.bottom = -H / 2 / pxPerM; camera.updateProjectionMatrix();
  root.position.set((p.x - W / 2) / pxPerM, (H / 2 - p.y) / pxPerM, 0);
  // ширма, кофта на ширме, проход за ширму
  let facing = t < 4.4 || t > tEnd ? (t > tEnd ? 0.1 : 0) : t < S.outfit[0] ? 0.18 : t < S.weather[0] ? 0.15 : -0.2;
  turn.position.set(0, 0, 0); screenObj.userData.set(0); cloth.visible = false;
  if (t >= OB && t <= OB + OT) {
    const st = WR.outfitStep((t - OB) / OT, 1);
    screenObj.userData.set(st.screenOpen);
    turn.position.set(st.offX, 0, st.offZ);
    if (st.facing) facing = st.facing;
    if (st.cloth) { cloth.visible = st.cloth.scale > 0.01; cloth.position.set(st.cloth.x, st.cloth.y, st.cloth.z); cloth.rotation.set(st.cloth.rx, 0, st.cloth.rz); cloth.scale.setScalar(Math.max(0.001, st.cloth.scale)); }
  }
  turn.rotation.y = facing + spinY;
  turn.scale.setScalar(Math.max(0.001, sc));
  WR.updateAccessories(vrm, t);
  vrm.update(dt);
  return pxPerM;
}

// ---------------------------------------------------------------- частицы
$('#fx').width = W; $('#fx').height = H;
const fx = $('#fx').getContext('2d');
function leaf(x, y, r, rot, color, a) { fx.save(); fx.globalAlpha = a; fx.translate(x, y); fx.rotate(rot); fx.fillStyle = color; for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2; fx.beginPath(); fx.arc(Math.cos(an) * r * 0.62, Math.sin(an) * r * 0.62, r * 0.58, 0, Math.PI * 2); fx.fill(); } fx.restore(); }
function heart(x, y, s, a) { fx.save(); fx.globalAlpha = a; fx.translate(x, y); fx.fillStyle = '#ff6b9a'; fx.shadowColor = '#ff6b9a'; fx.shadowBlur = 10; fx.beginPath(); fx.moveTo(0, s * 0.3); fx.bezierCurveTo(-s, -s * 0.4, -s * 0.4, -s * 1.1, 0, -s * 0.45); fx.bezierCurveTo(s * 0.4, -s * 1.1, s, -s * 0.4, 0, s * 0.3); fx.fill(); fx.restore(); }
function burst(t, t0, cx, cy, n, seed, color = '#1FB5A3') { const k = t - t0; if (k < 0 || k > 2.2) return; for (let i = 0; i < n; i++) { const a = rnd(seed + i) * Math.PI * 2, s = 260 + rnd(seed + i + 99) * 620; leaf(cx + Math.cos(a) * s * k, cy + Math.sin(a) * s * k + 380 * k * k, 9 + rnd(seed + i * 3) * 13, k * (rnd(seed + i * 7) - 0.5) * 9, rnd(seed + i * 5) < 0.3 ? '#26303F' : color, clamp(1 - k / 2.2)); } }
function sparks(t, t0, x, y, seed, col = '#5EF0D8') { const k = t - t0; if (k < 0 || k > 1.1) return; for (let i = 0; i < 24; i++) { const a = rnd(seed + i) * Math.PI * 2, s = 120 + rnd(seed + i + 5) * 280; fx.save(); fx.globalAlpha = clamp(1 - k / 1.1); fx.fillStyle = col; fx.shadowColor = col; fx.shadowBlur = 14; fx.beginPath(); fx.arc(x + Math.cos(a) * s * k, y + Math.sin(a) * s * k + 120 * k * k, 4 + rnd(seed + i * 2) * 3, 0, Math.PI * 2); fx.fill(); fx.restore(); } }
const landAt = [];                                     // экранные точки, где вещи «встали»: заполняется во время рендера
function drawFx(t, headX, headY) {
  fx.clearRect(0, 0, W, H);
  const intro = t < 5, fin = t > tEnd - 0.2;
  if (intro || fin) for (let i = 0; i < 30; i++) { const sp = 70 + rnd(i) * 80, x = rnd(i + 50) * W + Math.sin(t * 0.8 + i) * 30, y = ((rnd(i + 80) * H + t * sp) % (H + 80)) - 40; leaf(x, y, 8 + rnd(i + 3) * 10, t * (rnd(i + 9) - 0.5) * 2, '#5EF0D8', intro ? 0.22 * (1 - clamp((t - 4.4) / 0.6)) : 0.22 * clamp((t - tEnd + 0.2) / 0.6)); }
  burst(t, 0.3, 540, 1300, 70, 1); burst(t, 4.4, 540, 420, 40, 200, '#5EF0D8'); burst(t, tEnd, 540, 700, 60, 400);
  WEARS.forEach(([a, , d], i) => { const lp = landAt[i]; if (lp) sparks(t, a + d * 0.72, lp.x, lp.y, 600 + i * 40, i % 2 ? '#ffd84a' : '#5EF0D8'); });
  sparks(t, OB + 0.5 * OT, headX + 0.62 * 540, headY - 120, 950, '#ffd84a');
  SWAPS.forEach(([a], i) => sparks(t, a, headX, headY + 250, 1000 + i * 17, ['#ff9cc2', '#ff9a4d', '#ffe066', '#6f9454', '#ec4245', '#4f75ad', '#2ed3c0'][i]));
  burst(t, CLEAR, headX, headY + 120, 36, 1200, '#bfe8ff');
  // сердечки, когда гладят
  const hk = t - (PAT[1] - 0.2);
  if (hk >= 0 && hk < 2.2) for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (rnd(1300 + i) - 0.5) * 1.6, s = 160 + rnd(1310 + i) * 220; heart(headX + Math.cos(a) * s * hk, headY - 40 + Math.sin(a) * s * hk, 14 + rnd(1320 + i) * 10, clamp(1 - hk / 2.2)); }
}

// ---------------------------------------------------------------- облачко
const bubble = $('#bubble');
function bubbleAt(t, headX, headY) {
  let txt = null, t0 = 0, len = 0;
  for (const l of TL.lines) { if (l.who !== 'felix' || l.id === 'hello' || l.id === 'f_end' || l.id === 'f_qr') continue; if (t >= l.t - 0.05 && t <= end(l) + 1.0) { txt = l.text; t0 = l.t; len = l.dur; } }
  if (!txt) { bubble.style.opacity = 0; return; }
  const shown = typed(txt, t, t0, Math.max(14, txt.length / (len * 0.9)));
  const maxW = t < S.outfit[0] ? 420 : 520;
  bubble.style.maxWidth = maxW + 'px'; bubble.style.width = 'auto';
  bubble.textContent = txt; const bw = Math.min(maxW, bubble.offsetWidth + 4);
  bubble.innerHTML = shown + (shown.length < txt.length ? '<i class="caret"></i>' : '');
  bubble.style.width = bw + 'px';
  const left = clamp(headX - bw * 0.35, 30, W - bw - 30);
  bubble.style.left = left + 'px'; bubble.style.setProperty('--tail', clamp(headX - left, 50, bw - 50) + 'px');
  bubble.style.top = 'auto'; bubble.style.bottom = (H - headY + 40) + 'px';
  show(bubble, clamp((t - t0 + 0.05) / 0.25) * (1 - clamp((t - (t0 + len + 0.7)) / 0.3)), 20, 0.9);
}

// ---------------------------------------------------------------- интерфейс кадра
const chipItems = [['crown', E1 + 0.9], ...MONTAGE.map((id, i) => [id, L.f_more.t - 0.3 + i * 1.2 + 0.6])];
$('#chips').innerHTML = chipItems.map(([id]) => `<div class="chip"><span class="em">${acc(id).emoji}</span>${acc(id).name}</div>`).join('') + `<div class="chip more">+${CAT.accessories.length - chipItems.length} вещей в гардеробе</div>`;
const SWO = ['cosmos', ...SWAPS.map(s => s[1])], swNames = SWO.map(id => outfit(id));
$('#swatches').innerHTML = [...swNames, outfit('snow'), outfit('mint')].map(o => `<div class="sw" data-o="${o.id}"><i style="background:linear-gradient(135deg, ${o.swatch[0]} 55%, ${o.swatch[1]} 55%)"></i>${o.name}</div>`).join('');
const els = { brand: $('#brand'), intro: $('#intro'), endtxt: $('#endtxt'), caption: $('#caption'), chips: [...document.querySelectorAll('.chip')], sw: $('#swatches'), weather: $('#weather'), rps: $('#rps'), games: [...document.querySelectorAll('#games div')], flash: $('#flash'), cursor: $('#cursor') };
function ui(t, headX, headY) {
  els.brand.style.opacity = win(t, 4.4, tEnd - 0.3, 0.4, 0.4).toFixed(3);
  for (const [id, [a, b]] of Object.entries(S)) show($('#t_' + id), win(t, a + 0.1, b - 0.3, 0.35, 0.3), 24, 0.96);
  show(els.intro, win(t, 0.6, 4.1, 0.45, 0.35), 40, 0.96);
  els.flash.style.opacity = (Math.max(0, 1 - Math.abs(t - 4.42) / 0.12) * 0.4 + Math.max(0, 1 - Math.abs(t - tEnd) / 0.12) * 0.4 + Math.max(0, 1 - Math.abs(t - CLEAR) / 0.1) * 0.25).toFixed(3);
  const u = TL.lines.find(l => l.who === 'user' && t >= l.t - 0.35 && t <= end(l) + 0.6);
  if (u) { show(els.caption, win(t, u.t - 0.35, end(u) + 0.25, 0.25, 0.3), 20, 0.96, 'translateX(-50%)'); $('#ctext').textContent = '«' + typed(u.text, t, u.t, u.text.length / (u.dur * 0.85)) + '»'; $('#cwave').querySelectorAll('i').forEach((b, i) => { b.style.height = (6 + (t < end(u) ? 26 * Math.abs(Math.sin(t * 9 + i * 1.3)) * (0.5 + rnd(i) * 0.5) : 0)) + 'px'; }); }
  else els.caption.style.opacity = 0;
  // список вещей
  els.chips.forEach((c, i) => { const a = i < chipItems.length ? chipItems[i][1] : end(L.f_more) - 0.4; show(c, win(t, a, S.acc[1] - 0.3, 0.3, 0.3), 0, 0.8, `translateX(${((1 - win(t, a, S.acc[1] - 0.3, 0.3, 0.3)) * 80).toFixed(0)}px)`); });
  // палитра нарядов
  const ks = win(t, OB + OT - 0.3, S.outfit[1] - 0.3, 0.35, 0.3);
  els.sw.style.opacity = ks.toFixed(3); els.sw.style.transform = `translateX(${((1 - ks) * 80).toFixed(0)}px)`;
  const nowO = outfitAt(t);
  els.sw.querySelectorAll('.sw').forEach(d => d.classList.toggle('on', d.dataset.o === nowO));
  // погода
  show(els.weather, win(t, L.u_weather.t + 0.6, S.weather[1] - 0.3, 0.35, 0.3), 30, 0.9);
  els.weather.style.left = '40px'; els.weather.style.right = 'auto';
  // камень-ножницы-бумага и список игр
  show(els.rps, win(t, L.u_rps.t + 0.3, S.games[1] - 0.3, 0.35, 0.3), 30, 0.9);
  els.rps.style.left = '40px'; els.rps.style.right = 'auto';
  $('#rpsF').textContent = t >= L.f_rps.t ? '✌️' : ['✊', '✌️', '✋'][Math.floor(t * 7) % 3];
  $('#rpsRes').textContent = t >= L.f_rps.t + 0.6 ? 'Ты победил! 🎉' : '';
  els.games.forEach((g, i) => { const k = win(t, end(L.f_rps) + 0.2 + i * 0.18, S.games[1] - 0.3, 0.3, 0.3); g.style.opacity = k; g.style.transform = `translateY(${((1 - k) * 20).toFixed(0)}px)`; });
  document.querySelector('#games').style.left = '40px'; document.querySelector('#games').style.right = 'auto';
  // мышь гладит Феликса по голове
  const kc = win(t, PAT[0] - 0.3, PAT[1], 0.25, 0.3);
  els.cursor.style.opacity = kc.toFixed(3);
  if (kc > 0) { const r = t >= PAT[0] ? Math.sin((t - PAT[0]) * 16) * 46 : 0; els.cursor.style.transform = `translate(${(headX + r - 4).toFixed(1)}px, ${(headY - 70 + Math.abs(Math.cos((t - PAT[0]) * 16)) * 10).toFixed(1)}px)`; }
  // финал с QR-кодом
  const ke = clamp((t - tEnd - 0.2) / 0.6);
  els.endtxt.style.opacity = ke; els.endtxt.style.transform = `translateY(${(30 * (1 - ease(ke))).toFixed(1)}px)`;
  $('#qr').style.transform = `scale(${(1 + 0.025 * Math.max(0, Math.sin((t - tEnd) * 3))).toFixed(4)})`;
}

const headV = new THREE.Vector3(), tmpV = new THREE.Vector3();
window.renderFrame = function (t) {
  const dt = 1 / FPS;
  if (simT < 0 || t < simT || t - simT > 3) simT = Math.max(0, t - 3);
  let pxPerM = 0;
  while (simT <= t + 1e-6) { pxPerM = step(simT, dt); simT += dt; }
  renderer.render(scene, camera);
  B.head.getWorldPosition(headV);
  const hx = headV.x * pxPerM + W / 2, hy = H / 2 - headV.y * pxPerM;
  WEARS.forEach(([a, , d], i) => { if (!landAt[i] && t >= a + d * 0.72 && meshes[i].parent) { meshes[i].getWorldPosition(tmpV); landAt[i] = { x: tmpV.x * pxPerM + W / 2, y: H / 2 - tmpV.y * pxPerM }; } });
  ui(t, hx, hy);
  bubbleAt(t, hx, hy - 0.16 * pxPerM);
  drawFx(t, hx, hy);
  return true;
};
window.setStrip = y => { $('#root').style.transform = y ? `translateY(${-y}px)` : ''; return true; };
window.promoDur = TL.dur;
