// Вещи Феликса поверх модели VRM: наушники на шее и телефон (когда спрашивает нейросеть).
import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1, ...o });
// посадка гарнитуры относительно кости головы (метры); ?hp=y,z,s в адресе — для подгонки на снимках
const HP = (() => { const q = new URLSearchParams(location.search).get('hp'); const [y, z, s] = q ? q.split(',').map(Number) : [0.066, -0.012, 1]; return { y, z, s }; })();

/** Наушники-гарнитура на голове: дуга поверх волос, чашки на ушах с бирюзовыми кольцами */
function headphones() {
  const g = new THREE.Group();
  const navy = mat(0x1d2633, { roughness: 0.45, metalness: 0.25 });
  const teal = mat(0x2ed3c0, { roughness: 0.35, emissive: 0x0b5e55, emissiveIntensity: 0.45 });
  const soft = mat(0x111820, { roughness: 0.95 });
  // дуга: верхняя половина тора в плоскости лица
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.0085, 10, 48, Math.PI), navy);
  band.scale.set(1, 1.08, 1);
  g.add(band);
  for (const s of [-1, 1]) {
    const cup = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.026, 32), navy);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.005, 8, 32), teal);
    ring.position.y = 0.0135; ring.rotation.x = Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24), teal); cap.position.y = 0.0136; cap.rotation.x = -Math.PI / 2;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, 0.014, 28), soft); pad.position.y = -0.019;
    cup.add(shell, ring, cap, pad);
    // ось чашки — вдоль X, наружу
    cup.position.set(s * 0.108, -0.004, 0);
    cup.rotation.set(0, 0, -s * Math.PI / 2);
    g.add(cup);
  }
  return g;
}

/** Телефон в руках, когда Феликс спрашивает нейросеть: корпус и светящийся экран с «перепиской» */
export function makePhone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.145, 0.009), mat(0x0f171d, { roughness: 0.35, metalness: 0.4 }));
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#081013'; x.fillRect(0, 0, 128, 256);
  x.fillStyle = '#1FB5A3'; x.fillRect(0, 0, 128, 22);
  const bub = (y, w, right, col) => { x.fillStyle = col; x.beginPath(); x.roundRect(right ? 124 - w : 6, y, w, 26, 9); x.fill(); };
  bub(34, 80, true, '#1FB5A3'); bub(68, 96, false, '#24343a'); bub(102, 70, true, '#1FB5A3'); bub(136, 104, false, '#24343a'); bub(170, 60, true, '#1FB5A3');
  x.fillStyle = '#16242a'; x.fillRect(0, 214, 128, 42); x.fillStyle = '#5EF0D8'; x.fillRect(10, 228, 70, 4);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.132), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = 0.0048;
  g.add(body, screen);
  g.visible = false;
  return g;
}

/** Надеть вещи. Крепятся к «сырым» костям модели, поэтому двигаются вместе с телом. */
export function decorate(vrm) {
  const head = vrm.humanoid.getRawBoneNode('head');
  if (head) {
    const hp = headphones();
    // центр дуги — на уровне ушей, чуть позади середины головы
    hp.position.set(0, HP.y, HP.z);
    hp.scale.setScalar(HP.s);
    head.add(hp);
  }
  return () => { };
}

export function holdPhone(vrm, phone) {
  const chest = vrm.humanoid.getRawBoneNode('upperChest') || vrm.humanoid.getRawBoneNode('chest');
  if (!chest) return;
  chest.add(phone);
  phone.position.set(0.0, -0.03, 0.2);
  phone.rotation.set(-1.0, 0, 0);
}

/** Поза «печатает в телефоне»: обе руки у груди, голова опущена, пальцы стучат */
export function phonePose(target, t) {
  target.rightUpperArm = { x: -0.25, y: 0.55, z: 1.05 };
  target.rightLowerArm = { x: 0, y: 1.75, z: 0 };
  target.rightHand = { x: 0.15 + Math.sin(t * 15) * 0.07, y: 0, z: 0.25 };
  target.leftUpperArm = { x: -0.25, y: -0.55, z: -1.05 };
  target.leftLowerArm = { x: 0, y: -1.75, z: 0 };
  target.leftHand = { x: 0.15 + Math.sin(t * 15 + 1.7) * 0.07, y: 0, z: -0.25 };
  target.head = { x: 0.38, y: 0, z: 0.04 };
  target.neck = { x: 0.1, y: 0, z: 0 };
  target.spine = { x: 0.05, y: 0, z: 0 };
}
