// Феликс — 3D-ассистент на рабочем столе (VRM + процедурная анимация)
import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './vendor/three-vrm.module.js';
import { Y, init, sound, svg } from './common.js';
import { makePhone, holdPhone, phonePose } from './felix3d.js';
import * as WR from './wardrobe3d.js';

const $ = s => document.querySelector(s);
const Q = new URLSearchParams(location.search);
const PORTRAIT = Q.get('portrait') === '1';
// поворот ладони при «привет» (подбор на снимках: ?tw=предплечье,кисть_x,кисть_y)
const TW = (Q.get('tw') || '0,-1.5,0').split(',').map(Number);   // кисть повёрнута ладонью к зрителю
let cfg = null;
let side = Q.get('side') === 'left' ? 'left' : 'right';

// ---------------------------------------------------------------- сцена
const canvas = $('#gl');
// Если видеодрайвер перезапустился, WebGL теряется — ждём восстановления, иначе перезагружаем страницу
const GL_RETRY = 'felix.glRetry';
function retryLater(why) {
  let n = 0; try { n = Number(sessionStorage.getItem(GL_RETRY) || 0); sessionStorage.setItem(GL_RETRY, String(n + 1)); } catch { }
  const sec = Math.min(60, 5 * 2 ** n);
  console.error(`felix: ${why}, перезагрузка через ${sec} с`);
  setTimeout(() => location.reload(), sec * 1000);
}
{
  let ok = false;
  try { const c = document.createElement('canvas'); ok = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { }
  if (!ok) { retryLater('WebGL недоступен'); throw new Error('no webgl'); }
}
canvas.addEventListener('webglcontextlost', () => {
  console.error('felix: WebGL context lost');
  setTimeout(() => { if (renderer.getContext().isContextLost()) retryLater('контекст WebGL не вернулся'); }, 2500);
});
setTimeout(() => { try { sessionStorage.removeItem(GL_RETRY); } catch { } }, 30000);
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: PORTRAIT });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
const scene = new THREE.Scene();
const light = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);
light.position.set(0.6, 1.2, 1.6).normalize();
scene.add(light);
const rim = new THREE.DirectionalLight(0x4fe3d0, 1.0);
rim.position.set(-1, 0.6, -0.6);
scene.add(rim);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
camera.position.set(0, 0, 10);
const root = new THREE.Group();
const turn = new THREE.Group();
root.add(turn);
scene.add(root);
const lookTarget = new THREE.Object3D();
scene.add(lookTarget);

let W = innerWidth, H = innerHeight;
const HEADROOM = Number(Q.get('headroom') || 0);
let pxPerM = 300;
let modelH = 1.6;
let mode = 'home';                    // home | idle
const homeFoot = () => ({ x: W * (side === 'left' ? 0.36 : 0.64), y: H - 4 });
let foot = homeFoot();

function screenToWorld(x, y) { return new THREE.Vector3((x - W / 2) / pxPerM, (H / 2 - y) / pxPerM, 0); }
function worldToScreen(v) { return { x: v.x * pxPerM + W / 2, y: H / 2 - v.y * pxPerM }; }

function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false);
  fx.width = W; fx.height = H;
  if (mode === 'home') { pxPerM = ((H - HEADROOM) * 0.80) / modelH; foot = homeFoot(); }
  // крупный план (проверочные снимки и кадры для ролика): ?focus=head|bust
  const focus = Q.get('focus');
  if (focus) { const span = focus === 'head' ? 0.42 : 0.9; pxPerM = (H * 0.9) / span; foot = { x: W * 0.5, y: H * (focus === 'head' ? 0.42 : 0.3) + (modelH - 0.12) * pxPerM }; }
  camera.left = -W / 2 / pxPerM; camera.right = W / 2 / pxPerM; camera.top = H / 2 / pxPerM; camera.bottom = -H / 2 / pxPerM;
  camera.updateProjectionMatrix();
  placeRoot();
  layoutUI();
}
function placeRoot() { const p = screenToWorld(foot.x, foot.y); root.position.set(p.x, p.y, 0); }
const fx = $('#fx'); const fxc = fx.getContext('2d');
addEventListener('resize', resize);

// ---------------------------------------------------------------- модель
const loader = new GLTFLoader();
loader.register(p => new VRMLoaderPlugin(p));
let vrm = null;
const B = {};
const BONES = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot'];

async function loadVRM(url) {
  const gltf = await loader.loadAsync(url);
  const v = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene); else if (VRMUtils.removeUnnecessaryJoints) VRMUtils.removeUnnecessaryJoints(gltf.scene);
  if (v.meta?.metaVersion === '0') VRMUtils.rotateVRM0(v);
  v.scene.traverse(o => { o.frustumCulled = false; });
  if (v.lookAt) v.lookAt.target = lookTarget;
  v.userData = v.userData || {};
  v.userData.phone = makePhone();
  holdPhone(v, v.userData.phone);
  return v;
}

function attach(v) {
  if (vrm) { turn.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); }
  vrm = v;
  for (const b of BONES) B[b] = vrm.humanoid.getNormalizedBoneNode(b);
  vrm.scene.updateMatrixWorld(true);
  const headPos = new THREE.Vector3(); B.head.getWorldPosition(headPos);
  modelH = Math.max(1.0, headPos.y + 0.16);
  turn.add(vrm.scene);
  resize();
}

// ---------------------------------------------------------------- позы
const E = (x = 0, y = 0, z = 0) => ({ x, y, z });
const target = {}, cur = {};
for (const b of BONES) { target[b] = E(); cur[b] = E(); }
let hipsY = 0, hipsYTarget = 0;

function setBase() {
  for (const b of BONES) target[b] = E();
  // парень стоит чуть шире и свободнее: руки ниже, одна в «кармане»
  target.leftUpperArm = E(0, 0, -1.25); target.rightUpperArm = E(0, 0, 1.25);
  target.leftLowerArm = E(0, -0.2, -0.1); target.rightLowerArm = E(0, 0.2, 0.1);
  target.leftHand = E(0, 0, -0.1); target.rightHand = E(0, 0, 0.1);
  target.leftUpperLeg = E(0, 0, 0.035); target.rightUpperLeg = E(0, 0, -0.035);
  if (worn.hand) WR.holdPose(target);           // зонт или шарик в левой руке
  hipsYTarget = 0;
}

let state = 'idle', stateT = 0, nextGesture = 6;
let walk = null;
let facing = 0, facingTarget = 0;
let mouth = 0, talkLevel = 0, blinkT = 3, blinkV = 0;
const expr = { happy: 0, relaxed: 0, surprised: 0, sad: 0, angry: 0 };
const exprTarget = { ...expr };
let mouse = { x: -1, y: -1, t: 0 };
let visibleScale = 1, scaleTarget = 1, spin = 0, spinV = 0;

function setState(s) { state = s; stateT = 0; }

function pose(t, dt) {
  setBase();
  const breathe = Math.sin(t * 1.5);
  target.chest.x = breathe * 0.015; target.spine.x = breathe * 0.01;
  target.leftShoulder.z = breathe * 0.012; target.rightShoulder.z = -breathe * 0.012;
  target.hips.z = Math.sin(t * 0.5) * 0.018;
  target.spine.z = -Math.sin(t * 0.5) * 0.012;
  target.leftUpperArm.z += Math.sin(t * 1.5 + 1) * 0.02; target.rightUpperArm.z -= Math.sin(t * 1.5 + 1) * 0.02;

  // взгляд и голова за курсором
  const head = worldToScreen(new THREE.Vector3(root.position.x, root.position.y + modelH * 0.92 * visibleScale, 0));
  const hasMouse = mouse.x >= 0 && performance.now() - mouse.t < 8000;
  const dx = hasMouse ? THREE.MathUtils.clamp((mouse.x - head.x) / 500, -1, 1) : Math.sin(t * 0.3) * 0.2;
  const dy = hasMouse ? THREE.MathUtils.clamp((mouse.y - head.y) / 500, -1, 1) : 0.1;
  target.head.y = dx * 0.45; target.head.x = dy * 0.25; target.neck.y = dx * 0.15;
  lookTarget.position.set(root.position.x + dx * 2, root.position.y + modelH * 0.92 - dy * 1.5, 3);

  stateT += dt;
  switch (state) {
    case 'talk':
      target.head.x += Math.sin(t * 5) * 0.03 + talkLevel * 0.05;
      target.head.z = Math.sin(t * 1.7) * 0.05;
      target.rightUpperArm = E(-0.15, 0, 1.0); target.rightLowerArm = E(0, 1.0 + Math.sin(t * 3) * 0.15, 0.1);
      target.rightHand = E(0, 0, 0.2 + Math.sin(t * 4) * 0.1);
      break;
    case 'listen': target.head.z = 0.14; target.spine.x = 0.05; target.head.x += 0.05; exprTarget.surprised = 0.12; break;
    case 'phone': phonePose(target, stateT); exprTarget.relaxed = 0.3; break;
    case 'think':
      target.rightUpperArm = E(-0.55, 0, 1.05); target.rightLowerArm = E(0, 2.25, 0); target.rightHand = E(0.3, 0, 0.4);
      target.leftUpperArm = E(-0.3, 0, -1.1); target.leftLowerArm = E(0, -1.3, 0);
      target.head.z = -0.12; target.head.x += 0.06; break;
    case 'wave':
      // локоть на уровне плеча, предплечье вверх, ладонь машет
      target.rightUpperArm = E(0, -0.4, 0.02); target.rightLowerArm = E(TW[0], 0.1, -1.5 + Math.sin(stateT * 10) * 0.3);
      target.rightHand = E(TW[1], TW[2], Math.sin(stateT * 10 + 0.6) * 0.25);
      target.head.z = 0.08; exprTarget.happy = 0.8;
      if (stateT > 2.2 && !PORTRAIT) setState('idle'); break;
    case 'happy':
      hipsYTarget = Math.max(0, Math.sin(stateT * 9)) * 0.05 * Math.max(0, 1 - stateT / 1.6);
      target.leftUpperArm = E(0, 0, -0.85); target.rightUpperArm = E(0, 0, 0.85);
      target.leftLowerArm = E(0, -0.9, 0); target.rightLowerArm = E(0, 0.9, 0);
      exprTarget.happy = 1; if (stateT > 2) setState('idle'); break;
    case 'shy':
      // смущённо чешет затылок
      target.rightUpperArm = E(-0.5, 0.2, -0.6); target.rightLowerArm = E(0, 0.3, -1.9); target.rightHand = E(0, 0, Math.sin(stateT * 12) * 0.15);
      target.head.x += 0.12; target.head.z = -0.1; exprTarget.happy = 0.6; exprTarget.relaxed = 0.4;
      if (stateT > 2.6) setState('idle'); break;
    case 'walk': case 'run': {
      const sp = state === 'run' ? 13 : 8.5, amp = state === 'run' ? 0.62 : 0.42;
      const ph = stateT * sp;
      target.leftUpperLeg.x = Math.sin(ph) * amp; target.rightUpperLeg.x = -Math.sin(ph) * amp;
      target.leftLowerLeg.x = Math.max(0, -Math.sin(ph - 0.6)) * amp * 1.4; target.rightLowerLeg.x = Math.max(0, Math.sin(ph - 0.6)) * amp * 1.4;
      target.leftUpperArm.x = -Math.sin(ph) * amp * 0.7; target.rightUpperArm.x = Math.sin(ph) * amp * 0.7;
      target.leftUpperArm.z = -1.3; target.rightUpperArm.z = 1.3;
      target.spine.x = state === 'run' ? 0.12 : 0.04;
      hipsYTarget = -Math.abs(Math.cos(ph)) * 0.025;
      target.head.y = 0; target.head.x = 0;
      break;
    }
    case 'point':
      target.rightUpperArm = E(-0.9, 0, 0.35); target.rightLowerArm = E(0, 0.2, 0);
      target.rightHand = E(0, 0, Math.sin(stateT * 8) * 0.15);
      target.spine.x = 0.08; exprTarget.happy = 0.4; break;
    case 'sit': case 'sleep':
      hipsYTarget = -0.42;
      target.leftUpperLeg = E(-1.45, 0, -0.08); target.rightUpperLeg = E(-1.45, 0, 0.08);
      target.leftLowerLeg = E(1.25 + Math.sin(stateT * 2) * (state === 'sit' ? 0.25 : 0), 0, 0); target.rightLowerLeg = E(1.25 - Math.sin(stateT * 2) * (state === 'sit' ? 0.25 : 0), 0, 0);
      target.leftUpperArm = E(-0.25, 0, -1.3); target.rightUpperArm = E(-0.25, 0, 1.3);
      if (state === 'sleep') { target.head.x = 0.45; target.head.y = 0; target.head.z = 0.15; target.spine.x = 0.2; }
      break;
    case 'stretch': {
      const k = Math.min(1, stateT / 0.8) * Math.min(1, Math.max(0, (3 - stateT) / 0.8));
      target.leftUpperArm = E(0, 0, -1.25 + k * 2.5); target.rightUpperArm = E(0, 0, 1.25 - k * 2.5);
      target.leftLowerArm = E(0, 0, k * 0.3); target.rightLowerArm = E(0, 0, -k * 0.3);
      target.spine.x = -0.12 * k; target.head.x = -0.2 * k; exprTarget.relaxed = k; mouth = Math.max(mouth, k * 0.6);
      if (stateT > 3) setState('idle'); break;
    }
    case 'lookaround':
      target.head.y = Math.sin(stateT * 1.8) * 0.6; target.neck.y = Math.sin(stateT * 1.8) * 0.2;
      if (stateT > 3.4) setState('idle'); break;
    case 'headphones': {
      // поправляет наушники на шее
      const k = Math.min(1, stateT / 0.5) * Math.min(1, Math.max(0, (2.4 - stateT) / 0.5));
      target.leftUpperArm = E(-0.6 * k, 0.3 * k, -1.25 + k * 0.75); target.leftLowerArm = E(0, -k * 2.0, 0);
      target.rightUpperArm = E(-0.6 * k, -0.3 * k, 1.25 - k * 0.75); target.rightLowerArm = E(0, k * 2.0, 0);
      target.head.x += 0.08 * k; exprTarget.relaxed = k * 0.5;
      if (stateT > 2.4) setState('idle'); break;
    }
  }
  if (state === 'idle' && mode === 'home' && !wact) {
    nextGesture -= dt;
    if (nextGesture <= 0) { nextGesture = 12 + Math.random() * 18; setState(['stretch', 'lookaround', worn.ears ? 'headphones' : 'stretch', 'lookaround'][Math.floor(Math.random() * 4)]); }
  }
  // руки к голове / лицу / шее, пока надевает или снимает вещь
  const dp = dressPose || (Q.get('dress') ? { slot: Q.get('dress'), raise: Number(Q.get('raise') || 1) } : null);
  if (dp) WR.wearPose(target, dp.slot, dp.raise, t);
}

function applyPose(dt) {
  if (!vrm) return;
  const k = 1 - Math.exp(-dt * 9);
  for (const b of BONES) {
    const n = B[b]; if (!n) continue;
    const c = cur[b], t = target[b];
    c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.z += (t.z - c.z) * k;
    n.rotation.set(c.x, c.y, c.z);
  }
  hipsY += (hipsYTarget - hipsY) * k;
  if (B.hips) B.hips.position.y = (B.hips.userData.y0 ??= B.hips.position.y) + hipsY;

  const em = vrm.expressionManager;
  if (!em) return;
  blinkT -= dt;
  if (blinkT <= 0) { blinkV = 1; blinkT = 2.5 + Math.random() * 4; }
  blinkV = Math.max(0, blinkV - dt * 7);
  const sleepy = state === 'sleep' ? 1 : 0;
  for (const e of Object.keys(expr)) { expr[e] += (exprTarget[e] - expr[e]) * k; exprTarget[e] *= 0.97; }
  const happyEyes = expr.happy > 0.5;
  em.setValue('blink', Math.max(sleepy, happyEyes ? 0 : Math.sin(Math.min(1, blinkV) * Math.PI)));
  em.setValue('happy', expr.happy); em.setValue('relaxed', expr.relaxed); em.setValue('surprised', expr.surprised);
  const m = Math.min(1, mouth);
  em.setValue('aa', m * 0.8); em.setValue('oh', m * 0.3 * (Math.sin(performance.now() / 90) * 0.5 + 0.5)); em.setValue('ih', m * 0.25 * (Math.cos(performance.now() / 70) * 0.5 + 0.5));
  mouth *= 0.8;
}

// ---------------------------------------------------------------- речь и облачко
let actx = null, analyser = null, abuf = null, playing = null;
let bubbleTimer = null;

function bubble(title, sub = '', opts = {}) {
  const b = $('#bubble'), bt = $('#bt'), bs = $('#bs');
  cancelTyping();
  b.style.width = b.style.height = '';
  bt.textContent = title;
  if (opts.think) bs.innerHTML = '<span class="think"><i></i><i></i><i></i></span>'; else bs.textContent = sub || '';
  $('#wave').style.display = opts.wave ? 'flex' : 'none';
  b.classList.add('show');
  if (!opts.think && !opts.wave) {
    b.style.width = b.offsetWidth + 'px';
    b.style.height = b.offsetHeight + 'px';
    typeText([[bt, title], [bs, sub || '']], opts.cps || 40);
  }
  layoutUI();
  clearTimeout(bubbleTimer);
  if (opts.hold !== true) bubbleTimer = setTimeout(hideBubble, opts.ms || 6000);
}
function hideBubble() { cancelTyping(); $('#bubble').classList.remove('show'); }

let typeRaf = null, typeFinish = null;
const caret = document.createElement('i');
caret.className = 'caret';
function typeText(parts, cps) {
  const nodes = parts.map(([el, text]) => { el.textContent = ''; const n = document.createTextNode(''); el.appendChild(n); return [el, n, text]; });
  const total = parts.reduce((s, [, t]) => s + t.length, 0);
  const t0 = performance.now();
  let pi = 0, shown = 0;
  const scroll = () => { const s = $('#bscroll'); s.scrollTop = s.scrollHeight; };
  const step = () => {
    const want = Math.min(total, Math.floor((performance.now() - t0) / 1000 * cps) + 1);
    while (shown < want && pi < nodes.length) {
      const [el, n, text] = nodes[pi];
      if (n.data.length < text.length) { n.data += text[n.data.length]; shown++; if (caret.parentNode !== el) el.appendChild(caret); }
      else pi++;
    }
    scroll();
    if (shown < total) typeRaf = requestAnimationFrame(step); else { typeRaf = null; caret.remove(); }
  };
  typeFinish = () => { nodes.forEach(([, n, text]) => { n.data = text; }); caret.remove(); scroll(); };
  typeRaf = requestAnimationFrame(step);
}
function finishTyping() { if (typeRaf) { cancelAnimationFrame(typeRaf); typeRaf = null; if (typeFinish) typeFinish(); } }
function cancelTyping() { if (typeRaf) cancelAnimationFrame(typeRaf); typeRaf = null; caret.remove(); }
$('#wave').innerHTML = '<i></i>'.repeat(14);

function splitTitle(text) {
  const m = text.match(/^(.{1,60}?[.!?…])\s+(.+)$/);
  return m ? [m[1], m[2]] : [text, ''];
}

async function say({ text, wav, pitch = 1, volume = 0.9, anim = 'talk', emotion = 'neutral' }) {
  if (minimized) $('#orb').title = splitTitle(text)[0];
  const [t1, t2] = splitTitle(text);
  const showText = sec => {
    if (cfg.assistant.subtitles === false || minimized) return;
    bubble(t1, t2, { hold: true, cps: sec ? Math.max(12, Math.min(70, text.length / (sec * 0.9))) : 32 });
  };
  if (emotion === 'happy') exprTarget.happy = 0.8;
  if (emotion === 'shy') { exprTarget.happy = 0.5; exprTarget.relaxed = 0.5; }
  const onPhone = () => state === 'phone' || !!wact;      // пока переодевается — поза не меняется, двигается только рот
  if (!onPhone() && ['wave', 'happy', 'shy', 'think', 'listen', 'stretch'].includes(anim)) setState(anim);
  const after = () => {
    if (state === 'talk') setState('idle');
    finishTyping();
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { if (state === 'phone' && !minimized) bubble('Спрашиваю нейросеть…', '', { think: true, hold: true }); else hideBubble(); }, state === 'phone' ? 1200 : 3500);
    Y.invoke('felix:spoken');
  };
  if (!wav) { const d = Math.min(8000, 900 + text.length * 55); showText(d / 1000); fakeTalk(d, onPhone()); setTimeout(after, d); return; }
  try {
    actx = actx || new AudioContext();
    if (actx.state === 'suspended') await actx.resume();
    const data = await (await fetch(wav)).arrayBuffer();
    const buf = await actx.decodeAudioData(data);
    if (playing) try { playing.stop(); } catch { }
    showText(buf.duration / pitch);
    const src = actx.createBufferSource(); src.buffer = buf; src.playbackRate.value = pitch;
    const gain = actx.createGain(); gain.gain.value = volume;
    analyser = actx.createAnalyser(); analyser.fftSize = 512; abuf = new Float32Array(analyser.fftSize);
    src.connect(gain); gain.connect(analyser); analyser.connect(actx.destination);
    src.onended = () => { if (playing === src) { playing = null; analyser = null; after(); } };
    playing = src; src.start();
    if (!onPhone() && !['wave', 'happy', 'shy', 'think', 'stretch'].includes(anim)) setState('talk');
  } catch (e) { console.error(e); showText(); after(); }
}

let fakeUntil = 0;
function fakeTalk(ms, keepPose) { fakeUntil = performance.now() + ms; if (!keepPose) setState('talk'); }
function updateMouth() {
  if (analyser) {
    analyser.getFloatTimeDomainData(abuf);
    let s = 0; for (const v of abuf) s += v * v;
    talkLevel = Math.min(1, Math.sqrt(s / abuf.length) * 7);
    mouth = Math.max(mouth, talkLevel);
  } else if (performance.now() < fakeUntil) {
    talkLevel = 0.5 + 0.5 * Math.sin(performance.now() / 70); mouth = Math.max(mouth, talkLevel * 0.8);
  } else talkLevel = 0;
}

// ---------------------------------------------------------------- события
Y.on('say', d => say(d));
Y.on('partial', d => { if (!minimized) bubble('Слушаю…', d.text, { wave: true, ms: 4000 }); });
Y.on('heard', d => { if (!minimized && d.intent !== 'call') bubble('«' + d.text + '»', '', { ms: 2500, cps: 70 }); });
Y.on('listen', d => { sound('listen', 0.4); setState('listen'); if (!minimized) bubble('Слушаю.', 'Говори команду.', { wave: true, ms: d.until - Date.now() }); });
Y.on('think', d => {
  if (d.on) {
    if (d.phone) { setState('phone'); sound('pop', 0.25); bubble(d.text || 'Спрашиваю нейросеть…', '', { think: true, hold: true }); }
    else { setState('think'); bubble('Думаю…', '', { think: true, hold: true }); }
  } else if (state === 'think' || state === 'phone') {
    if (state === 'phone') { burst(14, 'spark'); clearTimeout(bubbleTimer); bubbleTimer = setTimeout(hideBubble, 2500); }
    setState('idle');
  }
});
Y.on('level', d => { document.querySelectorAll('#wave i').forEach(b => b.style.height = (4 + d.v * 16 * (0.5 + Math.random() * 0.8)) + 'px'); });
Y.on('mic', d => { micOk = d.ok; updateOrbMic(); });
Y.on('chime', () => sound('notify', 0.7));
Y.on('notice', d => { if (!minimized && !playing && state !== 'talk') bubble(d.title || '', d.text || '', { ms: d.ms || 6000, cps: 80 }); });
Y.on('minimize', () => minimize());
Y.on('restore', () => restore());
Y.on('idle-play', d => startIdlePlay(d));
Y.on('idle-end', d => endIdlePlay(d));
Y.on('side', s => { if (s !== side) { side = s; if (mode === 'home') { foot = homeFoot(); placeRoot(); layoutUI(); burst(30, 'leaf'); } } });

// ---------------------------------------------------------------- свернуть / развернуть
let minimized = false, micOk = true;
function orbPos() { return { x: side === 'left' ? 12 : W - 70, y: H - 70 }; }
function showOrb() { const o = $('#orb'); const op = orbPos(); o.style.left = op.x + 'px'; o.style.top = op.y + 'px'; o.style.display = 'block'; }
function minimize() {
  if (minimized) return;
  minimized = true; hideBubble();
  sound('hide', 0.5);
  setState('wave');
  setTimeout(() => {
    spinV = 16; scaleTarget = 0;
    burst(50, 'leaf', foot.x, foot.y - modelH * pxPerM * 0.5);
    setTimeout(() => { showOrb(); turn.visible = false; }, 450);
  }, 900);
}
function restore() {
  if (!minimized) return;
  minimized = false;
  $('#orb').style.display = 'none';
  turn.visible = true; visibleScale = 0.01; turn.scale.setScalar(0.01); scaleTarget = 1; spinV = 18;
  sound('appear', 0.5);
  burst(70, 'leaf', foot.x, foot.y - modelH * pxPerM * 0.5);
  setTimeout(() => setState('happy'), 400);
}
function updateOrbMic() { $('#orbMic')?.classList.toggle('off', !(cfg?.assistant.mic && micOk)); }
$('#orb').onclick = () => Y.invoke('felix:minimize', false);

// ---------------------------------------------------------------- частицы: искры и листики клевера
const parts = [];
function burst(n, kind, x = foot.x, y = foot.y - modelH * pxPerM * 0.5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 260;
    parts.push({ x: x + (Math.random() - 0.5) * 60, y: y + (Math.random() - 0.5) * modelH * pxPerM * 0.6, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 1, kind, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8, size: kind === 'leaf' ? 5 + Math.random() * 6 : 2 + Math.random() * 3 });
  }
}
function drawLeaf(r, color) {
  fxc.fillStyle = color;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; fxc.beginPath(); fxc.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.58, 0, Math.PI * 2); fxc.fill(); }
}
function drawParts(dt) {
  fxc.clearRect(0, 0, W, H);
  if (!parts.length) return;
  const cs = getComputedStyle(document.documentElement);
  const ac = cs.getPropertyValue('--accent2').trim() || '#5EF0D8', ac1 = cs.getPropertyValue('--accent').trim() || '#1FB5A3';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt * (p.kind === 'leaf' ? 0.6 : 1.2);
    if (p.life <= 0 || p.y > H + 10) { parts.splice(i, 1); continue; }
    p.vy += (p.kind === 'leaf' ? 40 : 160) * dt; p.vx *= 0.98; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    fxc.save(); fxc.globalAlpha = Math.min(1, p.life * 1.5); fxc.translate(p.x, p.y); fxc.rotate(p.rot);
    if (p.kind === 'leaf') drawLeaf(p.size, Math.random() < 0.3 ? '#26303F' : ac1);
    else if (p.kind === 'heart') { const s = p.size * 2.2; fxc.fillStyle = '#ff6b9a'; fxc.beginPath(); fxc.moveTo(0, s * 0.3); fxc.bezierCurveTo(-s, -s * 0.4, -s * 0.4, -s * 1.1, 0, -s * 0.45); fxc.bezierCurveTo(s * 0.4, -s * 1.1, s, -s * 0.4, 0, s * 0.3); fxc.fill(); }
    else { fxc.fillStyle = ac; fxc.shadowColor = ac; fxc.shadowBlur = 8; fxc.beginPath(); fxc.arc(0, 0, p.size, 0, Math.PI * 2); fxc.fill(); }
    fxc.restore();
  }
}

// ---------------------------------------------------------------- прогулка по рабочему столу, пока пользователя нет
let idle = null;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function walkTo(x, y, speed = 130, run = false) { return new Promise(res => { walk = { to: { x, y }, speed, res }; setState(run ? 'run' : 'walk'); }); }
function peek(icon) {
  const el = document.createElement('div');
  el.className = 'peek glass';
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const kids = icon.kids && icon.kids.length ? icon.kids.map(k => `<div class="f">• ${esc(k)}</div>`).join('') : '<div class="f">Хм, что тут у нас…</div>';
  el.innerHTML = `<div class="t">${svg('folder')}${esc(icon.name)}</div>${kids}`;
  el.style.left = Math.min(W - 230, icon.x + icon.w + 10) + 'px'; el.style.top = Math.max(40, icon.y - 20) + 'px';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return () => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); };
}
function mark(text, cls = 'mark') {
  const el = document.createElement('div');
  el.className = cls; el.textContent = text;
  const top = worldToScreen(new THREE.Vector3(root.position.x, root.position.y + modelH * 1.05 * visibleScale, 0));
  el.style.left = (top.x - 8) + 'px'; el.style.top = (top.y - 30) + 'px';
  document.body.appendChild(el);
  return el;
}
async function startIdlePlay(d) {
  if (minimized || idle) return;
  hideBubble();
  document.body.classList.remove('home');
  idle = { icons: d.icons || [], alive: true, zzz: null };
  const hp = { x: d.home.x + d.home.width * (side === 'left' ? 0.36 : 0.64), y: d.home.y + d.home.height - 4 };
  mode = 'idle'; foot = hp; resize(); idle.homePos = hp;
  scaleTarget = 0.62;
  const loopStart = performance.now();
  await sleep(600);
  setState('stretch'); await sleep(2500);
  let visited = 0;
  while (idle && idle.alive) {
    const minutes = (performance.now() - loopStart) / 60000;
    if (minutes > 6 || !idle.icons.length) {
      await walkTo(W * 0.5 + 200, H - 40, 110); if (!idle?.alive) break;
      setState('sit'); await sleep(4000); if (!idle?.alive) break;
      setState('sleep');
      idle.zzz = [0, 1, 2].map(i => { const z = mark('z', 'zzz'); z.style.animationDelay = i + 's'; return z; });
      while (idle?.alive) await sleep(500);
      break;
    }
    const ic = idle.icons[Math.floor(Math.random() * idle.icons.length)];
    await walkTo(Math.min(W - 80, ic.x + ic.w + 46), Math.min(H - 10, ic.y + ic.h + 6), 140); if (!idle?.alive) break;
    facingTarget = -1.1; setState('point'); await sleep(700); if (!idle?.alive) break;
    const close = peek(ic); exprTarget.surprised = 0.6;
    await sleep(3200); close(); if (!idle?.alive) break;
    setState(Math.random() < 0.5 ? 'happy' : 'lookaround'); await sleep(1800);
    if (++visited % 3 === 0) { setState('sit'); await sleep(5000); }
  }
}
async function endIdlePlay(d) {
  if (!idle) return;
  idle.alive = false;
  (idle.zzz || []).forEach(z => z.remove());
  document.querySelectorAll('.peek').forEach(p => p.remove());
  setState('idle'); exprTarget.surprised = 1;
  const m = mark('!'); await sleep(700); m.remove();
  await walkTo(idle.homePos.x, idle.homePos.y, 520, true);
  facingTarget = 0; setState('idle');
  scaleTarget = 1; await sleep(400);
  idle = null; mode = 'home';
  document.body.classList.add('home');
  await Y.invoke('felix:idle-done');
  await sleep(200);
  Y.invoke('felix:say', d.greet, { anim: 'wave', emotion: 'happy' });
}

// ---------------------------------------------------------------- мышь: «прозрачность» для кликов
let ignoring = true;
const pickBuf = new Uint8Array(4);
let wantPick = false;
addEventListener('mousemove', e => {
  mouse = { x: e.clientX, y: e.clientY, t: performance.now() }; wantPick = true;
  patCheck(e.clientX, e.clientY);
  if (minimized) { const hit = overUI(e.clientX, e.clientY); if (hit === ignoring) { ignoring = !hit; Y.invoke('mouse:ignore', ignoring); } }
});
function overUI(x, y) {
  const el = document.elementFromPoint(x, y);
  return el && el !== canvas && el !== fx && el !== document.body && el !== document.documentElement;
}
function updateHit() {
  if (mode !== 'home') return;
  const gl = renderer.getContext();
  const dpr = renderer.getPixelRatio();
  gl.readPixels(Math.floor(mouse.x * dpr), Math.floor((H - mouse.y) * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pickBuf);
  const hit = (pickBuf[3] > 20 && turn.visible) || overUI(mouse.x, mouse.y);
  if (hit === ignoring) { ignoring = !hit; Y.invoke('mouse:ignore', ignoring); }
}
canvas.addEventListener('click', () => { if (!ignoring && !minimized) { sound('pop', 0.3); Y.invoke('felix:clicked'); setState('listen'); } });
addEventListener('contextmenu', e => { e.preventDefault(); if (!ignoring) Y.invoke('popup', e.clientX, e.clientY); });
addEventListener('mouseleave', () => { mouse.x = -1; if (!ignoring) { ignoring = true; Y.invoke('mouse:ignore', true); } });
Y.on('mouse:sync', v => { ignoring = v; });

function layoutUI() {
  const head = worldToScreen(new THREE.Vector3(root.position.x, root.position.y + modelH, 0));
  const b = $('#bubble');
  b.style.maxWidth = Math.min(300, W - 16) + 'px';
  const bw = b.offsetWidth || Math.min(300, W - 16);
  const left = Math.max(8, Math.min(W - bw - 8, head.x - bw / 2));
  b.style.left = left + 'px';
  b.style.top = 'auto';
  b.style.bottom = Math.max(4, H - head.y + 18) + 'px';
  b.style.setProperty('--tail', Math.max(14, Math.min(bw - 32, head.x - left - 9)) + 'px');
  if (minimized) showOrb();
}

// ---------------------------------------------------------------- гардероб: аксессуары надеваются руками, наряды меняются за ширмой
let CAT = { outfits: [], accessories: [] };
const worn = {};                 // слот → надетая вещь (Mesh)
const wq = [];                   // очередь: { action: 'wear'|'off'|'outfit', id|slot }
let wact = null;                 // текущее действие
let dressPose = null;            // { slot, raise } — руки у места вещи
let outfitNow = 'mint';
const outfitById = id => CAT.outfits.find(o => o.id === id);
Y.on('wardrobe', a => { if (Array.isArray(a)) wq.push(...a); else wq.push(a); });

/** Сразу, без анимации: при запуске и когда Феликс свёрнут */
function dressInstant(w) {
  if (!vrm || !w) return;
  for (const [slot, m] of Object.entries(worn)) { m.removeFromParent(); delete worn[slot]; }
  for (const id of Object.values(w.wear || {})) {
    if (!id || !WR.ACC[id]) continue;
    const m = WR.makeAccessory(id); WR.attachAccessory(vrm, m); worn[WR.slotOf(id)] = m;
  }
  outfitNow = w.outfit || 'mint';
  WR.applyOutfit(vrm, outfitById(outfitNow));
}

function screenPoint(obj) { const v = new THREE.Vector3(); obj.getWorldPosition(v); return worldToScreen(v); }

function startAction(a) {
  const instant = minimized || mode !== 'home';
  if (a.action === 'wear') {
    const id = a.id, slot = WR.slotOf(id);
    if (!WR.ACC[id] || (worn[slot] && worn[slot].userData.accId === id)) return;
    if (worn[slot]) { wq.unshift(a); return startAction({ action: 'off', slot }); }   // сначала снять то, что на этом месте
    const m = WR.makeAccessory(id); worn[slot] = m;
    if (instant) { WR.attachAccessory(vrm, m); return; }
    wact = { kind: 'wear', mesh: m, slot, t: 0 };
    hideBubble();
  } else if (a.action === 'off') {
    const slot = a.slot || WR.slotOf(a.id), m = worn[slot];
    if (!m) return;
    delete worn[slot];
    if (instant) { m.removeFromParent(); return; }
    wact = { kind: 'off', mesh: m, slot, t: 0, side: side === 'left' ? 1 : -1 };
  } else if (a.action === 'outfit') {
    const o = outfitById(a.id);
    if (!o || a.id === outfitNow) return;
    if (instant) { WR.applyOutfit(vrm, o); outfitNow = o.id; return; }
    WR.prepareOutfit(vrm, o);                       // текстуры считаем заранее, чтобы за ширмой не было рывка
    const dir = side === 'left' ? 1 : -1;
    const screen = WR.makeScreen(); screen.position.set(dir * 0.62, 0, 0.06); root.add(screen);
    const cloth = WR.makeCloth((outfitById(outfitNow) || {}).main || '#9fd9dd'); cloth.visible = false; root.add(cloth);
    wact = { kind: 'outfit', o, t: 0, dir, screen, cloth, swapped: false, sparkled: false, walking: null };
    sound('pop', 0.35); burst(24, 'leaf', foot.x + dir * 0.62 * pxPerM, foot.y - 0.9 * pxPerM);
  }
}

function wardrobeTick(dt, t) {
  if (!vrm) return;
  if (!wact && wq.length && state !== 'phone') startAction(wq.shift());
  dressPose = null;
  if (!wact) return;
  const A = wact;
  A.t += dt;
  if (A.kind === 'wear') {
    const r = WR.wearStep(scene, vrm, A.mesh, A.t / WR.WEAR_T);
    dressPose = { slot: A.slot, raise: r.raise };
    if (r.appear && !A.appeared) { A.appeared = true; sound('pop', 0.3); const p = screenPoint(A.mesh); burst(14, 'spark', p.x, p.y); }
    if (A.t / WR.WEAR_T > 0.72 && !A.landed) { A.landed = true; exprTarget.happy = 1; const p = screenPoint(A.mesh); burst(18, 'spark', p.x, p.y); }
    if (r.done) { wact = null; setState('happy'); }
  } else if (A.kind === 'off') {
    const r = WR.offStep(scene, vrm, A.mesh, A.t / WR.OFF_T, A.side);
    dressPose = { slot: A.slot, raise: r.raise };
    if (r.toss && !A.tossed) { A.tossed = true; sound('hide', 0.3); }
    if (r.gone) { const p = screenPoint(A.mesh); burst(16, 'leaf', p.x, p.y); A.mesh.removeFromParent(); wact = null; }
  } else if (A.kind === 'outfit') {
    const k = A.t / WR.OUTFIT_T, S = WR.outfitStep(k, A.dir);
    A.screen.userData.set(S.screenOpen);
    turn.position.set(S.offX, 0, S.offZ);
    if (S.walking !== A.walking) { A.walking = S.walking; setState(S.walking ? 'walk' : 'idle'); }
    facingTarget = S.facing;
    if (S.swap && !A.swapped) { A.swapped = true; WR.applyOutfit(vrm, A.o); outfitNow = A.o.id; sound('pop', 0.3); }
    if (S.sparkle && !A.sparkled) { A.sparkled = true; burst(26, 'spark', foot.x + A.dir * 0.62 * pxPerM, foot.y - 1.95 * pxPerM); }
    if (S.cloth) { A.cloth.visible = S.cloth.scale > 0.01; A.cloth.position.set(S.cloth.x, S.cloth.y, S.cloth.z); A.cloth.rotation.set(S.cloth.rx, 0, S.cloth.rz); A.cloth.scale.setScalar(Math.max(0.001, S.cloth.scale)); }
    else A.cloth.visible = false;
    if (S.happy && !A.cheered) { A.cheered = true; setState('happy'); burst(50, 'leaf'); sound('appear', 0.35); }
    if (k >= 1) { root.remove(A.screen); root.remove(A.cloth); turn.position.set(0, 0, 0); facingTarget = 0; wact = null; if (state === 'walk') setState('idle'); }
  }
}

// погладить по голове: мышь ходит туда-сюда над головой
const patTrail = [];
let patAt = 0;
function patCheck(x, y) {
  if (!vrm || minimized || mode !== 'home' || wact) return;
  const hp = new THREE.Vector3(); B.head.getWorldPosition(hp); hp.y += 0.1;
  const h = worldToScreen(hp), r = 0.16 * pxPerM;
  if (Math.abs(x - h.x) > r || Math.abs(y - h.y) > r * 0.8) { patTrail.length = 0; return; }
  const now = performance.now();
  patTrail.push({ x, t: now });
  while (patTrail.length && now - patTrail[0].t > 1600) patTrail.shift();
  let turns = 0;
  for (let i = 2; i < patTrail.length; i++) { const a = patTrail[i - 1].x - patTrail[i - 2].x, b = patTrail[i].x - patTrail[i - 1].x; if (a * b < 0 && Math.abs(b) > 2) turns++; }
  if (turns >= 4 && now - patAt > 4000) {
    patAt = now; patTrail.length = 0;
    setState('shy'); exprTarget.happy = 1;
    burst(10, 'heart', h.x, h.y - 10);
    Y.invoke('felix:petted');
  }
}

// селфи: Феликс позирует, картинка с подписью уходит в главный процесс (сохраняется в «Изображения»)
Y.on('selfie', async () => {
  if (!vrm || minimized) return;
  setState('wave'); exprTarget.happy = 1;
  await sleep(900);
  renderer.render(scene, camera);
  const src = canvas;
  const hp = new THREE.Vector3(); B.head.getWorldPosition(hp);
  const top = worldToScreen(hp.clone().add(new THREE.Vector3(0, 0.42, 0))).y, bottom = foot.y + 6;
  const dpr = renderer.getPixelRatio(), cw = 720, ch = 900;
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(cw / 2, ch * 0.42, 40, cw / 2, ch * 0.5, ch * 0.75); g.addColorStop(0, '#16585a'); g.addColorStop(1, '#061214');
  x.fillStyle = g; x.fillRect(0, 0, cw, ch);
  const sh = (bottom - top) * dpr, sw = sh * 0.8, sx = (foot.x * dpr) - sw / 2 + (turn.position.x * pxPerM * dpr), sy = top * dpr;
  const scale = (ch - 120) / sh;
  x.drawImage(src, sx, sy, sw, sh, (cw - sw * scale) / 2, 30, sw * scale, sh * scale);
  x.fillStyle = 'rgba(255,255,255,.9)'; x.font = '600 30px "Segoe UI Variable Display", "Segoe UI"'; x.textAlign = 'center';
  x.fillText('Феликс · ' + new Date().toLocaleDateString('ru-RU'), cw / 2, ch - 40);
  Y.invoke('felix:selfie', c.toDataURL('image/png'));
  setTimeout(() => setState('happy'), 300);
});

// ---------------------------------------------------------------- цикл
const clock = new THREE.Clock();
let frameAcc = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  drawParts(dt);
  if (!vrm) return;
  if (minimized && !parts.length && visibleScale < 0.02) return;
  frameAcc += dt;
  const fps = (mode === 'home' && state === 'idle' && !playing && !walk && !wact) ? 30 : 60;
  if (frameAcc < 1 / fps - 0.002) return;
  const fdt = frameAcc; frameAcc = 0;
  if (walk) {
    const dx = walk.to.x - foot.x, dy = walk.to.y - foot.y, dist = Math.hypot(dx, dy);
    if (dist < 4) { const r = walk.res; walk = null; setState('idle'); r && r(); }
    else {
      const step = Math.min(dist, walk.speed * fdt);
      foot = { x: foot.x + dx / dist * step, y: foot.y + dy / dist * step };
      facingTarget = Math.abs(dx) > 2 ? (dx > 0 ? 1.15 : -1.15) : 0;
      placeRoot();
    }
  }
  wardrobeTick(fdt, t);
  facing += (facingTarget - facing) * (1 - Math.exp(-fdt * 8));
  if (!walk && !wact && state === 'idle' && mode === 'home') facingTarget = side === 'left' ? 0.18 : -0.18;   // чуть развёрнут к центру экрана
  spin += spinV * fdt; spinV *= Math.exp(-fdt * 3); if (spinV < 0.3) { spin += (Math.round(spin / (Math.PI * 2)) * Math.PI * 2 - spin) * (1 - Math.exp(-fdt * 6)); }
  turn.rotation.y = facing + spin;
  visibleScale += (scaleTarget - visibleScale) * (1 - Math.exp(-fdt * 7));
  turn.scale.setScalar(Math.max(0.0001, visibleScale));
  updateMouth();
  pose(t, fdt);
  applyPose(fdt);
  WR.updateAccessories(vrm, t);
  if (vrm.userData.phone) vrm.userData.phone.visible = state === 'phone';
  vrm.update(fdt);
  renderer.render(scene, camera);
  if (wantPick) { updateHit(); wantPick = false; }
  if (mode === 'home' && $('#bubble').classList.contains('show')) layoutUI();
}

// ---------------------------------------------------------------- старт
await init(c => { cfg = c; updateOrbMic(); });
resize();
try {
  const url = await Y.invoke('model');
  const v = await loadVRM(url);
  attach(v);
  try { CAT = await (await fetch('./wardrobe-catalog.json')).json(); WR.setCatalog(CAT); } catch (e) { console.error('wardrobe catalog', e); }
  // проверочные снимки: ?wear=crown,glasses&outfit=cosmos&dress=head
  const qw = Q.get('wear'), qo = Q.get('outfit');
  dressInstant(qw || qo ? { outfit: qo || 'mint', wear: Object.fromEntries((qw || '').split(',').filter(Boolean).map(id => [WR.slotOf(id), id])) } : (cfg.wardrobe || { wear: { ears: 'headphones' } }));
  if (cfg.assistant.minimized) { minimized = true; turn.visible = false; visibleScale = 0; scaleTarget = 0; showOrb(); }
  else if (PORTRAIT) { visibleScale = 1; scaleTarget = 1; setState(Q.get('pose') || 'wave'); exprTarget.happy = 1; }
  else { visibleScale = 0.01; turn.scale.setScalar(0.01); scaleTarget = 1; spinV = 14; burst(60, 'leaf'); sound('appear', 0.45); setTimeout(() => setState('wave'), 700); }
} catch (e) { console.error('VRM', e); $('#fallback').style.display = 'block'; }
window.felixReady = true;
loop();
