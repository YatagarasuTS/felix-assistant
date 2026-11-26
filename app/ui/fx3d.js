// «Живой Феликс» (1.3): позы и эффекты, общие для окна Феликса и рекламных роликов.
// Всё считается от времени и параметров — без своих часов и состояния, как wardrobe3d.js:
// гладят по голове, держат мышью и роняют, танец под музыку, погода у головы, монетка и кубик в 3D.
// Позы меняют target (углы костей) и возвращают поправки: { hy — приседание/подскок, happy, relaxed, surprised, mouth }.
import * as THREE from 'three';

const E = (x = 0, y = 0, z = 0) => ({ x, y, z });
const mix = (o, x, y, z, k) => { o.x += (x - o.x) * k; o.y += (y - o.y) * k; o.z += (z - o.z) * k; };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// ---------------------------------------------------------------- позы
/** Гладят: жмурится, подставляет макушку, голова тянется к руке. side −1…1 — где рука относительно головы */
export function petPose(target, k, side, t) {
  if (k <= 0) return {};
  mix(target.head, -0.1 + Math.sin(t * 3) * 0.03, side * 0.1, -side * 0.16, k);
  mix(target.neck, -0.05, target.neck.y, -side * 0.06, k);
  target.spine.z += -side * 0.04 * k; target.chest.x -= 0.03 * k;
  return { hy: Math.sin(t * 6) * 0.006 * k, happy: k, relaxed: 0.6 * k };
}

/** Держат мышью: висит, болтает ногами (вперёд-назад и в стороны — видно спереди), руки чуть в стороны */
export function dragPose(target, k, t, vx = 0) {
  if (k <= 0) return {};
  const sp = 7 + Math.min(6, Math.abs(vx) / 300), s = Math.sin(t * sp);
  target.leftUpperLeg = E(s * 0.35 * k - 0.1, 0, 0.06 + Math.max(0, s) * 0.22 * k);
  target.rightUpperLeg = E(-s * 0.35 * k - 0.1, 0, -0.06 - Math.max(0, -s) * 0.22 * k);
  target.leftLowerLeg = E(0.35 + Math.max(0, Math.sin(t * sp - 0.8)) * 0.4, 0, 0); target.rightLowerLeg = E(0.35 + Math.max(0, -Math.sin(t * sp - 0.8)) * 0.4, 0, 0);
  target.leftFoot = E(0.5, 0, 0); target.rightFoot = E(0.5, 0, 0);
  target.leftUpperArm = E(0, 0, -0.75 + Math.sin(t * 5) * 0.12); target.rightUpperArm = E(0, 0, 0.75 - Math.sin(t * 5 + 1) * 0.12);
  target.leftLowerArm = E(0, -0.5, 0); target.rightLowerArm = E(0, 0.5, 0);
  target.head.x = 0.12; target.spine.x = 0.05;
  return { hy: 0, surprised: 0.7, mouth: 0.35 };
}
/** Летит вниз: руки вверх, ноги поджаты */
export function fallPose(target) {
  target.leftUpperArm = E(0, 0, 0.9); target.rightUpperArm = E(0, 0, -0.9);
  target.leftLowerArm = E(0, 0, 0.3); target.rightLowerArm = E(0, 0, -0.3);
  target.leftUpperLeg = E(-0.35, 0, 0.08); target.rightUpperLeg = E(-0.15, 0, -0.08); target.leftLowerLeg = E(0.6, 0, 0); target.rightLowerLeg = E(0.4, 0, 0);
  return { surprised: 1, mouth: 0.6 };
}
/** Приземление: присел и выпрямился. u 0…1 — доля 0,5 с, power 0…1 — сила удара */
export function landPose(target, u, power) {
  const q = Math.sin(clamp(u) * Math.PI) * (0.4 + power * 0.6);
  target.leftUpperLeg = E(-0.7 * q, 0, 0.05); target.rightUpperLeg = E(-0.7 * q, 0, -0.05);
  target.leftLowerLeg = E(1.2 * q, 0, 0); target.rightLowerLeg = E(1.2 * q, 0, 0);
  target.spine.x = 0.25 * q; target.leftUpperArm.z += 0.5 * q; target.rightUpperArm.z -= 0.5 * q;
  return { hy: -0.16 * q };
}
/** После сильного падения кружится голова; s — секунды с приземления (2,6 с) */
export function dizzyPose(target, s) {
  const k = Math.max(0, 1 - s / 2.6);
  target.head.z = Math.sin(s * 7) * 0.2 * k; target.head.x = 0.1 + Math.cos(s * 7) * 0.08 * k; target.head.y *= 0.3;
  target.spine.z = Math.sin(s * 3.5) * 0.07 * k; target.hips.z = -Math.sin(s * 3.5) * 0.03 * k;
  target.leftUpperArm.z += 0.25 * k; target.rightUpperArm.z -= 0.25 * k;
  return { surprised: 0.5 * k, relaxed: 0.5 };
}
/** Раскачивание вокруг точки захвата (g — точка в координатах root): повернуть группу turn на угол a */
export function swingAbout(turn, a, gx, gy) {
  const c = Math.cos(a), s = Math.sin(a);
  turn.rotation.z = a;
  turn.position.x = gx - (c * gx - s * gy); turn.position.y = gy - (s * gx + c * gy);
}

/** Танец: ~114 ударов в минуту, четыре движения по 8 долей. talk — говорит (правая рука занята жестами) */
export const BEAT = 1.9;
export function dancePose(target, k, t, talk = false) {
  if (k <= 0.01) return {};
  const b = t * 2 * Math.PI * BEAT, move = Math.floor(t * BEAT / 8) % 4;
  const add = (o, x, y, z) => { o.x += x * k; o.y += y * k; o.z += z * k; };
  add(target.head, Math.sin(b) * 0.07, 0, Math.sin(b / 2) * 0.06);
  if (move === 0) { add(target.hips, 0, 0, Math.sin(b / 2) * 0.05); add(target.spine, 0, 0, -Math.sin(b / 2) * 0.06); }
  else if (move === 1) {                                     // кулачки перед собой, шаг в сторону
    add(target.hips, 0, 0, Math.sin(b / 2) * 0.09); add(target.spine, 0, 0, -Math.sin(b / 2) * 0.08);
    if (!talk) { add(target.rightUpperArm, -0.3, 0, -0.35 + Math.sin(b) * 0.15); add(target.rightLowerArm, 0, 1.3, 0); }
    add(target.leftUpperArm, -0.3, 0, 0.35 - Math.sin(b) * 0.15); add(target.leftLowerArm, 0, -1.3, 0);
  } else if (move === 2) {                                   // «диско»: рука вверх-вниз по доле
    if (!talk) { add(target.rightUpperArm, -0.2, 0, -1.6 * (Math.sin(b / 2) > 0 ? 1 : 0.2)); add(target.rightLowerArm, 0, 0.2, 0); }
    add(target.hips, 0, 0, Math.sin(b / 2) * 0.06);
  } else {                                                   // плечами
    add(target.leftShoulder, 0, 0, Math.sin(b * 2) * 0.12); add(target.rightShoulder, 0, 0, Math.sin(b * 2) * 0.12);
    add(target.spine, 0, Math.sin(b / 2) * 0.12, 0);
  }
  add(target.leftUpperLeg, 0, 0, Math.max(0, Math.sin(b / 2)) * 0.05); add(target.rightUpperLeg, 0, 0, -Math.max(0, -Math.sin(b / 2)) * 0.05);
  return { hy: -Math.abs(Math.sin(b / 2)) * 0.035 * k, happy: 0.55 * k };
}

/** Под погоду: от солнца — ладонь козырьком, от дождя — руки над головой, в снег — греет ладони; WR — wardrobe3d */
export function weatherPose(target, sky, k, t, WR) {
  if (k <= 0) return {};
  if (sky === 'sun' || sky === 'partly') {
    mix(target.rightUpperArm, 0, 0.9, -0.42, k); mix(target.rightLowerArm, 0, 1.4, -0.92, k); mix(target.rightHand, 0, 0, -0.3, k);   // ладонь у лба
    target.head.x -= 0.08 * k;
    return { happy: 0.6 * k };
  }
  if (sky === 'rain' || sky === 'storm') { WR.wearPose(target, 'head', 0.85 * k, t); target.head.x += 0.1 * k; return { surprised: 0.3 * k }; }
  if (sky === 'snow') {
    WR.wearPose(target, 'face', 0.8 * k, t); target.leftHand.z -= 0.2 * k; target.rightHand.z += 0.2 * k;
    target.spine.z += Math.sin(t * 45) * 0.015 * k; target.head.z += Math.sin(t * 40) * 0.02 * k; target.head.x += 0.06 * k;
    return {};
  }
  return {};
}

// ---------------------------------------------------------------- погода у головы (2D)
/** Код погоды WMO → что рисовать */
export function skyOf(code, day = true) {
  if (code === 0) return day ? 'sun' : 'moon';
  if (code <= 2) return day ? 'partly' : 'cloud';
  if (code === 3) return 'cloud';
  if (code <= 48) return 'fog';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'rain';
  if (code <= 77 || code === 85 || code === 86) return 'snow';
  return 'storm';
}
function cloudPath(c, x, y, s) {
  c.beginPath();
  c.arc(x - s * 0.55, y + s * 0.1, s * 0.42, 0, Math.PI * 2); c.arc(x - s * 0.1, y - s * 0.22, s * 0.55, 0, Math.PI * 2);
  c.arc(x + s * 0.45, y - s * 0.02, s * 0.45, 0, Math.PI * 2); c.arc(x + s * 0.05, y + s * 0.18, s * 0.45, 0, Math.PI * 2);
}
/**
 * Нарисовать погоду: c — 2D-контекст, sky — sun|moon|partly|cloud|fog|rain|snow|storm,
 * x, y — центр картинки, s — её размер (px), floor — где «земля» для капель, t — секунды показа, a — прозрачность, temp — °C или null
 */
export function drawWeather(c, { sky, x, y, s, floor, t, a = 1, temp = null }) {
  const bob = Math.sin(t * 1.6) * s * 0.06;
  c.save(); c.globalAlpha = a;
  const sun = (sx, sy, r) => {
    c.save(); c.translate(sx, sy); c.rotate(t * 0.6);
    c.strokeStyle = '#ffcc33'; c.lineWidth = Math.max(2, r * 0.12); c.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const an = i * Math.PI / 6, l = r * (1.35 + 0.12 * Math.sin(t * 4 + i)); c.beginPath(); c.moveTo(Math.cos(an) * r * 1.08, Math.sin(an) * r * 1.08); c.lineTo(Math.cos(an) * l, Math.sin(an) * l); c.stroke(); }
    const g = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r); g.addColorStop(0, '#fff6b0'); g.addColorStop(1, '#ffb703');
    c.fillStyle = g; c.shadowColor = '#ffb703'; c.shadowBlur = r * 0.8; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.restore();
  };
  const cloud = (cx, cy, dark) => {
    c.save(); c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = s * 0.2; c.shadowOffsetY = s * 0.06;
    const g = c.createLinearGradient(0, cy - s * 0.8, 0, cy + s * 0.6);
    g.addColorStop(0, dark ? '#8a93a3' : '#ffffff'); g.addColorStop(1, dark ? '#4b5363' : '#cfe0ea');
    c.fillStyle = g; cloudPath(c, cx, cy, s); c.fill(); c.restore();
  };
  if (sky === 'sun') sun(x, y + bob, s * 0.55);
  else if (sky === 'moon') {
    c.save(); c.translate(x, y + bob); c.fillStyle = '#ffe9a8'; c.shadowColor = '#ffe9a8'; c.shadowBlur = s * 0.5;
    c.beginPath(); c.arc(0, 0, s * 0.5, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(s * 0.22, -s * 0.12, s * 0.42, 0, Math.PI * 2); c.fill(); c.restore();
    c.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) { c.globalAlpha = a * (0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i * 1.7))); c.beginPath(); c.arc(x + Math.cos(i * 2.1) * s * 1.1, y + Math.sin(i * 2.7) * s * 0.7, Math.max(1.6, s * 0.04), 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = a;
  } else if (sky === 'partly') { sun(x + s * 0.45, y - s * 0.35 + bob * 0.5, s * 0.42); cloud(x - s * 0.1, y + s * 0.15 + bob, false); }
  else if (sky === 'fog') {
    c.strokeStyle = 'rgba(220,228,235,.85)'; c.lineCap = 'round'; c.lineWidth = s * 0.16;
    for (let i = 0; i < 4; i++) { c.beginPath(); const yy = y - s * 0.4 + i * s * 0.32, off = Math.sin(t * 1.2 + i) * s * 0.25; c.moveTo(x - s * 0.9 + off, yy); c.bezierCurveTo(x - s * 0.3 + off, yy - s * 0.12, x + s * 0.3 + off, yy + s * 0.12, x + s * 0.9 + off, yy); c.stroke(); }
  } else {                                                   // облако; дождь, снег и гроза — из него
    const dark = sky === 'rain' || sky === 'storm', top = y + s * 0.4, span = Math.max(10, floor - top);
    if (sky === 'storm') {                                   // молния раз в 2,2 с
      const n = Math.floor(t / 2.2), ph = t - n * 2.2;
      if (ph > 1.0 && ph < 1.18) {
        c.save(); c.strokeStyle = '#fff59d'; c.shadowColor = '#ffeb3b'; c.shadowBlur = 14; c.lineWidth = Math.max(3, s * 0.07); c.beginPath();
        let lx = x + (rnd(n) - 0.5) * s * 0.6, ly = top; c.moveTo(lx, ly);
        for (let i = 0; i < 5; i++) { lx += (i % 2 ? -1 : 1) * s * (0.15 + rnd(n * 7 + i) * 0.2); ly += span / 6; c.lineTo(lx, ly); }
        c.stroke(); c.restore();
      }
    }
    if (sky !== 'cloud') {
      const snow = sky === 'snow', N = snow ? 26 : 40;
      c.strokeStyle = 'rgba(140,200,255,.9)'; c.fillStyle = '#ffffff'; c.lineWidth = Math.max(1.6, s * 0.035);
      for (let i = 0; i < N; i++) {
        const v = snow ? 40 + rnd(i + 7) * 30 : 420 + rnd(i + 7) * 120, sc = s / 36;
        const yy = top + ((t * v * sc + rnd(i + 3) * span) % span), xx = x + (rnd(i) - 0.5) * s * 1.6;
        if (snow) { c.beginPath(); c.arc(xx + Math.sin(t * 2 + i) * 6 * sc, yy, 2.2 * sc, 0, Math.PI * 2); c.fill(); }
        else { c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx - 1.5 * sc, yy + 9 * sc); c.stroke(); }
      }
    }
    cloud(x, y + bob, dark);
  }
  if (temp != null) {                                        // температура — «ярлычок» под картинкой
    const txt = (temp > 0 ? '+' : '') + temp + '°', fs = Math.max(13, s * 0.42);
    c.font = `700 ${fs}px "Segoe UI Variable Display", "Segoe UI"`; c.textAlign = 'center';
    const tw = c.measureText(txt).width + fs * 0.8, ty = y + s * 0.95;
    c.fillStyle = 'rgba(10,20,24,.72)'; c.beginPath(); c.roundRect(x - tw / 2, ty - fs * 0.85, tw, fs * 1.25, fs * 0.6); c.fill();
    c.fillStyle = '#fff'; c.fillText(txt, x, ty + fs * 0.1);
  }
  c.restore();
}

/** Сердечко и нотка — для частиц */
export function drawHeart(c, x, y, s) { c.fillStyle = '#ff6b9a'; c.beginPath(); c.moveTo(x, y + s * 0.3); c.bezierCurveTo(x - s, y - s * 0.4, x - s * 0.4, y - s * 1.1, x, y - s * 0.45); c.bezierCurveTo(x + s * 0.4, y - s * 1.1, x + s, y - s * 0.4, x, y + s * 0.3); c.fill(); }

// ---------------------------------------------------------------- монетка и кубик
function faceTex(draw, size = 128) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; draw(cv.getContext('2d'), size);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return tx;
}
function coinFace(label, big, turn) {
  return faceTex((x, n) => {
    x.translate(n / 2, n / 2); x.rotate(turn); x.translate(-n / 2, -n / 2);   // крышки цилиндра повёрнуты — компенсируем
    const g = x.createRadialGradient(n * 0.35, n * 0.3, n * 0.05, n / 2, n / 2, n / 2); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.6, '#f2c230'); g.addColorStop(1, '#b8860b');
    x.fillStyle = g; x.fillRect(0, 0, n, n);
    x.strokeStyle = '#9c6f06'; x.lineWidth = n * 0.04; x.beginPath(); x.arc(n / 2, n / 2, n * 0.42, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#8a5d00'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `800 ${n * 0.46}px "Segoe UI Variable Display", "Segoe UI"`; x.fillText(big, n / 2, n * 0.47);
    x.font = `700 ${n * 0.12}px "Segoe UI"`; x.fillText(label, n / 2, n * 0.8);
  });
}
function diceFace(v) {
  return faceTex((x, n) => {
    x.fillStyle = '#fbfbf8'; x.fillRect(0, 0, n, n);
    x.strokeStyle = '#d9d9d2'; x.lineWidth = n * 0.06; x.strokeRect(0, 0, n, n);
    const P = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.25, .25], [.5, .5], [.75, .75]], 4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]], 5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]], 6: [[.27, .22], [.73, .22], [.27, .5], [.73, .5], [.27, .78], [.73, .78]] }[v];
    x.fillStyle = v === 1 ? '#e53935' : '#1d2b36';
    for (const [px, py] of P) { x.beginPath(); x.arc(px * n, py * n, n * (v === 1 ? 0.13 : 0.085), 0, Math.PI * 2); x.fill(); }
  });
}
/** Золотая монетка: орёл — «Ф», решка — «1» */
export function makeCoin(r = 0.075) {
  const edge = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.8, roughness: 0.3 });
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.012, 40), [edge,
    new THREE.MeshStandardMaterial({ map: coinFace('ОРЁЛ', 'Ф', -Math.PI / 2), metalness: 0.5, roughness: 0.35 }),
    new THREE.MeshStandardMaterial({ map: coinFace('РЕШКА', '1', Math.PI / 2), metalness: 0.5, roughness: 0.35 })]);
}
/** Игральный кубик: стороны BoxGeometry +x, −x, +y, −y, +z, −z = 2, 5, 3, 4, 1, 6 */
export function makeDice(s = 0.12) {
  return new THREE.Mesh(new THREE.BoxGeometry(s, s, s), [2, 5, 3, 4, 1, 6].map(v => new THREE.MeshStandardMaterial({ map: diceFace(v), roughness: 0.45 })));
}
const DICE_E = { 1: [0, 0, 0], 6: [0, Math.PI, 0], 2: [0, -Math.PI / 2, 0], 5: [0, Math.PI / 2, 0], 3: [Math.PI / 2, 0, 0], 4: [-Math.PI / 2, 0, 0] };
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
export const COIN_T = { up: 0.3, fly: 1.0, show: 3.2, end: 3.6 }, DICE_T = { throw: 0.3, settle: 1.3, end: 5.0 };

/**
 * Монетка в момент t: взмах (0…0.3) → вверх-вниз, вращаясь (до 1.3) → поймал и показывает (до 3.2) → исчезает (3.6).
 * p0 — точка у руки (мир), dir — к центру экрана (±1), heads — орёл. Возвращает { caught, done, scale }
 */
export function coinStep(o, p0, dir, heads, t) {
  const { up, fly } = COIN_T, g = 8 * 0.6 / (fly * fly), v = g * fly / 2;     // вершина — 0,6 м над рукой
  o.rotation.order = 'XYZ'; o.scale.setScalar(1);
  if (t < up) { o.position.copy(p0); o.rotation.set(Math.PI / 2, 0, 0); return { caught: false }; }
  if (t < up + fly) {
    const u = t - up; o.position.copy(p0); o.position.y += v * u - g * u * u / 2;
    const final = 6 * Math.PI * 2 + (heads ? 0 : Math.PI), e = 1 - Math.pow(1 - u / fly, 2);
    o.rotation.set(Math.PI / 2 + final * e, 0, 0);
    return { caught: false };
  }
  const u = clamp((t - up - fly) / 0.35);                    // к груди и крупнее — показать
  o.position.lerpVectors(p0, _v.copy(p0).add(new THREE.Vector3(-dir * 0.1, 0.12, 0.1)), u);
  o.rotation.set(Math.PI / 2 + (heads ? 0 : Math.PI) - 0.25 * u, 0.2 * u * dir, 0);
  o.scale.setScalar(Math.max(0.001, 1 + u * 0.9 - Math.max(0, (t - COIN_T.show) / 0.4) * 1.9));
  return { caught: true, done: t >= COIN_T.end };
}
/**
 * Кубик в момент t: из руки (p0) на пол (land) по дуге, два отскока, кувыркается всё медленнее и встаёт стороной n к зрителю.
 * axis — случайная ось кувырков. Возвращает { hits: число касаний пола, shown, done }
 */
export function diceStep(o, p0, land, dir, n, axis, t) {
  const segs = [[0.3, 0.55, 0.32], [0.85, 0.28, 0.08], [1.13, 0.16, 0.03]];  // начало, длительность, высота дуги
  let hits = 0;
  o.position.copy(p0);
  if (t >= 0.3) {
    let si = 0; for (let i = 0; i < segs.length; i++) if (t >= segs[i][0]) si = i;
    const s = segs[si], u = clamp((t - s[0]) / s[1]);
    hits = si + (u >= 1 ? 1 : 0);
    if (si === 0) { o.position.lerpVectors(p0, land, u); o.position.y = p0.y + (land.y - p0.y) * u + Math.sin(u * Math.PI) * s[2] * (1 - u * 0.3); }
    else { o.position.copy(land); o.position.x += dir * (si === 1 ? 0.05 * u : 0.05 + 0.02 * u); o.position.y += Math.sin(u * Math.PI) * s[2]; }
  }
  const e = t < 0.3 ? 0 : clamp((t - 0.3) / 1.0);
  _q2.setFromEuler(_e.set(...DICE_E[n])).premultiply(_q1.setFromEuler(_e.set(-0.32, 0.38 * dir, 0)));
  o.quaternion.copy(_q2).multiply(_q1.setFromAxisAngle(axis, (1 - e) * (1 - e) * Math.PI * 5));
  o.scale.setScalar(t > 4.6 ? Math.max(0.001, 1 - (t - 4.6) / 0.4) : 1);
  return { hits, shown: t > DICE_T.settle, done: t >= DICE_T.end };
}
/** Поза броска: рука ближе к центру экрана вперёд-вверх (k 0…1) */
export function tossPose(target, dir, k) {
  if (k <= 0) return;
  if (dir < 0) { mix(target.rightUpperArm, -0.85, 0, 0.45, k); target.rightLowerArm.y += (0.9 - target.rightLowerArm.y) * k; }
  else { mix(target.leftUpperArm, -0.85, 0, -0.45, k); target.leftLowerArm.y += (-0.9 - target.leftLowerArm.y) * k; }
}
