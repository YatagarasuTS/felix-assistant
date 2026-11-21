"""Звук вертикального ролика «Феликс управляет телефоном» (9:16): реплики (Piper: Феликс — «Дмитрий»,
пользователь — «Денис», оба CC0), тайм-лайн по реальной длине фраз, своя музыка (синтез с нуля), шумы интерфейса.
python -I make_audio_phone.py  →  voice_phone/*.wav, phone_timeline.json, phone_lipsync.json, phone_audio.wav"""
import json, os, subprocess, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PIPER = os.path.join(ROOT, 'stage', 'voice', 'piper', 'piper.exe')
VOICE = {'felix': os.path.join(ROOT, 'stage', 'voice', 'ru_RU-dmitri-medium.onnx'), 'user': os.path.join(ROOT, 'stage', 'voice', 'ru_RU-denis-medium.onnx')}
SR = 44100
FPS = 30
VDIR = os.path.join(HERE, 'voice_phone')
os.makedirs(VDIR, exist_ok=True)

# id, кто, когда (None — после предыдущей), что звучит[, как написать на экране]
SCRIPT = [
    ('hello', 'felix', 1.0, 'Привет! Теперь я управляю твоим телефоном.'),
    ('u_food', 'user', 5.6, 'Феликс, закажи пиццу.'),
    ('f_food', 'felix', None, 'Открыл доставку и ищу пиццу. Выбирай!'),
    ('u_taxi', 'user', None, 'Вызови такси до работы.'),
    ('f_taxi', 'felix', None, 'Маршрут до работы готов. Осталось нажать «Заказать».'),
    ('u_screen', 'user', None, 'Покажи экран телефона.'),
    ('f_screen', 'felix', None, 'Вот он! Кликай мышкой — как пальцем.'),
    ('f_choose', 'felix', None, 'Доставку, такси и карты выбираешь ты: любое приложение.', 'Доставку, такси и карты выбираешь ты — любое приложение.'),
    ('f_open', 'felix', None, 'А ещё у меня теперь открытый код!'),
    ('f_end', 'felix', None, 'Скажи «Феликс» — и я помогу!'),
]
GAP = {'f_food': 0.45, 'u_taxi': 2.6, 'f_taxi': 0.5, 'u_screen': 2.4, 'f_screen': 0.9, 'f_choose': 3.0, 'f_open': 2.4, 'f_end': 2.2}


def synth(key, who, text):
    out = os.path.join(VDIR, key + '.wav')
    p = subprocess.run([PIPER, '--model', VOICE[who], '--output_file', out, '--sentence_silence', '0.12'],
                       input=text.encode('utf-8'), capture_output=True, cwd=os.path.dirname(PIPER))
    if p.returncode != 0 or not os.path.exists(out):
        raise SystemExit('piper: ' + p.stderr.decode('utf-8', 'replace')[-300:])
    with wave.open(out, 'rb') as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768
    rate = (1.04 if who == 'felix' else 1.0) * sr / SR          # Феликс чуть выше и бодрее, как в программе
    v = np.interp(np.arange(0, len(x) - 1, rate), np.arange(len(x)), x)
    nz = np.nonzero(np.abs(v) > 0.01)[0]
    if len(nz): v = v[max(0, nz[0] - 600): nz[-1] + 1600]
    return v


lines, t_prev_end = [], 0.0
for key, who, t, text, *shown in SCRIPT:
    v = synth(key, who, text)
    dur = len(v) / SR
    if t is None: t = t_prev_end + GAP.get(key, 0.4)
    lines.append({'id': key, 'who': who, 't': round(t, 3), 'dur': round(dur, 3), 'text': shown[0] if shown else text, 'audio': v})
    t_prev_end = t + dur
DUR = round(t_prev_end + 3.6, 1)
print('длительность', DUR)
for l in lines: print(f"{l['id']:10s} {l['who']:5s} {l['t']:6.2f} +{l['dur']:.2f}  {l['text']}")

N = int(SR * DUR)
rng = np.random.default_rng(21)
out = np.zeros((N, 2))
t_ = lambda d: np.arange(int(SR * d)) / SR
note = lambda n: 440 * 2 ** ((n - 69) / 12)


def place(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N: return
    if sig.ndim == 1: sig = np.stack([sig * (1 - max(0, pan)), sig * (1 + min(0, pan))], 1)
    j = min(N, i + len(sig)); out[i:j] += sig[: j - i] * gain


def env_ad(n, a, d):
    tt = np.arange(n) / SR
    return np.minimum(1, tt / max(a, 1e-4)) * np.exp(-tt / d)


def fft_conv(x, ir):
    n = len(x) + len(ir); nfft = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[:n]


def reverb_st(x, wet=0.3, length=2.2, decay=3.2):
    n = int(SR * length); res = []
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * decay); ir[:200] *= np.linspace(0, 1, 200)
        res.append(x[:, ch] * (1 - wet) + fft_conv(x[:, ch], ir)[: len(x)] * 0.02 * wet)
    return np.stack(res, 1)


def kick():
    tt = t_(0.45); f = 48 + 120 * np.exp(-tt * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7) + rng.standard_normal(len(tt)) * np.exp(-tt * 220) * 0.12


def snap():
    tt = t_(0.25); nz = rng.standard_normal(len(tt))
    return np.convolve(nz * np.exp(-tt * 38), np.ones(5) / 5, 'same') * 0.5 + np.sin(2 * np.pi * 190 * tt) * np.exp(-tt * 30) * 0.25


def hat(open_=False):
    tt = t_(0.22 if open_ else 0.05); nz = rng.standard_normal(len(tt))
    return (nz - np.convolve(nz, np.ones(3) / 3, 'same')) * np.exp(-tt * (13 if open_ else 75)) * 0.3


def sub(freq, d):
    tt = t_(d); s = np.sin(2 * np.pi * freq * tt) + 0.2 * np.sin(2 * np.pi * 2 * freq * tt)
    return s * np.minimum(1, tt / 0.01) * np.minimum(1, (d - tt) / 0.05) * 0.5


def keys(freq, d=0.5):
    tt = t_(d)
    y = np.sin(2 * np.pi * freq * tt) + 0.35 * np.sin(2 * np.pi * 2 * freq * tt) + 0.12 * np.sin(2 * np.pi * 3 * freq * tt)
    return y * env_ad(len(tt), 0.004, 0.22) * 0.2


def pad(freqs, d):
    tt = t_(d); y = np.zeros_like(tt)
    for f in freqs:
        for dt in (-0.0035, 0, 0.0035):
            y += np.sin(2 * np.pi * f * (1 + dt) * tt + rng.random() * 6) + 0.25 * np.sin(2 * np.pi * 2 * f * (1 + dt) * tt)
    return y / (len(freqs) * 3) * np.minimum(1, tt / 0.7) * np.minimum(1, (d - tt) / 0.9) * 0.32


def bell(f, d=1.6, decay=2.6):
    tt = t_(d)
    y = sum(a * np.sin(2 * np.pi * f * k * tt) * np.exp(-tt * decay * (1 + k * 0.3)) for k, a in ((1, 1), (2.01, 0.42), (2.76, 0.28), (5.4, 0.12)))
    return y * np.minimum(1, tt / 0.003) * 0.24


def riser(d, f0=250, f1=5000):
    tt = t_(d); nz = rng.standard_normal(len(tt)); k = (tt / d) ** 2
    lo = np.convolve(nz, np.ones(40) / 40, 'same')
    return ((lo * (1 - k) + nz * k) * 0.22 + np.sin(2 * np.pi * np.cumsum(f0 + (f1 - f0) * k) / SR) * 0.13) * k * 0.6


def impact():
    tt = t_(2.5); f = 32 + 70 * np.exp(-tt * 8)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 1.8) + np.convolve(rng.standard_normal(len(tt)) * np.exp(-tt * 3) * 0.3, np.ones(20) / 20, 'same')) * 0.85


def pop():
    tt = t_(0.12); f = 900 + 1400 * np.exp(-tt * 60)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 40) * 0.35


def tap():
    tt = t_(0.06); return np.sin(2 * np.pi * 2400 * tt) * np.exp(-tt * 90) * 0.25 + rng.standard_normal(len(tt)) * np.exp(-tt * 300) * 0.05


def whoosh(d=0.5):
    tt = t_(d); nz = rng.standard_normal(len(tt)); k = np.sin(np.pi * tt / d) ** 2
    return np.convolve(nz, np.ones(25) / 25, 'same') * k * 0.5


def sparkle():
    return sum(bell(note(n), 0.9, 5) * 0.45 for n in (84, 88, 91, 96))


def chime():
    return sum(bell(note(n), 1.2, 4) * 0.5 for n in (79, 83, 86)) + bell(note(91), 1.2, 4) * 0.3


# ---------------------------------------------------------------- музыка: ре мажор, 116 BPM
BPM = 116; BEAT = 60 / BPM
prog = [(50, [62, 66, 69]), (47, [59, 62, 66]), (43, [55, 59, 62]), (45, [57, 61, 64])]   # D Bm G A
T = {l['id']: l for l in lines}
end_t = T['f_end']['t'] - 0.9

place(pad([note(62), note(66), note(69)], 4.2), 0, 0.8)
for i, n in enumerate([74, 78, 81, 86, 90]):
    place(bell(note(n), 1.5, 3), 0.15 + i * 0.3, 0.6, pan=-0.4 + i * 0.2)
place(riser(2.6), 1.9, 0.6)
place(impact(), 4.5, 0.85)
place(sparkle(), 4.5, 0.55)

b0 = int(4.5 / BEAT) + 1
b = b0
while b * BEAT < end_t:
    tb = b * BEAT
    soft = T['f_choose']['t'] - 0.2 <= tb < T['f_open']['t'] - 0.3      # выбор приложений — потише, без бочки
    g = 0.6 if soft else 0.85
    if b % 4 in (0, 2) and not soft: place(kick(), tb, 0.9 * g)
    if b % 4 in (1, 3): place(snap(), tb, 0.45 * g, pan=0.05)
    for h in range(2): place(hat(), tb + h * BEAT / 2, (0.42 if h else 0.28) * g, pan=0.25)
    if b % 8 == 7: place(hat(True), tb + BEAT / 2, 0.3 * g, pan=-0.2)
    root, chord = prog[((b - b0) // 4) % 4]
    place(sub(note(root), BEAT * 0.9), tb, 0.8 * g)
    for s in range(2):
        place(keys(note(chord[(b * 2 + s) % 3] + 12)), tb + s * BEAT / 2, 0.75 * g, pan=-0.3 if s else 0.3)
    if (b - b0) % 4 == 0: place(pad([note(c) for c in chord], BEAT * 4.2), tb, 0.3 * g)
    b += 1

# шумы интерфейса: открытие приложения, печать в поиске, маршрут, клики мышью, смена сцен
fx = [('whoosh', T['f_food']['t'] - 0.35), ('pop', T['f_food']['t'] - 0.1), ('chime', T['f_food']['t'] + 1.4),
      ('whoosh', T['u_taxi']['t'] - 0.6), ('pop', T['f_taxi']['t'] - 0.1), ('sparkle', T['f_taxi']['t'] + 0.9),
      ('whoosh', T['f_screen']['t'] - 0.45), ('pop', T['f_screen']['t'] - 0.1),
      ('whoosh', T['f_choose']['t'] - 0.5), ('pop', T['f_choose']['t'] + 1.2),
      ('whoosh', T['f_open']['t'] - 0.5), ('sparkle', T['f_open']['t'] + 0.2)]
for i in range(6): fx.append(('tap', T['f_food']['t'] + 0.35 + i * 0.11))                 # «пицца» печатается в поиске
for k in (1.6, 2.9): fx.append(('tap', T['f_screen']['t'] + k))                              # клики мышью по экрану телефона
for kind, at in fx:
    place({'pop': pop, 'whoosh': whoosh, 'sparkle': sparkle, 'chime': chime, 'tap': tap}[kind](), at, 0.7)
place(riser(2.2, 300, 7000), end_t - 2.2, 0.8)
place(impact(), end_t, 1.0)
place(pad([note(62), note(69), note(74), note(78)], DUR - end_t), end_t, 1.0)
for i, n in enumerate([86, 90, 93, 98]):
    place(bell(note(n), 2.4, 1.6), end_t + 0.15 + i * 0.3, 0.55)

# голоса: музыка приглушается под репликами
vtrack = np.zeros(N)
duck = np.ones(N)
for l in lines:
    i0 = int(l['t'] * SR); i1 = min(N, i0 + len(l['audio']))
    a, bnd = max(0, i0 - 5000), min(N, i1 + 9000)
    duck[a:bnd] = np.minimum(duck[a:bnd], 0.42)
duck = np.convolve(duck, np.ones(2205) / 2205, 'same')
out *= duck[:, None]
for l in lines:
    v = l['audio']
    place(np.stack([v, v], 1) * (1.55 if l['who'] == 'felix' else 1.35), l['t'], 1.0)
    if l['who'] == 'felix':
        i0 = int(l['t'] * SR); j = min(N, i0 + len(v)); vtrack[i0:j] += v[: j - i0]

mix = reverb_st(out, 0.18, 2.0, 3.4)
mix = np.tanh(mix * 1.25); mix /= np.max(np.abs(mix)) + 1e-9; mix *= 0.92
fade = int(SR * 1.6); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
with wave.open(os.path.join(HERE, 'phone_audio.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype('<i2').tobytes())

hop = SR // FPS
env = [float(np.sqrt(np.mean(vtrack[i * hop:(i + 1) * hop] ** 2))) for i in range(int(DUR * FPS))]
m = max(env) or 1
json.dump([round(e / m, 3) for e in env], open(os.path.join(HERE, 'phone_lipsync.json'), 'w'))
json.dump({'dur': DUR, 'fps': FPS, 'lines': [{k: v for k, v in l.items() if k != 'audio'} for l in lines]},
          open(os.path.join(HERE, 'phone_timeline.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok phone_audio.wav', DUR, 's')
