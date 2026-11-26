"""Звук вертикального ролика «Феликс 1.3 — живой Феликс» (9:16): реплики (Piper: Феликс — «Дмитрий», пользователь — «Денис»,
оба CC0), тайм-лайн по реальной длине фраз, своя музыка (синтез с нуля, 114 ударов в минуту — шаг танца Феликса), шумы.
python -I make_audio_live.py  →  voice_live/*.wav, live_timeline.json, live_lipsync.json, live_audio.wav"""
import json, os, subprocess, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PIPER = os.path.join(ROOT, 'stage', 'voice', 'piper', 'piper.exe')
VOICE = {'felix': os.path.join(ROOT, 'stage', 'voice', 'ru_RU-dmitri-medium.onnx'), 'user': os.path.join(ROOT, 'stage', 'voice', 'ru_RU-denis-medium.onnx')}
SR = 44100
FPS = 30
VDIR = os.path.join(HERE, 'voice_live')
os.makedirs(VDIR, exist_ok=True)

# id, кто, когда (None — после предыдущей), что звучит[, как написать на экране]
SCRIPT = [
    ('hello', 'felix', 0.9, 'Привет! Я Феликс, и я стал живее!', 'Привет! Я Феликс — и я стал живее!'),
    ('u_phone', 'user', 4.6, 'Феликс, покажи экран телефона.'),
    ('f_phone', 'felix', None, 'Теперь это живое видео: шестьдесят кадров в секунду!', 'Теперь это живое видео — 60 кадров в секунду!'),
    ('f_touch', 'felix', None, 'А мышка работает как палец: ведёшь, и телефон слушается.', 'Мышка работает как палец: ведёшь — и телефон слушается.'),
    ('f_pet', 'felix', None, 'Ммм, приятно! Причёску только не растрепи!'),
    ('f_drop', 'felix', None, 'Ух! Вот это полёт!'),
    ('u_coin', 'user', None, 'Подбрось монетку.'),
    ('f_coin', 'felix', None, 'Решка!'),
    ('u_dice', 'user', None, 'Брось кубик.'),
    ('f_dice', 'felix', None, 'Выпало шесть!'),
    ('u_weather', 'user', None, 'Какая погода?'),
    ('f_weather', 'felix', None, 'Дождь, плюс шесть. Зонт не забудь!', 'Дождь, +6°. Зонт не забудь!'),
    ('f_dance', 'felix', None, 'А когда играет музыка, я танцую!', 'А когда играет музыка — я танцую!'),
    ('f_end', 'felix', None, 'Феликс один и три. Бесплатно и с открытым кодом!', 'Феликс 1.3 — бесплатно и с открытым кодом!'),
]
GAP = {'f_phone': 0.5, 'f_touch': 2.4, 'f_pet': 4.6, 'f_drop': 5.6, 'u_coin': 1.6, 'f_coin': 2.0, 'u_dice': 1.4, 'f_dice': 2.4,
       'u_weather': 1.6, 'f_weather': 0.7, 'f_dance': 2.6, 'f_end': 4.4}


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
DUR = round(t_prev_end + 3.4, 1)
print('длительность', DUR)
for l in lines: print(f"{l['id']:10s} {l['who']:5s} {l['t']:6.2f} +{l['dur']:.2f}  {l['text']}")
T = {l['id']: l for l in lines}
end = lambda k: T[k]['t'] + T[k]['dur']

# ---------------------------------------------------------------- моменты действий (их же читает сцена — live_timeline.json)
EV = {}
EV['phone'] = [T['u_phone']['t'] - 0.3, T['f_pet']['t'] - 4.4]                 # окно «Телефон»
EV['draw'] = [end('f_phone') + 0.1, end('f_touch') + 0.3]                       # мышь рисует на экране телефона
EV['pet'] = [T['f_pet']['t'] - 3.0, end('f_pet') + 0.3]                         # гладят
EV['grab'] = T['f_drop']['t'] - 5.0                                             # схватили
EV['drop'] = T['f_drop']['t'] - 1.9                                             # отпустили
EV['land'] = EV['drop'] + 0.62                                                  # приземлился (с отскоками)
EV['coin'] = end('u_coin') + 0.15                                               # подбросил (монетка в руке ещё 0,3 с)
EV['dice'] = end('u_dice') + 0.2
EV['weather'] = end('u_weather') + 0.1
EV['dance'] = [T['f_dance']['t'] - 2.4, T['f_end']['t'] - 1.6]
EV['end'] = T['f_end']['t'] - 1.1

N = int(SR * DUR)
rng = np.random.default_rng(13)
out = np.zeros((N, 2))
t_ = lambda d: np.arange(int(SR * d)) / SR
note = lambda n: 440 * 2 ** ((n - 69) / 12)


def place(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N or i < 0: return
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


def pluck(freq, d=0.35):
    tt = t_(d); y = sum(np.sin(2 * np.pi * freq * k * tt) / k ** 1.3 for k in range(1, 6))
    return y * env_ad(len(tt), 0.002, 0.09) * 0.18


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


def thud():
    tt = t_(0.35); f = 60 + 90 * np.exp(-tt * 25)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 12) * 0.9 + np.convolve(rng.standard_normal(len(tt)) * np.exp(-tt * 60), np.ones(12) / 12, 'same') * 0.3


def pop():
    tt = t_(0.12); f = 900 + 1400 * np.exp(-tt * 60)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 40) * 0.35


def tap(f=2400):
    tt = t_(0.06); return np.sin(2 * np.pi * f * tt) * np.exp(-tt * 90) * 0.25 + rng.standard_normal(len(tt)) * np.exp(-tt * 300) * 0.05


def ting():
    tt = t_(1.2); return sum(np.sin(2 * np.pi * f * tt) * np.exp(-tt * d) * a for f, d, a in ((2637, 3.5, 0.5), (3951, 5, 0.3), (5274, 7, 0.15))) * 0.4


def clack(f=700):
    tt = t_(0.08); nz = rng.standard_normal(len(tt))
    return (np.sin(2 * np.pi * f * tt) * 0.5 + np.convolve(nz, np.ones(4) / 4, 'same') * 0.6) * np.exp(-tt * 70) * 0.6


def whoosh(d=0.5):
    tt = t_(d); nz = rng.standard_normal(len(tt)); k = np.sin(np.pi * tt / d) ** 2
    return np.convolve(nz, np.ones(25) / 25, 'same') * k * 0.5


def rain(d):
    tt = t_(d); nz = rng.standard_normal(len(tt))
    hp = nz - np.convolve(nz, np.ones(9) / 9, 'same')
    drops = np.zeros(len(tt))
    for _ in range(int(d * 40)):
        i = rng.integers(0, len(tt) - 800); drops[i:i + 800] += np.sin(2 * np.pi * (1800 + rng.random() * 2500) * t_(800 / SR)) * np.exp(-t_(800 / SR) * 160) * 0.3
    return (hp * 0.16 + drops) * np.minimum(1, tt / 0.6) * np.minimum(1, (d - tt) / 0.8)


def sparkle():
    return sum(bell(note(n), 0.9, 5) * 0.45 for n in (84, 88, 91, 96))


def chime():
    return sum(bell(note(n), 1.2, 4) * 0.5 for n in (79, 83, 86)) + bell(note(91), 1.2, 4) * 0.3


# ---------------------------------------------------------------- музыка: ми мажор, 114 BPM (шаг танца Феликса — 1,9 удара в секунду)
BPM = 114; BEAT = 60 / BPM
prog = [(52, [64, 68, 71]), (49, [61, 64, 68]), (45, [57, 61, 64]), (47, [59, 63, 66])]   # E C#m A B
end_t = EV['end']
place(pad([note(64), note(68), note(71)], 4.4), 0, 0.8)
for i, n in enumerate([76, 80, 83, 88, 92]):
    place(bell(note(n), 1.5, 3), 0.15 + i * 0.3, 0.6, pan=-0.4 + i * 0.2)
place(riser(2.4), 2.1, 0.55)
start = T['u_phone']['t'] - 0.3
place(impact(), start, 0.8); place(sparkle(), start, 0.5)
b0 = int(np.ceil(start / BEAT)); b = b0
while b * BEAT < end_t:
    tb = b * BEAT
    soft = EV['pet'][0] <= tb < EV['pet'][1] or T['u_weather']['t'] <= tb < T['f_dance']['t'] - 2.4     # гладят и дождь — тише
    big = EV['dance'][0] <= tb                                                                      # танец — во весь голос
    g = 0.55 if soft else 1.0 if big else 0.8
    if b % 4 in (0, 2) and not soft: place(kick(), tb, 0.95 * g)
    if big and b % 4 in (1, 3): place(kick(), tb + BEAT / 2, 0.5 * g)
    if b % 4 in (1, 3): place(snap(), tb, 0.5 * g, pan=0.05)
    for h in range(2): place(hat(), tb + h * BEAT / 2, (0.42 if h else 0.28) * g, pan=0.25)
    if b % 8 == 7: place(hat(True), tb + BEAT / 2, 0.3 * g, pan=-0.2)
    root, chord = prog[((b - b0) // 4) % 4]
    place(sub(note(root), BEAT * 0.9), tb, 0.85 * g)
    for s in range(2):
        place(keys(note(chord[(b * 2 + s) % 3] + 12)), tb + s * BEAT / 2, 0.7 * g, pan=-0.3 if s else 0.3)
    if big:
        for s in range(4): place(pluck(note(chord[(b + s) % 3] + 24)), tb + s * BEAT / 4, 0.55, pan=0.4 if s % 2 else -0.4)
    if (b - b0) % 4 == 0: place(pad([note(c) for c in chord], BEAT * 4.2), tb, 0.3 * g)
    b += 1

# шумы
fx = []
for k in range(14): fx.append(('tapl', EV['draw'][0] + 0.2 + k * 0.42))               # палец на экране телефона
for k in range(10): fx.append(('tap', EV['pet'][0] + 0.4 + k * 0.17))                # гладят
fx += [('chime', EV['pet'][0] + 1.4), ('sparkle', EV['pet'][0] + 2.0)]
fx += [('pop', EV['grab']), ('whoosh', EV['grab'] + 0.8), ('whoosh', EV['grab'] + 1.9), ('whoosh', EV['drop'] - 0.4), ('whoosh6', EV['drop']),
       ('thud', EV['land']), ('pop', EV['land'] + 0.18), ('pop', EV['land'] + 0.34), ('sparkle', EV['land'] + 0.4)]
fx += [('whoosh', EV['coin'] + 0.3), ('ting', EV['coin'] + 0.32), ('pop', EV['coin'] + 1.3), ('sparkle', EV['coin'] + 1.35)]
fx += [('whoosh', EV['dice'] + 0.3), ('clack', EV['dice'] + 0.85), ('clack2', EV['dice'] + 1.13), ('clack3', EV['dice'] + 1.29), ('sparkle', EV['dice'] + 1.35)]
for kind, at in fx:
    sig = {'pop': pop, 'whoosh': whoosh, 'sparkle': sparkle, 'chime': chime, 'tap': tap, 'thud': thud, 'ting': ting,
           'tapl': lambda: tap(1500), 'whoosh6': lambda: whoosh(0.6), 'clack': clack, 'clack2': lambda: clack(820), 'clack3': lambda: clack(950) * 0.6}[kind]()
    place(sig, at, 0.7)
place(rain(T['f_dance']['t'] - 2.6 - EV['weather']), EV['weather'], 0.9)
place(riser(2.2, 300, 7000), end_t - 2.2, 0.8)
place(impact(), end_t, 1.0)
place(pad([note(64), note(71), note(76), note(80)], DUR - end_t), end_t, 1.0)
for i, n in enumerate([88, 92, 95, 100]):
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
with wave.open(os.path.join(HERE, 'live_audio.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype('<i2').tobytes())

hop = SR // FPS
env = [float(np.sqrt(np.mean(vtrack[i * hop:(i + 1) * hop] ** 2))) for i in range(int(DUR * FPS))]
m = max(env) or 1
json.dump([round(e / m, 3) for e in env], open(os.path.join(HERE, 'live_lipsync.json'), 'w'))
json.dump({'dur': DUR, 'fps': FPS, 'beat': BEAT, 'ev': EV, 'lines': [{k: v for k, v in l.items() if k != 'audio'} for l in lines]},
          open(os.path.join(HERE, 'live_timeline.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok live_audio.wav', DUR, 's')
