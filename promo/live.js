// Вертикальный ролик «Феликс 1.3 — живой Феликс» (1080×1920): всё считается от времени t (покадровый рендер, 30 к/с).
// Позы и эффекты — из программы (app/ui/fx3d.js), реплики и моменты действий — live_timeline.json (make_audio_live.py).
// Только новое в 1.3: экран телефона видеопотоком 60 к/с и мышь как палец, погладить, перенести и уронить,
// монетка и кубик в 3D, погода у головы, танец под музыку.
import * as THREE from 'three';
import { GLTFLoader } from 'felix://app/ui/vendor/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'felix://app/ui/vendor/three-vrm.module.js';
import * as WR from 'felix://app/ui/wardrobe3d.js';
import * as FX3 from 'felix://app/ui/fx3d.js';

const $ = s => document.querySelector(s);
const W = 1080, H = 1920;
const TL = await (await fetch('felix://promo/live_timeline.json')).json();
const LIPS = await (await fetch('felix://promo/live_lipsync.json')).json();
const CAT = await (await fetch('felix://app/ui/wardrobe-catalog.json')).json(); WR.setCatalog(CAT);
const FPS = TL.fps, EV = TL.ev;
const L = Object.fromEntries(TL.lines.map(l => [l.id, l]));
const end = l => l.t + l.dur;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const outBack = k => { k = clamp(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const win = (t, a, b, fi = 0.35, fo = 0.35) => (t < a || t > b + fo ? 0 : t < a + fi ? ease((t - a) / fi) : t <= b ? 1 : 1 - ease((t - b) / fo));
function show(el, k, dy = 30, sc = 0.94, extra = '') { el.style.opacity = k.toFixed(3); el.style.transform = `${extra} translateY(${((1 - k) * dy).toFixed(1)}px) scale(${lerp(sc, 1, k).toFixed(4)})`; }
const typed = (text, t, t0, cps) => text.slice(0, Math.max(0, Math.floor((t - t0) * cps)));
const rnd = FX3.rnd;

const CLOVER = '<g fill="currentColor"><circle cx="12" cy="7.2" r="3.6"/><circle cx="16.8" cy="12" r="3.6"/><circle cx="12" cy="16.8" r="3.6"/><circle cx="7.2" cy="12" r="3.6"/></g><circle cx="12" cy="12" r="1.6" fill="#0c6e64"/>';
for (const id of ['#brandclover', '#endclover']) { $(id).innerHTML = CLOVER; $(id).style.color = '#fff'; }
$('#cwave').innerHTML = '<i></i>'.repeat(10);
const TOOL_ICONS = ['<path d="M15 5 8 12l7 7"/>', '<circle cx="12" cy="12" r="6.5"/>', '<rect x="6" y="6" width="12" height="12" rx="2"/>', '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5h4"/>',
  '<rect x="5.5" y="10.5" width="13" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>', '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M15.5 12h5M18 9.5v5"/>'];
$('#tools').innerHTML = TOOL_ICONS.map(p => `<span><svg viewBox="0 0 24 24">${p}</svg></span>`).join('');

// ---------------------------------------------------------------- сцены
const S = {
  phone: [EV.phone[0], EV.phone[1]], pet: [EV.phone[1], EV.grab - 0.9], drag: [EV.grab - 0.9, L.u_coin.t - 0.6],
  toss: [L.u_coin.t - 0.6, L.u_weather.t - 0.5], weather: [L.u_weather.t - 0.5, EV.dance[0] - 0.2], dance: [EV.dance[0] - 0.2, EV.end]
};
const POS = { intro: { x: 540, y: 1905, h: 1180 }, phone: { x: 880, y: 1900, h: 600 }, pet: { x: 540, y: 1900, h: 1250 }, drag: { x: 560, y: 1900, h: 980 },
  toss: { x: 620, y: 1900, h: 1000 }, weather: { x: 700, y: 1900, h: 1050 }, dance: { x: 540, y: 1900, h: 1150 }, fin: { x: 540, y: 1915, h: 520 } };
function placement(t) {
  const marks = [[0, POS.intro], [S.phone[0], POS.phone], [S.pet[0], POS.pet], [S.drag[0], POS.drag], [S.toss[0], POS.toss], [S.weather[0], POS.weather], [S.dance[0], POS.dance], [EV.end, POS.fin]];
  let p = marks[0][1];
  for (let i = 1; i < marks.length; i++) { const [t0, to] = marks[i], from = marks[i - 1][1]; if (t >= t0) { const k = ease((t - t0) / 0.8); p = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), h: lerp(from.h, to.h, k) }; } }
  return p;
}

// ---- перетаскивание: смещение ног от места (px), пока держат, падает и подпрыгивает
const Tg = EV.grab, Td = EV.drop, Tl = EV.land;
function holdOff(t) {                                         // пока держат: поднять и качать
  const u = clamp((t - Tg) / 0.6), ts = t - Tg - 0.45;
  let dx = 0, dy = -560 * ease(u);
  if (ts > 0) { dx = 240 * Math.sin(ts * 2 * Math.PI * 0.9) * clamp(ts / 0.35); dy += 34 * Math.sin(ts * 2 * Math.PI * 1.8); }
  return { dx, dy };
}
const REL = holdOff(Td), DRIFT = (holdOff(Td + 0.01).dx - holdOff(Td - 0.01).dx) / 0.02 * 0.25;
function dragOff(t) {
  if (t < Tg) return { dx: 0, dy: 0, mode: '' };
  if (t < Td) return { ...holdOff(t), mode: 'hold' };
  const back = 1 - ease((t - S.toss[0]) / 0.8);               // к следующей сцене — плавно на место
  if (t < Tl) { const u = (t - Td) / (Tl - Td); return { dx: REL.dx + DRIFT * (t - Td), dy: REL.dy * (1 - u * u), mode: 'fall' }; }
  const s = t - Tl, dx = (REL.dx + DRIFT * (Tl - Td)) * back;
  const dy = s < 0.16 ? -30 * Math.sin(s / 0.16 * Math.PI) : s < 0.27 ? -10 * Math.sin((s - 0.16) / 0.11 * Math.PI) : 0;
  return { dx, dy, mode: s < 0.5 ? 'land' : '' };
}

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
const coin = FX3.makeCoin(), dice = FX3.makeDice();
coin.visible = dice.visible = false; scene.add(coin); scene.add(dice);
const GRAB = 0.78;                                             // держат за грудь (доля роста)
const DIR = -1, AXIS = new THREE.Vector3(0.35, 0.8, -0.48).normalize();

const BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];
const B = {}; for (const b of BONES) B[b] = vrm.humanoid.getNormalizedBoneNode(b);
vrm.scene.updateMatrixWorld(true);
const hp0 = new THREE.Vector3(); B.head.getWorldPosition(hp0);
const modelH = hp0.y + 0.16, hips0 = B.hips.position.y;

const E = (x = 0, y = 0, z = 0) => ({ x, y, z });
const target = {}, cur = {};
for (const b of BONES) { target[b] = E(); cur[b] = E(); }
let hipsY = 0;
const expr = { happy: 0, relaxed: 0, surprised: 0 };
const SW = { a: 0, v: 0 };
const chestV = new THREE.Vector3(), headV = new THREE.Vector3(), tmpV = new THREE.Vector3();
let pxNow = 600, headScr = { x: 540, y: 800 }, handScr = { x: 0, y: 0 };

// гладят: где ладонь (экран) в момент t
const PET0 = EV.pet[0], PET1 = EV.pet[1];
function petHand(t, hx, hy, ppm) {
  const ts = t - (PET0 + 0.5);
  if (ts < 0) { const k = ease((t - (PET0 - 0.4)) / 0.9); return { x: lerp(1060, hx + 0.12 * ppm, k), y: lerp(hy - 380, hy - 0.21 * ppm, k) }; }
  return { x: hx + Math.cos(ts * 2 * Math.PI * 1.5) * 0.12 * ppm, y: hy - 0.21 * ppm + Math.abs(Math.sin(ts * 2 * Math.PI * 1.5)) * 0.018 * ppm };
}

function poseAt(t, dt) {
  for (const b of BONES) target[b] = E();
  target.leftUpperArm = E(0, 0, -1.25); target.rightUpperArm = E(0, 0, 1.25);
  target.leftLowerArm = E(0, -0.2, -0.1); target.rightLowerArm = E(0, 0.2, 0.1);
  target.leftUpperLeg = E(0, 0, 0.035); target.rightUpperLeg = E(0, 0, -0.035);
  let hy = 0, mouthX = 0;
  const ex = { happy: 0, relaxed: 0, surprised: 0 };
  const apply = r => { if (!r) return; if (r.hy) hy += r.hy; for (const e of ['happy', 'relaxed', 'surprised']) if (r[e]) ex[e] = Math.max(ex[e], r[e]); if (r.mouth) mouthX = Math.max(mouthX, r.mouth); };
  const br = Math.sin(t * 1.6);
  target.chest.x = br * 0.015; target.spine.x = br * 0.01; target.hips.z = Math.sin(t * 0.55) * 0.02;
  // взгляд: в окно «Телефон», на ладонь, на монетку, на тучку
  let lx = 0, ly = root.position.y + modelH * 0.92;
  if (t >= S.phone[0] + 0.6 && t < S.phone[1]) lx = -3;
  target.head.y = clamp(lx, -1, 1) * 0.3 + Math.sin(t * 0.4) * 0.05; target.neck.y = clamp(lx, -1, 1) * 0.12;
  const talking = TL.lines.some(l => l.who === 'felix' && t >= l.t && t <= end(l));
  const listening = TL.lines.some(l => l.who === 'user' && t >= l.t - 0.2 && t <= end(l) + 0.3);
  const d = dragOff(t), toss = (t >= EV.coin && t < EV.coin + FX3.COIN_T.end) || (t >= EV.dice && t < EV.dice + 3.2);
  const danceK = win(t, EV.dance[0], EV.dance[1], 0.6, 0.6), busy = d.mode || toss || danceK > 0.3 || (t >= PET0 && t < PET1);
  if (talking && !busy) { target.head.x += Math.sin(t * 5) * 0.03; target.head.z = Math.sin(t * 1.7) * 0.05; target.rightUpperArm = E(-0.35, 0, 1.12); target.rightLowerArm = E(0, 1.25 + Math.sin(t * 3) * 0.15, 0.05); target.rightHand = E(0, 0, 0.2 + Math.sin(t * 4) * 0.1); }
  if (listening && !busy) { target.head.z = 0.14; target.spine.x = 0.05; target.head.x += 0.05; ex.surprised = 0.15; }
  const wave = (t >= 1.0 && t <= 3.6) || (t >= L.f_end.t - 0.2 && t <= end(L.f_end) + 0.4);
  if (wave) { const s = t * 10; target.rightUpperArm = E(0, -0.4, 0.02); target.rightLowerArm = E(0, 0.1, -1.5 + Math.sin(s) * 0.3); target.rightHand = E(-1.5, 0, Math.sin(s + 0.6) * 0.25); target.head.z = 0.08; ex.happy = 0.9; }
  // окно «Телефон» открылось — довольно кивает
  if (t >= S.phone[0] + 0.6 && t < S.phone[1]) ex.happy = Math.max(ex.happy, 0.35);
  // гладят по голове
  const kp = win(t, PET0 + 0.6, PET1 - 0.2, 0.4, 0.5);
  if (kp > 0) { apply(FX3.petPose(target, kp, clamp((handScr.x - headScr.x) / (0.3 * pxNow), -1, 1), t)); ly = root.position.y + modelH * 1.3; }
  // держат, падает, приземлился, кружится голова
  if (d.mode === 'hold') { hy = 0; apply(FX3.dragPose(target, clamp((t - Tg) / 0.25), t, d.vx || 0)); }
  else if (d.mode === 'fall') apply(FX3.fallPose(target));
  else if (d.mode === 'land') { hy = 0; apply(FX3.landPose(target, (t - Tl) / 0.5, 1)); }
  const dz = t - Tl - 0.3;
  if (dz >= 0 && dz < 2.6) apply(FX3.dizzyPose(target, dz));
  // монетка и кубик
  if (t >= EV.coin && t < EV.coin + FX3.COIN_T.end) {
    const tt = t - EV.coin, flick = tt < 0.3 ? tt / 0.3 : tt < 1.3 ? 1 - (tt - 0.3) * 0.3 : 0;
    FX3.tossPose(target, DIR, clamp(flick + (tt > 1.2 && tt < 3.3 ? 0.8 : 0)));
    lx = (coin.position.x - root.position.x) * 2; ly = coin.position.y; if (tt > 0.3 && tt < 1.3) ex.surprised = 0.4; if (tt > 1.35) ex.happy = 0.8;
  }
  if (t >= EV.dice && t < EV.dice + 3.2) {
    const tt = t - EV.dice; FX3.tossPose(target, DIR, clamp(tt < 0.3 ? tt / 0.3 : 1 - (tt - 0.3) * 1.5));
    lx = (dice.position.x - root.position.x) * 2; ly = dice.position.y; target.head.x += 0.18; if (tt > 1.35) ex.happy = 0.9;
  }
  // погода
  const kw = win(t, EV.weather + 0.1, EV.dance[0] - 0.4, 0.5, 0.5);
  if (kw > 0) { apply(FX3.weatherPose(target, 'rain', kw, t, WR)); lx = -2; ly = root.position.y + modelH * 1.2; }
  // танец
  apply(FX3.dancePose(target, danceK, t, talking));
  target.head.y += clamp(lx, -1, 1) * 0.15;
  lookTarget.position.set(root.position.x + lx, ly, 4);
  if (t < 0.9) ex.happy = 0.6;
  return { hy, ex, mouthX, d };
}
function blinkAt(t) { const ph = (t % 3.7) / 3.7; const k = Math.abs(ph - 0.97) < 0.03 ? 1 - Math.abs(ph - 0.97) / 0.03 : 0; return t > 0.6 ? k : 0; }

let simT = -1;
function step(t, dt) {
  const p = placement(t), pxPerM = p.h / modelH;
  pxNow = pxPerM;
  const d = dragOff(t);
  d.vx = (dragOff(t + 0.01).dx - dragOff(t - 0.01).dx) / 0.02;
  camera.left = -W / 2 / pxPerM; camera.right = W / 2 / pxPerM; camera.top = H / 2 / pxPerM; camera.bottom = -H / 2 / pxPerM; camera.updateProjectionMatrix();
  root.position.set((p.x + d.dx - W / 2) / pxPerM, (H / 2 - p.y - d.dy) / pxPerM, 0);
  const r = poseAt(t, dt);
  const k = 1 - Math.exp(-dt * 9);
  for (const b of BONES) { const n = B[b]; if (!n) continue; const c = cur[b], g = target[b]; c.x += (g.x - c.x) * k; c.y += (g.y - c.y) * k; c.z += (g.z - c.z) * k; n.rotation.set(c.x, c.y, c.z); }
  hipsY += (r.hy - hipsY) * k; B.hips.position.y = hips0 + hipsY;
  for (const e of Object.keys(expr)) expr[e] += (r.ex[e] - expr[e]) * k;
  const em = vrm.expressionManager, fi = Math.min(LIPS.length - 1, Math.max(0, Math.round(t * FPS))), m = Math.max(r.mouthX, Math.min(1, (LIPS[fi] || 0) * 1.25));
  em.setValue('aa', m * 0.75); em.setValue('oh', m * 0.3 * (Math.sin(t * 23) * 0.5 + 0.5)); em.setValue('ih', m * 0.25 * (Math.cos(t * 29) * 0.5 + 0.5));
  em.setValue('happy', expr.happy); em.setValue('relaxed', expr.relaxed); em.setValue('surprised', expr.surprised);
  em.setValue('blink', expr.happy > 0.5 ? 0 : blinkAt(t));
  // раскачивание вокруг точки, за которую держат (грудь)
  const want = d.mode === 'hold' ? clamp(-(d.vx / pxPerM) * 0.2, -0.75, 0.75) : 0;
  SW.v += ((want - SW.a) * 55 - SW.v * (d.mode === 'hold' ? 5 : 9)) * dt; SW.a += SW.v * dt;
  FX3.swingAbout(turn, SW.a, 0, modelH * GRAB);
  const sc = t < 0.3 ? 0.001 : t < 1.2 ? outBack((t - 0.3) / 0.9) : 1;
  const spinY = t < 1.2 ? (1 - ease((t - 0.3) / 0.9)) * Math.PI * 2.2 : 0;
  const facing = t < S.phone[0] + 0.5 || t >= EV.end ? 0 : t < S.phone[1] ? -0.3 : t >= S.weather[0] && t < S.dance[0] ? -0.15 : 0.05;
  turn.rotation.y = facing + spinY;
  turn.scale.setScalar(Math.max(0.001, sc));
  vrm.scene.updateMatrixWorld(true);
  // монетка и кубик — после позы (рука на месте)
  B.chest.getWorldPosition(chestV);
  const p0 = chestV.clone().add(new THREE.Vector3(DIR * 0.16, -0.12, 0.3));
  coin.visible = t >= EV.coin && t < EV.coin + FX3.COIN_T.end;
  if (coin.visible) FX3.coinStep(coin, p0, DIR, false, t - EV.coin);
  dice.visible = t >= EV.dice && t < EV.dice + FX3.DICE_T.end;
  if (dice.visible) FX3.diceStep(dice, p0, new THREE.Vector3(root.position.x + DIR * 0.3, root.position.y + 0.06, 0.4), DIR, 6, AXIS, t - EV.dice);
  WR.updateAccessories(vrm, t);
  vrm.update(dt);
  return pxPerM;
}

// ---------------------------------------------------------------- экран телефона (рисуется как кадры видеопотока)
const scr = $('#scr'), sc2 = scr.getContext('2d'), SWD = 450, SHT = 976;
const D0 = EV.draw[0];
// касания: [начало, конец, x0, y0, x1, y1] — палец на экране телефона (px экрана)
const STROKES = [[5.7, 6.45, 230, 760, 230, 300], [7.25, 7.95, 250, 330, 250, 700], [8.45, 9.0, 230, 760, 230, 330]];
const HEART = u => ({ x: 225 + 16 * Math.pow(Math.sin(u), 3) * 10, y: 470 - (13 * Math.cos(u) - 5 * Math.cos(2 * u) - 2 * Math.cos(3 * u) - Math.cos(4 * u)) * 10 });
const DRAW = [[D0 + 0.5, D0 + 3.3, 'heart'], [D0 + 3.8, D0 + 4.9, 'wave']];
function waveAt(u) { return { x: 95 + u * 260, y: 760 + Math.sin(u * Math.PI * 3) * 34 }; }
function finger(t) {                                           // { x, y, down } в px экрана телефона, или null
  for (const [a, b, x0, y0, x1, y1] of STROKES) if (t >= a && t <= b) { const k = ease((t - a) / (b - a)); return { x: lerp(x0, x1, k), y: lerp(y0, y1, k), down: true }; }
  for (const [a, b, kind] of DRAW) if (t >= a && t <= b) { const u = (t - a) / (b - a); return { ...(kind === 'heart' ? HEART(u * Math.PI * 2) : waveAt(u)), down: true }; }
  // между касаниями мышь просто переходит к следующему
  const pts = [...STROKES.map(s => [s[0], s[1], s[2], s[3], s[4], s[5]]), ...DRAW.map(([a, b, kind]) => { const p0 = kind === 'heart' ? HEART(0) : waveAt(0), p1 = kind === 'heart' ? HEART(Math.PI * 2) : waveAt(1); return [a, b, p0.x, p0.y, p1.x, p1.y]; })].sort((p, q) => p[0] - q[0]);
  if (t < pts[0][0]) return { x: lerp(560, pts[0][2], ease((t - (pts[0][0] - 0.9)) / 0.9)), y: lerp(1100, pts[0][3], ease((t - (pts[0][0] - 0.9)) / 0.9)), down: false };
  for (let i = 0; i < pts.length - 1; i++) if (t > pts[i][1] && t < pts[i + 1][0]) { const k = ease((t - pts[i][1]) / (pts[i + 1][0] - pts[i][1])); return { x: lerp(pts[i][4], pts[i + 1][2], k), y: lerp(pts[i][5], pts[i + 1][3], k), down: false }; }
  const last = pts[pts.length - 1]; return { x: last[4] + (t - last[1]) * 40, y: last[5] + (t - last[1]) * 30, down: false };
}
function scrollAt(t) {                                         // лента едет ровно за пальцем, после отпускания — по инерции
  let s = 0;
  for (const [a, b, , y0, , y1] of STROKES) {
    if (t < a) break;
    if (t <= b) { s += y0 - lerp(y0, y1, ease((t - a) / (b - a))); break; }
    const v = (y0 - y1) / (b - a) * 0.5;
    s += (y0 - y1) + v * (1 - Math.exp(-(t - b) * 4)) / 4;
  }
  return s;
}
const CARD_C = [['#ff8fb3', '#ffd1df'], ['#5ef0d8', '#b9fff2'], ['#ffd84a', '#fff0b0'], ['#8ab4ff', '#d7e4ff'], ['#c59bff', '#ecdcff'], ['#ff9a4d', '#ffd8b9']];
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function drawPhone(t) {
  const c = sc2;
  c.clearRect(0, 0, SWD, SHT);
  const drawing = t >= D0 - 0.25;
  c.fillStyle = drawing ? '#f7f9fb' : '#0f1418'; c.fillRect(0, 0, SWD, SHT);
  // строка состояния
  c.fillStyle = drawing ? '#1d2b36' : '#e8f0f4'; c.font = '600 22px "Segoe UI"'; c.textAlign = 'left'; c.fillText('12:30', 34, 46);
  c.textAlign = 'right'; c.fillText('84% ▮', SWD - 30, 46);
  if (!drawing) {
    c.fillStyle = '#e8f0f4'; c.font = '700 34px "Segoe UI Variable Display", "Segoe UI"'; c.textAlign = 'left'; c.fillText('Лента', 28, 112);
    c.save(); c.beginPath(); c.rect(0, 136, SWD, SHT - 136); c.clip();
    const off = scrollAt(t), CH = 300;
    for (let i = -1; i < 6; i++) {
      const n = Math.floor(off / CH) + i, y = 146 + n * CH - off, col = CARD_C[((n % 6) + 6) % 6];
      rr(c, 18, y, SWD - 36, CH - 20, 22); c.fillStyle = '#1a2228'; c.fill();
      const g = c.createLinearGradient(18, y, SWD - 18, y + 160); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]);
      rr(c, 30, y + 64, SWD - 60, 150, 16); c.fillStyle = g; c.fill();
      c.fillStyle = col[0]; c.beginPath(); c.arc(56, y + 34, 18, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#c9d6dc'; rr(c, 86, y + 22, 150, 12, 6); c.fill(); c.fillStyle = '#6c7c84'; rr(c, 86, y + 40, 96, 10, 5); c.fill();
      c.fillStyle = '#9fb0b8'; c.font = '600 20px "Segoe UI"'; c.textAlign = 'left'; c.fillText('♥ ' + (100 + ((n * 37) % 400 + 400) % 400), 32, y + 246);
    }
    c.restore();
  } else {
    // «Рисовалка»: линия ровно за пальцем
    c.fillStyle = '#1d2b36'; c.font = '700 34px "Segoe UI Variable Display", "Segoe UI"'; c.textAlign = 'left'; c.fillText('Рисовалка', 28, 112);
    ['#1FB5A3', '#ff6b9a', '#ffb703', '#4f75ad'].forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.arc(SWD - 170 + i * 42, 100, 15, 0, Math.PI * 2); c.fill(); if (i === 1) { c.strokeStyle = '#1d2b36'; c.lineWidth = 3; c.stroke(); } });
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const [a, b, kind] of DRAW) {
      if (t < a) continue;
      const u1 = clamp((t - a) / (b - a)), n = Math.max(2, Math.ceil(u1 * 160));
      c.strokeStyle = kind === 'heart' ? '#ff6b9a' : '#1FB5A3'; c.lineWidth = 14; c.beginPath();
      for (let i = 0; i <= n; i++) { const u = u1 * i / n, p = kind === 'heart' ? HEART(u * Math.PI * 2) : waveAt(u); i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y); }
      c.stroke();
    }
  }
  // переход «лента → рисовалка»: шторка
  const sw = win(t, D0 - 0.5, D0 - 0.05, 0.25, 0.25);
  if (sw > 0) { c.fillStyle = `rgba(0,0,0,${(sw * 0.6).toFixed(3)})`; c.fillRect(0, 0, SWD, SHT); }
}
const SCR_X = 44 + (610 - 474) / 2 + 12, SCR_Y = 360 + 92 + 12;    // где экран телефона в кадре

// ---------------------------------------------------------------- частицы и эффекты на 2D-слое
$('#fx').width = W; $('#fx').height = H;
const fx = $('#fx').getContext('2d');
function leaf(x, y, r, rot, color, a) { fx.save(); fx.globalAlpha = a; fx.translate(x, y); fx.rotate(rot); fx.fillStyle = color; for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2; fx.beginPath(); fx.arc(Math.cos(an) * r * 0.62, Math.sin(an) * r * 0.62, r * 0.58, 0, Math.PI * 2); fx.fill(); } fx.restore(); }
function burst(t, t0, cx, cy, n, seed, color = '#1FB5A3') { const k = t - t0; if (k < 0 || k > 2.2) return; for (let i = 0; i < n; i++) { const a = rnd(seed + i) * Math.PI * 2, s = 260 + rnd(seed + i + 99) * 620; leaf(cx + Math.cos(a) * s * k, cy + Math.sin(a) * s * k + 380 * k * k, 9 + rnd(seed + i * 3) * 13, k * (rnd(seed + i * 7) - 0.5) * 9, rnd(seed + i * 5) < 0.3 ? '#26303F' : color, clamp(1 - k / 2.2)); } }
function sparks(t, t0, x, y, seed, col = '#5EF0D8') { const k = t - t0; if (k < 0 || k > 1.1) return; for (let i = 0; i < 24; i++) { const a = rnd(seed + i) * Math.PI * 2, s = 120 + rnd(seed + i + 5) * 280; fx.save(); fx.globalAlpha = clamp(1 - k / 1.1); fx.fillStyle = col; fx.shadowColor = col; fx.shadowBlur = 14; fx.beginPath(); fx.arc(x + Math.cos(a) * s * k, y + Math.sin(a) * s * k + 120 * k * k, 4 + rnd(seed + i * 2) * 3, 0, Math.PI * 2); fx.fill(); fx.restore(); } }
const scrOf = v => ({ x: v.x * pxNow + W / 2, y: H / 2 - v.y * pxNow });
function drawFx(t, hx, hy, footScr) {
  fx.clearRect(0, 0, W, H);
  const intro = t < 4.6, fin = t > EV.end - 0.2;
  if (intro || fin) for (let i = 0; i < 30; i++) { const sp = 70 + rnd(i) * 80, x = rnd(i + 50) * W + Math.sin(t * 0.8 + i) * 30, y = ((rnd(i + 80) * H + t * sp) % (H + 80)) - 40; leaf(x, y, 8 + rnd(i + 3) * 10, t * (rnd(i + 9) - 0.5) * 2, '#5EF0D8', intro ? 0.22 * (1 - clamp((t - 4.0) / 0.6)) : 0.22 * clamp((t - EV.end + 0.2) / 0.6)); }
  burst(t, 0.3, 540, 1300, 70, 1); burst(t, EV.end, 540, 1500, 60, 400);
  // сердечки от ладони
  for (let i = 0; i < 26; i++) {
    const tb = PET0 + 0.8 + i * 0.21, a = t - tb;
    if (tb > PET1 || a < 0 || a > 1.7) continue;
    const hp = petHand(tb, hx, hy, pxNow), s = 16 + rnd(700 + i) * 12;
    fx.save(); fx.globalAlpha = clamp(1 - a / 1.7) * clamp(a / 0.15); fx.shadowColor = '#ff6b9a'; fx.shadowBlur = 10;
    FX3.drawHeart(fx, hp.x + (rnd(710 + i) - 0.5) * 90 + Math.sin(a * 4 + i) * 16, hp.y - 30 - a * (150 + rnd(720 + i) * 80), s); fx.restore();
  }
  // приземлился: листики, кружится голова — звёздочки
  burst(t, Tl, footScr.x, footScr.y - 10, 26, 900, '#5EF0D8');
  const dz = t - Tl - 0.3;
  if (dz >= 0 && dz < 2.6) for (let i = 0; i < 3; i++) {
    const an = dz * 5 + i * Math.PI * 2 / 3, a = clamp(1 - (dz - 2.0) / 0.6);
    fx.save(); fx.globalAlpha = a; fx.fillStyle = '#ffd54a'; fx.shadowColor = '#ffb300'; fx.shadowBlur = 12; fx.font = '700 44px "Segoe UI Symbol"'; fx.textAlign = 'center';
    fx.fillText('✦', hx + Math.cos(an) * 0.16 * pxNow, hy - 0.2 * pxNow + Math.sin(an) * 0.05 * pxNow); fx.restore();
  }
  // монетка поймана, кубик лёг
  if (t > EV.coin + 1.3) sparks(t, EV.coin + 1.3, scrOf(coin.position).x, scrOf(coin.position).y, 1000, '#ffd84a');
  if (t > EV.dice + 1.3 && t < EV.dice + 3) sparks(t, EV.dice + 1.3, scrOf(dice.position).x, scrOf(dice.position).y, 1100, '#ffd84a');
  // погода у головы
  const kw = win(t, EV.weather, EV.dance[0] - 0.3, 0.4, 0.5);
  if (kw > 0) FX3.drawWeather(fx, { sky: 'rain', x: hx - 0.6 * pxNow, y: hy - 0.12 * pxNow, s: 0.16 * pxNow, floor: footScr.y - 6, t: t - EV.weather, a: kw, temp: 6 });
  // нотки в танце — каждые две доли
  for (let i = 0; i < 20; i++) {
    const tb = EV.dance[0] + 0.4 + i * TL.beat * 2, a = t - tb;
    if (tb > EV.dance[1] || a < 0 || a > 2.2) continue;
    fx.save(); fx.globalAlpha = clamp(1 - a / 2.2) * clamp(a / 0.2); fx.fillStyle = '#5EF0D8'; fx.shadowColor = '#1FB5A3'; fx.shadowBlur = 14;
    fx.font = `700 ${56 + rnd(800 + i) * 24}px "Segoe UI Symbol"`; fx.textAlign = 'center';
    fx.fillText(i % 2 ? '♫' : '♪', hx + (rnd(810 + i) - 0.5) * 460 + Math.sin(a * 3 + i) * 20, hy - 60 - a * 190); fx.restore();
  }
}

// ---------------------------------------------------------------- облачко
const bubble = $('#bubble');
function bubbleAt(t, headX, headY) {
  let txt = null, t0 = 0, len = 0;
  for (const l of TL.lines) { if (l.who !== 'felix' || l.id === 'hello' || l.id === 'f_end') continue; if (t >= l.t - 0.05 && t <= end(l) + 1.0) { txt = l.text; t0 = l.t; len = l.dur; } }
  if (!txt) { bubble.style.opacity = 0; return; }
  const shown = typed(txt, t, t0, Math.max(14, txt.length / (len * 0.9)));
  const maxW = t < S.phone[1] ? 380 : 540;
  bubble.style.maxWidth = maxW + 'px'; bubble.style.width = 'auto';
  bubble.textContent = txt; const bw = Math.min(maxW, bubble.offsetWidth + 4);
  bubble.innerHTML = shown + (shown.length < txt.length ? '<i class="caret"></i>' : '');
  bubble.style.width = bw + 'px';
  const left = clamp(headX - bw * 0.55, 30, W - bw - 30);
  bubble.style.left = left + 'px'; bubble.style.setProperty('--tail', clamp(headX - left, 50, bw - 50) + 'px');
  bubble.style.top = 'auto'; bubble.style.bottom = (H - headY + 40) + 'px';
  show(bubble, clamp((t - t0 + 0.05) / 0.25) * (1 - clamp((t - (t0 + len + 0.7)) / 0.3)), 20, 0.9);
}

// ---------------------------------------------------------------- интерфейс кадра
const els = { brand: $('#brand'), intro: $('#intro'), endtxt: $('#endtxt'), caption: $('#caption'), flash: $('#flash'), cursor: $('#cursor'), hand: $('#hand'),
  pcwin: $('#pcwin'), cmp: [...document.querySelectorAll('.cmp')], dot: $('#touchdot'), result: $('#result'), feat: [...document.querySelectorAll('#endtxt .feat div')] };
function ui(t, hx, hy, footScr) {
  els.brand.style.opacity = win(t, 4.3, EV.end - 0.3, 0.4, 0.4).toFixed(3);
  for (const [id, [a, b]] of Object.entries(S)) show($('#t_' + id), win(t, a + 0.15, b - 0.3, 0.35, 0.3), 24, 0.96);
  show(els.intro, win(t, 0.6, 3.9, 0.45, 0.35), 40, 0.96);
  els.flash.style.opacity = (Math.max(0, 1 - Math.abs(t - (S.phone[0] + 0.55)) / 0.12) * 0.3 + Math.max(0, 1 - Math.abs(t - EV.end) / 0.12) * 0.4 + Math.max(0, 1 - Math.abs(t - Tl) / 0.08) * 0.18).toFixed(3);
  const u = TL.lines.find(l => l.who === 'user' && t >= l.t - 0.35 && t <= end(l) + 0.6);
  if (u) { show(els.caption, win(t, u.t - 0.35, end(u) + 0.25, 0.25, 0.3), 20, 0.96, 'translateX(-50%)'); $('#ctext').textContent = '«' + typed(u.text, t, u.t, u.text.length / (u.dur * 0.85)) + '»'; $('#cwave').querySelectorAll('i').forEach((b, i) => { b.style.height = (6 + (t < end(u) ? 26 * Math.abs(Math.sin(t * 9 + i * 1.3)) * (0.5 + rnd(i) * 0.5) : 0)) + 'px'; }); }
  else els.caption.style.opacity = 0;
  // окно «Телефон» и сравнение
  const kw = win(t, S.phone[0] + 0.5, S.phone[1] - 0.35, 0.4, 0.35);
  show(els.pcwin, kw, 60, 0.9);
  if (kw > 0) drawPhone(t);
  const cmpAt = [L.f_phone.t + 0.4, L.f_phone.t + 1.3, L.f_touch.t + 0.3];
  els.cmp.forEach((c, i) => { const k = win(t, cmpAt[i], S.phone[1] - 0.4, 0.35, 0.3); show(c, k, 0, 0.85, `translateX(${((1 - k) * 80).toFixed(0)}px)`); });
  // курсор: на экране телефона — стрелка, у головы — ладонь, держат — кулак
  const f = finger(t), onPhone = t > S.phone[0] + 1.0 && t < S.phone[1] - 0.4;
  const fxp = SCR_X + f.x, fyp = SCR_Y + f.y;
  let cur = 0, cx = 0, cy = 0;
  if (onPhone) { cur = win(t, S.phone[0] + 1.0, S.phone[1] - 0.6, 0.3, 0.3); cx = fxp; cy = fyp; }
  const dragK = win(t, Tg - 0.8, Td + 0.35, 0.3, 0.3);
  if (dragK > 0 && t < Tg) { const k = ease((t - (Tg - 0.8)) / 0.8); cur = dragK; cx = lerp(1040, footScr.x, k); cy = lerp(1200, footScr.y - GRAB * modelH * pxNow, k); }
  if (t >= Td && t < Td + 0.7) { cur = 1 - clamp((t - Td - 0.3) / 0.4); const r = dragOff(Td); cx = POS.drag.x + r.dx; cy = POS.drag.y + r.dy - GRAB * modelH * pxNow; }
  els.cursor.style.opacity = cur.toFixed(3); els.cursor.style.transform = `translate(${(cx - 12).toFixed(1)}px, ${(cy - 7).toFixed(1)}px)`;
  els.dot.style.opacity = (onPhone && f.down ? 1 : 0) * win(t, S.phone[0] + 1.0, S.phone[1] - 0.6, 0.2, 0.2);
  els.dot.style.left = (f.x + SCR_X - 44) + 'px'; els.dot.style.top = (f.y + SCR_Y - 360) + 'px';
  const petK = win(t, PET0 - 0.4, PET1 - 0.1, 0.3, 0.3), holdK = t >= Tg && t < Td ? 1 : 0;
  if (petK > 0) { els.hand.textContent = '🖐️'; els.hand.style.opacity = petK.toFixed(3); els.hand.style.transform = `translate(${handScr.x.toFixed(1)}px, ${handScr.y.toFixed(1)}px)`; }
  else if (holdK) { els.hand.textContent = '✊'; els.hand.style.opacity = 1; els.hand.style.transform = `translate(${footScr.x.toFixed(1)}px, ${(footScr.y - GRAB * modelH * pxNow).toFixed(1)}px)`; }
  else els.hand.style.opacity = 0;
  // результат монетки и кубика
  const rc = win(t, EV.coin + 1.35, EV.coin + 3.1, 0.25, 0.3), rd = win(t, EV.dice + 1.35, EV.dice + 3.2, 0.25, 0.3);
  if (rc > 0) { els.result.innerHTML = '<span class="em">🪙</span> Решка'; show(els.result, rc, 20, 0.8, 'translateX(-50%)'); }
  else if (rd > 0) { els.result.innerHTML = '<span class="em">🎲</span> Шесть!'; show(els.result, rd, 20, 0.8, 'translateX(-50%)'); }
  else els.result.style.opacity = 0;
  // финал
  const ke = clamp((t - EV.end - 0.2) / 0.6);
  els.endtxt.style.opacity = ke; els.endtxt.style.transform = `translateY(${(30 * (1 - ease(ke))).toFixed(1)}px)`;
  els.feat.forEach((d, i) => { const k = clamp((t - EV.end - 0.6 - i * 0.15) / 0.35); d.style.opacity = k; d.style.transform = `translateY(${((1 - ease(k)) * 20).toFixed(0)}px)`; });
}

window.renderFrame = function (t) {
  const dt = 1 / FPS;
  if (simT < 0 || t < simT - dt || t - simT > 3) simT = Math.max(0, t - 3);
  let pxPerM = 0;
  while (simT <= t + 1e-6) {
    pxPerM = step(simT, dt);
    B.head.getWorldPosition(headV); headScr = scrOf(headV);
    handScr = petHand(simT, headScr.x, headScr.y, pxNow);
    simT += dt;
  }
  renderer.render(scene, camera);
  B.head.getWorldPosition(headV);
  const h = scrOf(headV), footScr = scrOf(root.position);
  ui(t, h.x, h.y, footScr);
  bubbleAt(t, h.x, h.y - (win(t, EV.weather, EV.dance[0] - 0.4, 0.3, 0.3) * 0.32 + 0.16) * pxPerM);   // под дождём руки над головой — облачко выше
  drawFx(t, h.x, h.y, footScr);
  return true;
};
window.setStrip = y => { $('#root').style.transform = y ? `translateY(${-y}px)` : ''; return true; };
window.promoDur = TL.dur;
