// Гардероб Феликса в 3D: аксессуары (строятся из простых фигур), ширма для переодевания, наряды (перекраска текстур модели)
// и анимации: надеть / снять аксессуар руками, переодеться за ширмой. Всё — функции от прогресса k (0…1),
// поэтому одно и то же используют и окно Феликса (в реальном времени), и рекламный ролик (покадрово).
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = k => (k = clamp(k), k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const outBack = k => { k = clamp(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const seg = (k, a, b) => clamp((k - a) / (b - a));
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o });
const C = { teal: 0x2ed3c0, tealD: 0x14857a, navy: 0x1d2633, white: 0xf2f6f7, gold: 0xf5c542, red: 0xe5383b, pink: 0xff8fb3, purple: 0x5b3fa8, black: 0x15181c, brown: 0x8a5a33 };

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function clover(x, cx, cy, r, fill) {
  x.fillStyle = fill;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; x.beginPath(); x.arc(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.58, 0, TAU); x.fill(); }
}
function star(x, cx, cy, r, n = 5, inner = 0.45) {
  x.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r * inner : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  x.closePath(); x.fill();
}
function starShape(r, n = 5, inner = 0.45) {
  const s = new THREE.Shape();
  for (let i = 0; i < n * 2; i++) { const a = Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? r * inner : r; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  s.closePath(); return s;
}
function roundRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
const add = (g, geo, m, p = [0, 0, 0], r = [0, 0, 0], s = null) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.rotation.set(...r); if (s) o.scale.set(...s); g.add(o); return o; };

// ---------------------------------------------------------------- аксессуары. at — посадка относительно «сырой» кости (метры), rot — поворот
const KNIT = () => canvasTex(128, 128, (x, w, h) => { x.fillStyle = '#20564f'; x.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 8) { x.fillStyle = i % 16 ? '#1b4a44' : '#2a6b62'; x.fillRect(i, 0, 4, h); } }, [6, 1]);
const STRIPES = (a, b, n = 8, vertical = true) => canvasTex(128, 128, (x, w, h) => { for (let i = 0; i < n; i++) { x.fillStyle = i % 2 ? b : a; vertical ? x.fillRect(i * w / n, 0, w / n + 1, h) : x.fillRect(0, i * h / n, w, h / n + 1); } });

export const ACC = {
  headphones: { bone: 'head', at: [0, 0.066, -0.012], make() {
    const g = new THREE.Group();
    const navy = mat(C.navy, { roughness: 0.45, metalness: 0.25 }), teal = mat(C.teal, { roughness: 0.35, emissive: 0x0b5e55, emissiveIntensity: 0.45 }), soft = mat(0x111820, { roughness: 0.95 });
    add(g, new THREE.TorusGeometry(0.112, 0.0085, 10, 48, Math.PI), navy, [0, 0, 0], [0, 0, 0], [1, 1.08, 1]);
    for (const s of [-1, 1]) {
      const cup = new THREE.Group();
      add(cup, new THREE.CylinderGeometry(0.038, 0.038, 0.026, 32), navy);
      add(cup, new THREE.TorusGeometry(0.033, 0.005, 8, 32), teal, [0, 0.0135, 0], [Math.PI / 2, 0, 0]);
      add(cup, new THREE.CircleGeometry(0.02, 24), teal, [0, 0.0136, 0], [-Math.PI / 2, 0, 0]);
      add(cup, new THREE.CylinderGeometry(0.032, 0.034, 0.014, 28), soft, [0, -0.019, 0]);
      cup.position.set(s * 0.108, -0.004, 0); cup.rotation.set(0, 0, -s * Math.PI / 2); g.add(cup);
    }
    return g;
  } },
  beanie: { bone: 'head', at: [0, 0.095, -0.012], make() {
    const g = new THREE.Group();
    add(g, new THREE.SphereGeometry(0.128, 36, 18, 0, TAU, 0, Math.PI / 2), mat(0xffffff, { map: KNIT(), roughness: 0.95 }), [0, 0, 0], [0, 0, 0], [1, 1.02, 1.08]);
    add(g, new THREE.CylinderGeometry(0.131, 0.134, 0.05, 36, 1, true), mat(C.teal, { roughness: 0.9, side: THREE.DoubleSide }), [0, 0.012, 0], [0, 0, 0], [1, 1, 1.08]);
    add(g, new THREE.IcosahedronGeometry(0.042, 2), mat(C.white, { roughness: 1 }), [0, 0.135, 0]);
    return g;
  } },
  cap: { bone: 'head', at: [0, 0.112, -0.01], rot: [-0.1, 0, 0], make() {
    const g = new THREE.Group(), teal = mat(C.teal, { roughness: 0.7 }), navy = mat(C.navy, { roughness: 0.7 });
    add(g, new THREE.SphereGeometry(0.136, 40, 18, 0, TAU, 0, Math.PI / 2), teal, [0, 0, 0], [0, 0, 0], [1, 0.92, 1.1]);
    add(g, new THREE.CylinderGeometry(0.152, 0.152, 0.008, 36, 1, false, -Math.PI / 2, Math.PI), navy, [0, 0.006, 0.02], [0.14, 0, 0], [0.92, 1, 1.08]);   // козырёк вперёд
    add(g, new THREE.SphereGeometry(0.013, 12, 8), navy, [0, 0.125, 0]);
    const logo = canvasTex(64, 64, (x) => { clover(x, 32, 32, 18, '#ffffff'); });
    add(g, new THREE.CircleGeometry(0.03, 24), new THREE.MeshBasicMaterial({ map: logo, transparent: true }), [0, 0.07, 0.128], [-0.5, 0, 0]);
    return g;
  } },
  crown: { bone: 'head', at: [0.0, 0.168, -0.012], rot: [0, 0, 0.12], make() {
    const g = new THREE.Group(), gold = mat(C.gold, { metalness: 0.85, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.3 });
    add(g, new THREE.CylinderGeometry(0.098, 0.09, 0.05, 32, 1, true), mat(C.gold, { metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide, emissive: 0x6a4a00, emissiveIntensity: 0.3 }));
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      add(g, new THREE.ConeGeometry(0.018, 0.05, 4), gold, [Math.sin(a) * 0.094, 0.048, Math.cos(a) * 0.094]);
      add(g, new THREE.SphereGeometry(0.008, 10, 8), gold, [Math.sin(a) * 0.094, 0.076, Math.cos(a) * 0.094]);
    }
    const gems = [C.red, C.teal, C.purple, C.teal];
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; add(g, new THREE.OctahedronGeometry(0.011), mat(gems[i], { metalness: 0.2, roughness: 0.1, emissive: gems[i], emissiveIntensity: 0.25 }), [Math.sin(a) * 0.1, 0.002, Math.cos(a) * 0.1]); }
    return g;
  } },
  wizard: { bone: 'head', at: [0, 0.15, -0.012], rot: [-0.05, 0, 0.06], make() {
    const g = new THREE.Group();
    const starsTex = canvasTex(256, 128, (x, w, h) => { x.fillStyle = '#4a2f9a'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffd84a'; for (let i = 0; i < 16; i++) star(x, (i * 47) % w, 12 + (i * 29) % (h - 20), 7); x.fillStyle = '#ffffff'; for (let i = 0; i < 30; i++) x.fillRect((i * 83) % w, (i * 37) % h, 2, 2); });
    add(g, new THREE.CylinderGeometry(0.21, 0.21, 0.01, 48), mat(0x3b2685, { roughness: 0.8 }));
    const cone = new THREE.ConeGeometry(0.11, 0.34, 40, 8, true);
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = Math.max(0, p.getY(i) + 0.17); p.setX(i, p.getX(i) - Math.pow(y / 0.34, 2.2) * 0.07); }   // кончик загибается назад (max: −0.0…01 в степени дало бы NaN)
    cone.computeVertexNormals();
    add(g, cone, mat(0xffffff, { map: starsTex, roughness: 0.8, side: THREE.DoubleSide }), [0, 0.175, 0], [0, Math.PI / 2, 0]);
    add(g, new THREE.CylinderGeometry(0.108, 0.11, 0.028, 40, 1, true), mat(C.gold, { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }), [0, 0.02, 0]);
    return g;
  } },
  party: { bone: 'head', at: [0.035, 0.185, 0.0], rot: [0, 0, -0.28], make() {
    const g = new THREE.Group();
    const tex = canvasTex(128, 128, (x, w, h) => { const cs = ['#2ed3c0', '#ffffff', '#ff8fb3', '#ffd84a']; for (let i = 0; i < 8; i++) { x.fillStyle = cs[i % 4]; x.save(); x.translate(0, i * 16); x.transform(1, 0, -0.6, 1, 0, 0); x.fillRect(0, 0, w * 2, 16); x.restore(); } x.fillStyle = '#ffffff'; for (let i = 0; i < 14; i++) { x.beginPath(); x.arc((i * 37) % w, (i * 53) % h, 3, 0, TAU); x.fill(); } });
    add(g, new THREE.ConeGeometry(0.07, 0.19, 36, 1, true), mat(0xffffff, { map: tex, roughness: 0.6, side: THREE.DoubleSide }), [0, 0.095, 0]);
    add(g, new THREE.IcosahedronGeometry(0.024, 2), mat(C.pink, { roughness: 1 }), [0, 0.195, 0]);
    add(g, new THREE.TorusGeometry(0.068, 0.009, 8, 32), mat(C.gold, { roughness: 0.9 }), [0, 0.004, 0], [Math.PI / 2, 0, 0]);
    return g;
  } },
  santa: { bone: 'head', at: [0, 0.14, -0.01], rot: [-0.06, 0, 0.05], make() {
    const g = new THREE.Group();
    const cone = new THREE.ConeGeometry(0.122, 0.28, 40, 12, true);
    const p = cone.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = Math.max(0, p.getY(i) + 0.14), k = y / 0.28; p.setX(i, p.getX(i) + Math.pow(k, 2.4) * 0.17); p.setY(i, p.getY(i) - Math.pow(k, 3) * 0.08); }   // кончик свисает набок
    cone.computeVertexNormals();
    add(g, cone, mat(0xd8262c, { roughness: 0.85, side: THREE.DoubleSide }), [0, 0.15, 0]);
    add(g, new THREE.TorusGeometry(0.124, 0.03, 12, 40), mat(C.white, { roughness: 1 }), [0, 0.018, 0], [Math.PI / 2, 0, 0]);
    add(g, new THREE.IcosahedronGeometry(0.035, 2), mat(C.white, { roughness: 1 }), [0.17, 0.215, 0]);
    return g;
  } },
  cowboy: { bone: 'head', at: [0, 0.15, -0.012], rot: [-0.08, 0, 0], make() {
    const g = new THREE.Group(), leather = mat(0x9a6638, { roughness: 0.75 });
    const pts = []; for (let i = 0; i <= 12; i++) { const r = 0.1 + i / 12 * 0.13; pts.push(new THREE.Vector2(r, Math.pow(i / 12, 2.4) * 0.05)); }
    const brim = add(g, new THREE.LatheGeometry(pts, 48), mat(0x9a6638, { roughness: 0.75, side: THREE.DoubleSide }), [0, 0, 0], [0, 0, 0], [1, 1, 1.12]);
    brim.geometry.computeVertexNormals();
    add(g, new THREE.CylinderGeometry(0.085, 0.108, 0.13, 36), leather, [0, 0.065, 0], [0, 0, 0], [1, 1, 1.12]);
    add(g, new THREE.SphereGeometry(0.086, 24, 8, 0, TAU, 0, Math.PI / 2), leather, [0, 0.128, 0], [0, 0, 0], [1, 0.35, 1.12]);
    add(g, new THREE.CylinderGeometry(0.106, 0.11, 0.022, 36, 1, true), mat(C.navy, { side: THREE.DoubleSide }), [0, 0.018, 0], [0, 0, 0], [1, 1, 1.12]);
    add(g, new THREE.BoxGeometry(0.03, 0.022, 0.006), mat(C.gold, { metalness: 0.8, roughness: 0.3 }), [0, 0.018, 0.121]);
    return g;
  } },
  tophat: { bone: 'head', at: [0, 0.155, -0.012], rot: [-0.04, 0, -0.08], make() {
    const g = new THREE.Group(), black = mat(C.black, { roughness: 0.35, metalness: 0.2 });
    add(g, new THREE.CylinderGeometry(0.15, 0.15, 0.012, 48), black, [0, 0, 0], [0, 0, 0], [1, 1, 1.1]);
    add(g, new THREE.CylinderGeometry(0.088, 0.094, 0.2, 40), black, [0, 0.1, 0]);
    add(g, new THREE.CylinderGeometry(0.095, 0.095, 0.034, 40, 1, true), mat(C.teal, { roughness: 0.5, side: THREE.DoubleSide }), [0, 0.03, 0]);
    return g;
  } },
  catears: { bone: 'head', at: [0, 0.075, 0.025], make() {
    const g = new THREE.Group(), navy = mat(0x2a3446, { roughness: 0.8 }), pink = mat(C.pink, { roughness: 0.9 });
    add(g, new THREE.TorusGeometry(0.122, 0.008, 8, 48, Math.PI), navy, [0, 0, 0], [0, 0, 0], [1, 1.06, 1]);
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      add(ear, new THREE.ConeGeometry(0.066, 0.12, 4), navy, [0, 0, 0], [0, Math.PI / 4, 0], [1, 1, 0.42]);
      add(ear, new THREE.ConeGeometry(0.042, 0.08, 4), pink, [0, -0.008, 0.013], [0, Math.PI / 4, 0], [1, 1, 0.28]);
      ear.position.set(s * 0.082, 0.13, 0); ear.rotation.set(0, 0, -s * 0.48); g.add(ear);
    }
    return g;
  } },
  halo: { bone: 'head', at: [0, 0.29, -0.01], make() {
    const g = new THREE.Group();
    add(g, new THREE.TorusGeometry(0.085, 0.011, 12, 56), new THREE.MeshStandardMaterial({ color: 0xfff1a6, emissive: 0xffd84a, emissiveIntensity: 1.2, roughness: 0.3 }), [0, 0, 0], [Math.PI / 2 - 0.15, 0, 0]);
    g.userData.update = t => { g.children[0].position.y = Math.sin(t * 2.2) * 0.008; };
    return g;
  } },
  horns: { bone: 'head', at: [0, 0.155, 0.02], make() {
    const g = new THREE.Group(), red = mat(0xc4262e, { roughness: 0.45, emissive: 0x400000, emissiveIntensity: 0.3 });
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.02, 0.035, 0), new THREE.Vector3(s * 0.045, 0.06, -0.01), new THREE.Vector3(s * 0.06, 0.07, -0.025)]);
      const tube = new THREE.TubeGeometry(curve, 16, 0.016, 10);
      const p = tube.attributes.position, n = 11;   // сужается к кончику
      for (let i = 0; i < p.count; i++) { const k = Math.floor(i / n) / 16, c = curve.getPoint(k); const sh = 1 - k * 0.85; p.setXYZ(i, c.x + (p.getX(i) - c.x) * sh, c.y + (p.getY(i) - c.y) * sh, c.z + (p.getZ(i) - c.z) * sh); }
      tube.computeVertexNormals();
      add(g, tube, red, [s * 0.055, 0, 0]);
    }
    return g;
  } },
  wreath: { bone: 'head', at: [0, 0.15, -0.012], rot: [-0.12, 0, 0], make() {
    const g = new THREE.Group();
    add(g, new THREE.TorusGeometry(0.118, 0.012, 8, 48), mat(0x3f8a4a, { roughness: 0.9 }), [0, 0, 0], [Math.PI / 2, 0, 0]);
    const cols = [0xff8fb3, 0xffffff, 0xffd84a, 0xff8fb3, 0xb69cff, 0xffffff];
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU, f = new THREE.Group();
      for (let j = 0; j < 5; j++) { const b = j / 5 * TAU; add(f, new THREE.SphereGeometry(0.011, 8, 6), mat(cols[i % cols.length], { roughness: 0.8 }), [Math.cos(b) * 0.012, 0, Math.sin(b) * 0.012]); }
      add(f, new THREE.SphereGeometry(0.008, 8, 6), mat(C.gold), [0, 0.004, 0]);
      f.position.set(Math.sin(a) * 0.118, 0.008, Math.cos(a) * 0.118); g.add(f);
    }
    return g;
  } },
  glasses: { bone: 'head', at: [0, 0.058, 0.094], make() {
    const g = new THREE.Group(), frame = mat(0x2a1f18, { roughness: 0.4, metalness: 0.3 });
    for (const s of [-1, 1]) {
      add(g, new THREE.TorusGeometry(0.03, 0.0035, 8, 32), frame, [s * 0.04, 0, 0]);
      add(g, new THREE.CircleGeometry(0.029, 28), new THREE.MeshStandardMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.3 }), [s * 0.04, 0, -0.001]);
      add(g, new THREE.BoxGeometry(0.004, 0.004, 0.1), frame, [s * 0.07, 0.004, -0.05]);
    }
    add(g, new THREE.TorusGeometry(0.012, 0.003, 6, 16, Math.PI), frame, [0, 0.002, 0]);
    return g;
  } },
  sunglasses: { bone: 'head', at: [0, 0.058, 0.096], make() {
    const g = new THREE.Group(), frame = mat(C.black, { roughness: 0.3, metalness: 0.5 });
    const lens = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.93 });
    for (const s of [-1, 1]) {
      add(g, new THREE.ShapeGeometry(roundRect(0.058, 0.04, 0.014)), lens, [s * 0.04, -0.004, 0]);
      add(g, new THREE.BoxGeometry(0.004, 0.004, 0.1), frame, [s * 0.071, 0.012, -0.05]);
    }
    add(g, new THREE.BoxGeometry(0.15, 0.006, 0.006), frame, [0, 0.016, 0]);
    add(g, new THREE.PlaneGeometry(0.02, 0.008), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }), [-0.05, 0.006, 0.001], [0, 0, 0.5]);
    return g;
  } },
  starglasses: { bone: 'head', at: [0, 0.058, 0.096], make() {
    const g = new THREE.Group(), pink = mat(0xff5fa2, { roughness: 0.3, emissive: 0x7a1040, emissiveIntensity: 0.4 });
    for (const s of [-1, 1]) {
      add(g, new THREE.ExtrudeGeometry(starShape(0.036), { depth: 0.006, bevelEnabled: false }), pink, [s * 0.042, 0, -0.003]);
      add(g, new THREE.ShapeGeometry(starShape(0.026)), new THREE.MeshStandardMaterial({ color: 0xffe066, transparent: true, opacity: 0.55, emissive: 0x806000, emissiveIntensity: 0.3 }), [s * 0.042, 0, 0.0035]);
      add(g, new THREE.BoxGeometry(0.004, 0.004, 0.1), pink, [s * 0.074, 0.006, -0.05]);
    }
    add(g, new THREE.BoxGeometry(0.02, 0.005, 0.005), pink, [0, 0.004, 0]);
    return g;
  } },
  scarf: { bone: 'neck', at: [0, 0.01, 0.022], make() {
    const g = new THREE.Group(), m = mat(0xffffff, { map: STRIPES('#e5383b', '#f2f6f7', 12), roughness: 0.95 });
    add(g, new THREE.TorusGeometry(0.098, 0.034, 14, 40), m, [0, 0, 0], [Math.PI / 2 + 0.18, 0, 0], [1, 1.08, 1]);
    const tail = mat(0xffffff, { map: STRIPES('#e5383b', '#f2f6f7', 6, false), roughness: 0.95, side: THREE.DoubleSide });
    add(g, new THREE.BoxGeometry(0.07, 0.24, 0.02), tail, [0.045, -0.13, 0.105], [0.2, 0, 0.1]);
    add(g, new THREE.BoxGeometry(0.066, 0.17, 0.02), tail, [-0.012, -0.1, 0.118], [0.26, 0, -0.16]);
    return g;
  } },
  bowtie: { bone: 'upperChest', at: [0, 0.155, 0.112], rot: [-0.25, 0, 0], make() {
    const g = new THREE.Group(), red = mat(0xd8262c, { roughness: 0.55 });
    for (const s of [-1, 1]) add(g, new THREE.ConeGeometry(0.036, 0.06, 4), red, [s * 0.03, 0, 0], [0, 0, s * Math.PI / 2], [1, 1, 0.5]);
    add(g, new THREE.BoxGeometry(0.022, 0.024, 0.02), mat(0x9e1a1f, { roughness: 0.6 }));
    return g;
  } },
  medal: { bone: 'upperChest', at: [0, 0.02, 0.135], rot: [-0.18, 0, 0], make() {
    const g = new THREE.Group();
    const ribbon = mat(0xffffff, { map: STRIPES('#1FB5A3', '#26303f', 4), roughness: 0.8, side: THREE.DoubleSide });
    for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.03, 0.13, 0.004), ribbon, [s * 0.03, 0.075, -0.012], [0.12, 0, s * 0.42]);
    const face = canvasTex(128, 128, (x) => { x.fillStyle = '#f5c542'; x.beginPath(); x.arc(64, 64, 62, 0, TAU); x.fill(); x.strokeStyle = '#b8860b'; x.lineWidth = 6; x.stroke(); clover(x, 64, 64, 30, '#c9971f'); });
    add(g, new THREE.CylinderGeometry(0.038, 0.038, 0.008, 32), [mat(C.gold, { metalness: 0.85, roughness: 0.25 }), mat(0xffffff, { map: face, metalness: 0.6, roughness: 0.3 }), mat(C.gold, { metalness: 0.85, roughness: 0.25 })], [0, 0, 0], [Math.PI / 2, 0, 0]);
    return g;
  } },
  wings: { bone: 'upperChest', at: [0, 0.04, -0.12], make() {
    const g = new THREE.Group(), m = mat(0xffffff, { roughness: 0.6, emissive: 0x9ff5e8, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.bezierCurveTo(0.12, 0.22, 0.34, 0.26, 0.46, 0.2); sh.bezierCurveTo(0.38, 0.12, 0.42, 0.06, 0.36, 0.02); sh.bezierCurveTo(0.3, -0.02, 0.3, -0.08, 0.22, -0.1); sh.bezierCurveTo(0.16, -0.12, 0.12, -0.2, 0.06, -0.16); sh.lineTo(0, 0);
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
    const L = new THREE.Group(), R = new THREE.Group();
    add(R, geo, m, [0.02, 0, 0]); add(L, geo, m, [-0.02, 0, 0], [0, Math.PI, 0]);
    g.add(L, R);
    g.userData.update = t => { const f = 0.45 + Math.sin(t * 2.4) * 0.12; R.rotation.y = f; L.rotation.y = -f; };
    return g;
  } },
  backpack: { bone: 'upperChest', at: [0, -0.04, -0.17], make() {
    const g = new THREE.Group(), teal = mat(C.teal, { roughness: 0.75 }), navy = mat(C.navy, { roughness: 0.75 });
    add(g, new THREE.CapsuleGeometry(0.11, 0.14, 6, 16), teal, [0, 0, 0], [0, 0, 0], [1.15, 1, 0.55]);
    add(g, new THREE.CapsuleGeometry(0.07, 0.05, 4, 12), navy, [0, -0.07, -0.05], [0, 0, 0], [1.2, 1, 0.4]);
    const logo = canvasTex(64, 64, (x) => clover(x, 32, 32, 20, '#ffffff'));
    add(g, new THREE.CircleGeometry(0.03, 24), new THREE.MeshBasicMaterial({ map: logo, transparent: true }), [0, 0.06, -0.063], [0, Math.PI, 0]);
    for (const s of [-1, 1]) add(g, new THREE.TorusGeometry(0.07, 0.012, 6, 16, Math.PI * 0.8), navy, [s * 0.075, 0.11, 0.06], [0, Math.PI / 2, Math.PI * 0.1]);
    return g;
  } },
  // в руке: всегда «стоят» вертикально в мире, рука — под ними
  umbrella: { bone: 'leftHand', at: [0, 0, 0], worldUp: true, make() {
    const g = new THREE.Group();
    const tex = canvasTex(256, 32, (x, w, h) => { for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f2f6f7' : '#1FB5A3'; x.fillRect(i * w / 8, 0, w / 8 + 1, h); } });
    add(g, new THREE.ConeGeometry(0.44, 0.17, 8, 1, true), mat(0xffffff, { map: tex, roughness: 0.6, side: THREE.DoubleSide }), [0, 0.66, 0]);
    add(g, new THREE.CylinderGeometry(0.007, 0.007, 0.78, 8), mat(C.navy, { metalness: 0.5, roughness: 0.4 }), [0, 0.37, 0]);
    add(g, new THREE.SphereGeometry(0.014, 10, 8), mat(C.navy), [0, 0.76, 0]);
    add(g, new THREE.TorusGeometry(0.03, 0.008, 8, 16, Math.PI), mat(0x8a5a33, { roughness: 0.5 }), [0.03, -0.02, 0], [0, 0, Math.PI]);
    return g;
  } },
  balloon: { bone: 'leftHand', at: [0, 0, 0], worldUp: true, make() {
    const g = new THREE.Group();
    const b = add(g, new THREE.SphereGeometry(0.12, 32, 20), mat(0xff4d6d, { roughness: 0.15, metalness: 0.1, emissive: 0x400010, emissiveIntensity: 0.25 }), [0.05, 0.72, 0], [0, 0, 0], [1, 1.18, 1]);
    add(b, new THREE.ConeGeometry(0.018, 0.03, 10), mat(0xc2304d), [0, -0.112, 0], [Math.PI, 0, 0], [1, 0.85, 1]);
    add(b, new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }), [-0.05, 0.05, 0.085], [0, 0, 0], [0.6, 1, 0.3]);
    const str = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, 0.3, 0), new THREE.Vector3(0.05, 0.6, 0)]);
    const line = new THREE.Line(str, new THREE.LineBasicMaterial({ color: 0xeeeeee })); g.add(line);
    g.userData.update = t => { b.position.x = 0.05 + Math.sin(t * 1.3) * 0.025; b.rotation.z = Math.sin(t * 1.3) * 0.08; };
    return g;
  } }
};
export const ACC_IDS = Object.keys(ACC);
const SLOT_OF = {};
export function setCatalog(cat) { for (const a of cat.accessories || []) SLOT_OF[a.id] = a.slot; }
export const slotOf = id => SLOT_OF[id] || (ACC[id] ? ({ umbrella: 'hand', balloon: 'hand', headphones: 'ears', glasses: 'face', sunglasses: 'face', starglasses: 'face', scarf: 'neck', bowtie: 'neck', medal: 'neck', wings: 'back', backpack: 'back' }[id] || 'head') : null);

export function makeAccessory(id) {
  const a = ACC[id]; if (!a) return null;
  const g = a.make();
  g.userData.accId = id;
  g.traverse(o => { o.frustumCulled = false; });
  return g;
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const boneOf = (vrm, name) => vrm.humanoid.getRawBoneNode(name) || vrm.humanoid.getRawBoneNode(name === 'upperChest' ? 'chest' : 'head');

/** Надеть мгновенно: прикрепить к кости */
export function attachAccessory(vrm, mesh) {
  const a = ACC[mesh.userData.accId], bone = boneOf(vrm, a.bone);
  bone.add(mesh);
  mesh.position.set(...a.at); mesh.rotation.set(...(a.rot || [0, 0, 0])); mesh.scale.setScalar(1);
  mesh.userData.on = true;
  return mesh;
}
/** Куда встанет вещь (мировые координаты) */
export function targetWorld(vrm, id, pos, quat) {
  const a = ACC[id], bone = boneOf(vrm, a.bone);
  bone.updateWorldMatrix(true, false);
  pos.set(...a.at).applyMatrix4(bone.matrixWorld);
  bone.matrixWorld.decompose(_v, quat, _s);
  quat.multiply(_q.setFromEuler(_e.set(...(a.rot || [0, 0, 0]))));
}
/** Точка между ладонями (откуда берётся и куда уходит вещь) */
export function handsMid(vrm, out) {
  const l = vrm.humanoid.getRawBoneNode('leftHand'), r = vrm.humanoid.getRawBoneNode('rightHand');
  l.getWorldPosition(out); r.getWorldPosition(_v); return out.add(_v).multiplyScalar(0.5);
}
/** Каждый кадр: анимация вещей (нимб, плащ, крылья, шарик) и «вертикаль» для вещей в руке */
export function updateAccessories(vrm, t) {
  vrm.scene.traverse(o => {
    if (!o.userData.accId) return;
    if (o.userData.update) o.userData.update(t);
    if (ACC[o.userData.accId].worldUp && o.userData.on && o.parent) { o.parent.getWorldQuaternion(_q); o.quaternion.copy(_q.invert()); }
  });
}

// ---------------------------------------------------------------- позы рук: надеть на голову, на лицо, на шею, на спину
/** raise 0…1 — насколько руки у места вещи */
export function wearPose(target, slot, raise, t = 0) {
  const k = ease(raise);
  if (k <= 0.001) return;
  const L = target.leftUpperArm, R = target.rightUpperArm;
  const set = (o, x, y, z) => { o.x = lerp(o.x, x, k); o.y = lerp(o.y, y, k); o.z = lerp(o.z, z, k); };
  if (slot === 'head' || slot === 'ears') {
    // плечо вверх-вперёд, предплечье загнуто над головой — ладони сходятся над макушкой
    set(L, -0.1, -0.35, 0.9); set(target.leftLowerArm, 0, -0.2, 1.7); set(target.leftHand, 0, 0, 0.35);
    set(R, -0.1, 0.35, -0.9); set(target.rightLowerArm, 0, 0.2, -1.7); set(target.rightHand, 0, 0, -0.35);
    target.head.x = lerp(target.head.x, 0.06, k);
  } else if (slot === 'face') {
    set(L, -0.6, 0.3, -0.5); set(target.leftLowerArm, 0, -2.1, 0); set(target.leftHand, 0.2, 0, -0.2);
    set(R, -0.6, -0.3, 0.5); set(target.rightLowerArm, 0, 2.1, 0); set(target.rightHand, 0.2, 0, 0.2);
  } else if (slot === 'neck') {
    set(L, -0.5, 0.25, -0.95); set(target.leftLowerArm, 0, -2.3, 0);
    set(R, -0.5, -0.25, 0.95); set(target.rightLowerArm, 0, 2.3, 0);
    target.head.x = lerp(target.head.x, 0.12, k);
  } else if (slot === 'back') {
    // взмах из-за плеч: руки вверх-назад
    set(L, 0.35, 0, 0.6); set(target.leftLowerArm, 0, -0.6, 0);
    set(R, 0.35, 0, -0.6); set(target.rightLowerArm, 0, 0.6, 0);
    target.spine.x = lerp(target.spine.x, -0.06, k);
  } else if (slot === 'hand') {
    set(L, -0.25, 0.3, -0.75); set(target.leftLowerArm, 0, -1.3, 0);
  }
}
/** Поза, пока в левой руке зонт или шарик */
export function holdPose(target) {
  target.leftUpperArm = { x: -0.22, y: 0.3, z: -0.95 };
  target.leftLowerArm = { x: 0, y: -1.45, z: 0 };
  target.leftHand = { x: 0, y: 0, z: 0.1 };
}

// ---------------------------------------------------------------- надеть / снять: k = время / длительность
export const WEAR_T = 1.8, OFF_T = 1.4;
/**
 * Надевание. Руки поднимаются (0…0.3), вещь возникает в ладонях (0.18…0.35), плывёт к месту по дуге (0.35…0.72),
 * встаёт на кость (0.72) — руки опускаются (0.78…1). Возвращает { raise, appear } для позы и искр.
 */
export function wearStep(scene, vrm, mesh, k) {
  const id = mesh.userData.accId, a = ACC[id], slot = slotOf(id);
  const raise = seg(k, 0, 0.3) * (1 - seg(k, 0.78, 1));
  if (k >= 0.72) { if (!mesh.userData.on) attachAccessory(vrm, mesh); return { raise, done: k >= 1 }; }
  if (mesh.parent !== scene) { mesh.removeFromParent(); scene.add(mesh); mesh.userData.on = false; }
  const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), hp = new THREE.Vector3();
  targetWorld(vrm, id, tp, tq);
  if (slot === 'back') hp.copy(tp).add(new THREE.Vector3(0, 0.45, 0));
  else if (slot === 'hand') hp.copy(tp);
  else handsMid(vrm, hp);
  const app = outBack(seg(k, 0.16, 0.36)), tr = ease(seg(k, 0.36, 0.72));
  mesh.position.lerpVectors(hp, tp, tr);
  mesh.position.y += Math.sin(tr * Math.PI) * 0.09;
  mesh.quaternion.copy(tq);
  if (a.worldUp) mesh.quaternion.identity();
  else mesh.quaternion.multiply(_q.setFromEuler(_e.set(0, (1 - tr) * 0.9, (1 - tr) * 0.4)));
  mesh.scale.setScalar(Math.max(0.001, app * lerp(0.75, 1, tr)));
  return { raise, appear: k > 0.16 && k < 0.2 };
}
/** Снять: руки к вещи, вещь в ладонях, бросок в сторону с вращением; side — куда бросить (±1) */
export function offStep(scene, vrm, mesh, k, side = 1) {
  const id = mesh.userData.accId, slot = slotOf(id);
  const raise = seg(k, 0, 0.28) * (1 - seg(k, 0.55, 0.85));
  if (k < 0.3) return { raise };
  if (mesh.parent !== scene) {
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(mesh.position, mesh.quaternion, _s);
    mesh.removeFromParent(); scene.add(mesh); mesh.userData.on = false;
    mesh.userData.from = mesh.position.clone();
  }
  const from = mesh.userData.from, hp = new THREE.Vector3();
  if (slot === 'back' || slot === 'hand') hp.copy(from).add(new THREE.Vector3(0, 0.25, 0)); else handsMid(vrm, hp);
  const a = ease(seg(k, 0.3, 0.5)), f = seg(k, 0.5, 1);
  mesh.position.lerpVectors(from, hp, a);
  mesh.position.x += side * f * 0.9; mesh.position.y += f * 0.55 - f * f * 0.9; mesh.position.z += f * 0.3;
  mesh.rotation.z += side * 0.12 * (f > 0 ? 1 : 0);
  mesh.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.65, 1)));
  return { raise, gone: k >= 1, toss: k > 0.5 && k < 0.54 };
}

// ---------------------------------------------------------------- ширма
/** Ширма из трёх створок: рамка и ткань с клевером. set(open 0…1) — раскрыть/сложить */
export function makeScreen() {
  const g = new THREE.Group();
  const wood = mat(0x26303f, { roughness: 0.55, metalness: 0.15 });
  const trim = mat(C.gold, { metalness: 0.7, roughness: 0.3 });
  const fabric = canvasTex(256, 1024, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2fc9b6'); gr.addColorStop(1, '#0c6e64'); x.fillStyle = gr; x.fillRect(0, 0, w, h);
    for (let row = 0; row < 12; row++) for (let col = 0; col < 3; col++) clover(x, 42 + col * 86 + (row % 2) * 43, 50 + row * 82, 16, 'rgba(255,255,255,.16)');
    x.strokeStyle = 'rgba(245,197,66,.7)'; x.lineWidth = 6; x.strokeRect(14, 14, w - 28, h - 28);
    clover(x, w / 2, h * 0.16, 34, 'rgba(255,255,255,.35)');
  });
  const H = 1.82, PW = 0.44;
  const panels = [];
  for (let i = 0; i < 3; i++) {
    const hinge = new THREE.Group(), p = new THREE.Group();
    add(p, new THREE.BoxGeometry(0.032, H, 0.032), wood, [-PW / 2, H / 2, 0]);
    add(p, new THREE.BoxGeometry(0.032, H, 0.032), wood, [PW / 2, H / 2, 0]);
    add(p, new THREE.BoxGeometry(PW + 0.03, 0.04, 0.036), wood, [0, H - 0.02, 0]);
    add(p, new THREE.BoxGeometry(PW + 0.03, 0.04, 0.036), wood, [0, 0.12, 0]);
    add(p, new THREE.SphereGeometry(0.022, 12, 8), trim, [-PW / 2, H + 0.02, 0]);
    add(p, new THREE.SphereGeometry(0.022, 12, 8), trim, [PW / 2, H + 0.02, 0]);
    add(p, new THREE.PlaneGeometry(PW - 0.03, H - 0.2), mat(0xffffff, { map: fabric, roughness: 0.9, side: THREE.DoubleSide }), [0, H / 2 + 0.05, 0]);
    hinge.add(p); panels.push({ hinge, p });
  }
  // средняя створка — в центре; боковые на петлях по краям средней
  const [l, m, r] = panels;
  g.add(m.hinge);
  m.p.position.x = 0;
  l.hinge.position.x = -PW / 2; l.p.position.x = -PW / 2 - 0.004; m.hinge.add(l.hinge);
  r.hinge.position.x = PW / 2; r.p.position.x = PW / 2 + 0.004; m.hinge.add(r.hinge);
  g.userData.set = open => {
    const k = clamp(open);
    l.hinge.rotation.y = lerp(Math.PI * 0.96, 0.62, ease(k));
    r.hinge.rotation.y = -lerp(Math.PI * 0.96, 0.62, ease(k));
    g.scale.set(1, Math.max(0.001, outBack(seg(k, 0, 0.6))), 1);
    g.visible = k > 0.001;
  };
  g.userData.top = H;
  g.traverse(o => { o.frustumCulled = false; });
  g.userData.set(0);
  return g;
}
/** Худи, переброшенное через ширму: силуэт кофты цвета старого наряда */
export function makeCloth(hex) {
  const tex = canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = hex; x.beginPath();
    x.moveTo(30, 18); x.lineTo(98, 18); x.lineTo(126, 50); x.lineTo(110, 66); x.lineTo(98, 54); x.lineTo(98, 124); x.lineTo(30, 124); x.lineTo(30, 54); x.lineTo(18, 66); x.lineTo(2, 50); x.closePath(); x.fill();
    x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(30, 104, 68, 20);
    x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(30, 40, 68, 6);
  });
  const geo = new THREE.PlaneGeometry(0.4, 0.4, 6, 6);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, Math.max(0, y - 0.05) * 0.9 * -1); }   // верх загнут за перекладину
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.95 }));
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------- переодевание за ширмой: k = время / OUTFIT_T
export const OUTFIT_T = 5.4;
/**
 * Сценарий: ширма раскрывается (0…0.12), Феликс идёт за неё (0.12…0.33), снятое худи взлетает и повисает на ширме (0.36…0.48),
 * переодевание — swap в 0.42, «вжух» над ширмой (0.5…0.58), выходит обратно (0.6…0.8), радуется, ширма складывается (0.84…1).
 * dir — в какую сторону ширма (±1). Возвращает всё, что нужно применить к сцене.
 */
export function outfitStep(k, dir = -1) {
  const S = { screenOpen: seg(k, 0, 0.12) * (1 - seg(k, 0.84, 1)), offX: 0, offZ: 0, facing: 0, walking: false, cloth: null, swap: k >= 0.42, happy: k >= 0.8 && k < 0.92, sparkle: k > 0.5 && k < 0.53 };
  const go = ease(seg(k, 0.12, 0.33)), back = ease(seg(k, 0.6, 0.8));
  S.offX = dir * 0.62 * (go - back);
  S.offZ = -0.4 * (go - back);
  S.walking = (k > 0.12 && k < 0.33) || (k > 0.6 && k < 0.8);
  S.facing = k > 0.12 && k < 0.33 ? dir * 1.2 : k > 0.6 && k < 0.8 ? -dir * 1.2 : 0;
  const c = seg(k, 0.36, 0.48);
  if (k > 0.36 && k < 0.98) {
    const up = Math.sin(c * Math.PI) * 0.35;
    S.cloth = { x: dir * 0.62 + lerp(0.05, -0.02, c), y: lerp(1.25, 1.62, ease(c)) + up, z: lerp(-0.35, 0.12, ease(c)), rx: lerp(1.6, 0, ease(c)), rz: (1 - c) * 2.5 * dir, scale: 1 - seg(k, 0.86, 0.96) };
  }
  return S;
}

// ---------------------------------------------------------------- наряды: перекраска текстур худи, штанов и кроссовок
const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
function noise2(seed) {
  const R = (i, j) => { const x = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return x - Math.floor(x); };
  return (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(R(i, j), R(i + 1, j), sx), lerp(R(i, j + 1), R(i + 1, j + 1), sx), sy); };
}
const TEAL_REF = { s: 0.27, v: 0.87 }, NAVY_REF = { s: 0.4, v: 0.25 };

function recolorImage(img, size, fn) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, size, size);
  const d = x.getImageData(0, 0, size, size);
  fn(d.data, size);
  x.putImageData(d, 0, 0);
  return c;
}
function paintTop(o) {
  const [mh, ms, mv] = rgb2hsv(...hex2rgb(o.main)), drip = o.drip ? rgb2hsv(...hex2rgb(o.drip)) : null;
  const camo = o.pattern === 'camo' ? noise2(3) : null, camo2 = o.pattern === 'camo' ? noise2(9) : null;
  const pal = o.pattern === 'camo' ? [hex2rgb('#3e5b2f'), hex2rgb('#8fae6a'), hex2rgb('#2f3b24')].map(c => rgb2hsv(...c)) : null;
  return (p, size) => {
    const mask = new Uint8Array(size * size);
    for (let i = 0, n = 0; i < p.length; i += 4, n++) {
      if (p[i + 3] < 8) continue;
      const [h, s, v] = rgb2hsv(p[i] / 255, p[i + 1] / 255, p[i + 2] / 255);
      let out = null;
      if (h > 160 && h < 205 && s > 0.1 && v > 0.3) {
        mask[n] = 1;
        let th = mh, ts = ms, tv = mv;
        if (camo) { const x = n % size, y = (n / size) | 0, a = camo(x / 90, y / 90), b = camo2(x / 40, y / 40); const c = a > 0.62 ? pal[0] : b > 0.66 ? pal[1] : a < 0.3 ? pal[2] : null; if (c) [th, ts, tv] = c; }
        let vv = clamp(tv * (v / TEAL_REF.v));
        if (o.pattern === 'denim') { const x = n % size, y = (n / size) | 0; vv = clamp(vv * (0.9 + 0.1 * Math.sin((x + y) * 1.3)) * (0.96 + Math.random() * 0.06)); }
        out = hsv2rgb(th, clamp(ts * (0.55 + 0.45 * s / TEAL_REF.s)), vv);
      } else if (drip && h > 195 && h < 245 && s > 0.15 && v < 0.42) {
        out = hsv2rgb(drip[0], clamp(drip[1] * (s / NAVY_REF.s)), clamp(drip[2] * (0.6 + 0.4 * v / NAVY_REF.v) + (drip[2] > 0.6 ? 0 : 0)));
      }
      if (out) { p[i] = out[0] * 255; p[i + 1] = out[1] * 255; p[i + 2] = out[2] * 255; }
    }
    // узоры поверх основной ткани: звёзды, лепестки, снежинки
    if (o.pattern === 'stars' || o.pattern === 'petals' || o.pattern === 'snow') {
      const rnd = (k => () => { k = (k * 16807) % 2147483647; return k / 2147483647; })(7);
      const n = o.pattern === 'stars' ? 520 : 300;
      for (let s = 0; s < n; s++) {
        const cx = rnd() * size, cy = rnd() * size, r = o.pattern === 'stars' ? (rnd() < 0.15 ? 4 : 1.6) : 3 + rnd() * 2.5;
        const col = o.pattern === 'stars' ? (rnd() < 0.3 ? [255, 230, 120] : [255, 255, 255]) : o.pattern === 'petals' ? [255, 245, 250] : [130, 200, 240];
        for (let y = Math.floor(cy - r * 2); y <= cy + r * 2; y++) for (let x = Math.floor(cx - r * 2); x <= cx + r * 2; x++) {
          if (x < 0 || y < 0 || x >= size || y >= size || !mask[y * size + x]) continue;
          const dx = x - cx, dy = y - cy;
          let a;
          if (o.pattern === 'stars') a = r > 2 ? clamp(1 - (Math.abs(dx) * Math.abs(dy) * 0.9 + Math.hypot(dx, dy) * 0.25) / r) : clamp(1.4 - Math.hypot(dx, dy) / r);
          else if (o.pattern === 'petals') a = clamp(1.2 - Math.hypot(dx * 0.7, dy * 1.4) / r) * 0.8;
          else a = clamp(1.2 - Math.min(Math.abs(dx), Math.abs(dy), Math.abs(dx - dy) * 0.7, Math.abs(dx + dy) * 0.7) * 1.6 - Math.hypot(dx, dy) / (r * 1.6)) * 0.9;
          if (a <= 0) continue;
          const i = (y * size + x) * 4;
          p[i] = lerp(p[i], col[0], a); p[i + 1] = lerp(p[i + 1], col[1], a); p[i + 2] = lerp(p[i + 2], col[2], a);
        }
      }
    }
  };
}
function paintPants(o) {
  const lo = hex2rgb(o.pants[0]), hi = hex2rgb(o.pants[1]);
  return p => {
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 8) continue;
      const [, s, v] = rgb2hsv(p[i] / 255, p[i + 1] / 255, p[i + 2] / 255);
      if (s > 0.18 || v > 0.75) continue;             // ремень, пряжка, бирка — как были
      const k = clamp((v - 0.06) / 0.34);
      p[i] = lerp(lo[0], hi[0], k) * 255; p[i + 1] = lerp(lo[1], hi[1], k) * 255; p[i + 2] = lerp(lo[2], hi[2], k) * 255;
    }
  };
}
function paintShoes(o) {
  const [mh, ms, mv] = rgb2hsv(...hex2rgb(o.shoes));
  return p => {
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 8) continue;
      const [h, s, v] = rgb2hsv(p[i] / 255, p[i + 1] / 255, p[i + 2] / 255);
      if (!(h > 160 && h < 205 && s > 0.12)) continue;
      const out = hsv2rgb(mh, clamp(ms * (0.6 + 0.4 * s / 0.35)), clamp(mv * (v / 0.85)));
      p[i] = out[0] * 255; p[i + 1] = out[1] * 255; p[i + 2] = out[2] * 255;
    }
  };
}

function clothMaterials(vrm) {
  const out = { tops: [], bottoms: [], shoes: [] };
  vrm.scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      const n = m.name || '';
      const kind = /N00_005_01_Tops/.test(n) ? 'tops' : /Bottoms/.test(n) ? 'bottoms' : /Shoes/.test(n) ? 'shoes' : null;
      if (kind && m.map && !out[kind].includes(m)) out[kind].push(m);
    }
  });
  return out;
}
const outfitCache = new WeakMap();
/** Текстуры наряда (считаются один раз и запоминаются) */
export function prepareOutfit(vrm, o) {
  let cache = outfitCache.get(vrm);
  if (!cache) {
    const mats = clothMaterials(vrm);
    cache = { mats, orig: Object.fromEntries(Object.entries(mats).map(([k, list]) => [k, list[0] ? list[0].map : null])), made: {} };
    outfitCache.set(vrm, cache);
  }
  if (!o || o.id === 'mint') return { tops: cache.orig.tops, bottoms: cache.orig.bottoms, shoes: cache.orig.shoes };
  if (cache.made[o.id]) return cache.made[o.id];
  const mk = (kind, paint, size) => {
    const src = cache.orig[kind]; if (!src || !paint) return src;
    const canvas = recolorImage(src.image, size, paint);
    const t = src.clone(); t.source = new THREE.Source(canvas); t.needsUpdate = true;
    return t;
  };
  const tex = { tops: mk('tops', paintTop(o), 1024), bottoms: o.pants ? mk('bottoms', paintPants(o), 512) : cache.orig.bottoms, shoes: o.shoes ? mk('shoes', paintShoes(o), 512) : cache.orig.shoes };
  cache.made[o.id] = tex;
  return tex;
}
/** Надеть наряд (перекрасить материалы модели) */
export function applyOutfit(vrm, o) {
  const tex = prepareOutfit(vrm, o), cache = outfitCache.get(vrm);
  for (const kind of ['tops', 'bottoms', 'shoes']) for (const m of cache.mats[kind]) {
    if (!tex[kind]) continue;
    m.map = tex[kind];
    if ('shadeMultiplyTexture' in m && m.shadeMultiplyTexture) m.shadeMultiplyTexture = tex[kind];
    m.needsUpdate = true;
  }
}
