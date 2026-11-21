"""Звук рекламного ролика «Феликса»: реплики (Piper: Феликс — «Дмитрий», пользователь — «Денис», оба CC0),
тайм-лайн по реальной длине фраз, оригинальная музыка (синтез с нуля), шумы интерфейса, сведение.
python -I make_audio.py  →  voice/*.wav, timeline.json, lipsync.json, audio.wav"""
import json, os, subprocess, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PIPER = os.path.join(ROOT, 'stage', 'voice', 'piper', 'piper.exe')
VOICE = {'felix': os.path.join(ROOT, 'stage', 'voice', 'ru_RU-dmitri-medium.onnx'), 'user': os.path.join(ROOT, 'stage', 'voice', 'ru_RU-denis-medium.onnx')}
SR = 44100
FPS = 30

# сцена → реплики; t — когда начинается реплика (секунды от начала ролика), для фраз пользователя — подпись внизу
SCRIPT = [
    ('hello', 'felix', 1.0, 'Привет! Я Феликс.'),
    ('u_dl', 'user', 6.4, 'Феликс, открой загрузки.'),
    ('f_dl', 'felix', None, 'Открываю загрузки.'),
    ('u_timer', 'user', 11.8, 'Поставь таймер на пять минут.'),
    ('f_timer', 'felix', None, 'Поставил таймер на пять минут.'),
    ('u_weather', 'user', 17.2, 'Какая погода завтра?'),
    ('f_weather', 'felix', None, 'Завтра плюс четыре и небольшой дождь. Возьми зонт!'),
    ('u_music', 'user', 23.6, 'Сделай музыку погромче.'),
    ('f_music', 'felix', None, 'Громкость семьдесят процентов!'),
    ('u_sky', 'user', 28.6, 'Почему небо голубое?'),
    ('f_sky1', 'felix', None, 'Сейчас узнаю.'),
    ('f_sky2', 'felix', None, 'Синий свет рассеивается в воздухе сильнее красного. Поэтому небо голубое.'),
    # «Феликс Link»: команда с телефона, ответ Феликса — и будильник уже на телефоне
    ('f_link', 'felix', None, 'А ещё у меня есть приложение для телефона.'),
    ('u_phone', 'user', None, 'Поставь будильник на семь утра.'),
    ('f_phone', 'felix', None, 'Поставил будильник на телефоне на семь ноль-ноль.', 'Поставил будильник на телефоне на 7:00.'),
    ('f_offline', 'felix', None, 'А ещё я понимаю речь без интернета.'),
    ('f_end', 'felix', None, 'Скажи «Феликс» — и я помогу!'),
]
GAP = {'f_dl': 0.45, 'f_timer': 0.45, 'f_weather': 0.5, 'f_music': 0.45, 'f_sky1': 0.45, 'f_sky2': 1.9,
       'f_link': 1.5, 'u_phone': 0.8, 'f_phone': 0.5, 'f_offline': 1.5, 'f_end': 1.6}


def synth(key, who, text):
    out = os.path.join(HERE, 'voice', key + '.wav')
    p = subprocess.run([PIPER, '--model', VOICE[who], '--output_file', out, '--sentence_silence', '0.12'],
                       input=text.encode('utf-8'), capture_output=True, cwd=os.path.dirname(PIPER))
    if p.returncode != 0 or not os.path.exists(out):
        raise SystemExit('piper: ' + p.stderr.decode('utf-8', 'replace')[-300:])
    with wave.open(out, 'rb') as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(float) / 32768
    # Феликс чуть выше и бодрее (как в программе: тон 1.04), пользователь — как есть
    rate = (1.04 if who == 'felix' else 1.0) * sr / SR
    idx = np.arange(0, len(x) - 1, rate)
    v = np.interp(idx, np.arange(len(x)), x)
    nz = np.nonzero(np.abs(v) > 0.01)[0]                    # обрезать тишину по краям
    if len(nz): v = v[max(0, nz[0] - 600): nz[-1] + 1600]
    return v


lines, t_prev_end = [], 0.0
for key, who, t, text, *shown in SCRIPT:
    v = synth(key, who, text)
    dur = len(v) / SR
    if t is None: t = t_prev_end + GAP.get(key, 0.4)
    # text — что звучит; show — как написать на экране (цифрами), если отличается
    lines.append({'id': key, 'who': who, 't': round(t, 3), 'dur': round(dur, 3), 'text': shown[0] if shown else text, 'audio': v})
    t_prev_end = t + dur
DUR = round(t_prev_end + 3.4, 1)
print('длительность', DUR)
for l in lines: print(f"{l['id']:10s} {l['who']:5s} {l['t']:6.2f} +{l['dur']:.2f}  {l['text']}")

N = int(SR * DUR)
rng = np.random.default_rng(11)
out = np.zeros((N, 2))
t_ = lambda d: np.arange(int(SR * d)) / SR


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


note = lambda n: 440 * 2 ** ((n - 69) / 12)


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
    """мягкие «клавиши»: синус + чуть обертонов, быстрая атака"""
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


def whoosh(d=0.5):
    tt = t_(d); nz = rng.standard_normal(len(tt)); k = np.sin(np.pi * tt / d) ** 2
    return np.convolve(nz, np.ones(25) / 25, 'same') * k * 0.5


def sparkle():
    return sum(bell(note(n), 0.9, 5) * 0.45 for n in (84, 88, 91, 96))


# ---------------------------------------------------------------- музыка: ре мажор, 112 BPM — светло и бодро
BPM = 112; BEAT = 60 / BPM
prog = [(50, [62, 66, 69]), (47, [59, 62, 66]), (43, [55, 59, 62]), (45, [57, 61, 64])]   # D  Bm  G  A
T = {l['id']: l for l in lines}
end_t = T['f_end']['t'] - 0.9

# вступление: колокольчики-клевер, подъём, удар на заголовке
place(pad([note(62), note(66), note(69)], 3.8), 0, 0.8)
for i, n in enumerate([74, 78, 81, 86, 90]):
    place(bell(note(n), 1.5, 3), 0.15 + i * 0.32, 0.6, pan=-0.4 + i * 0.2)
place(riser(3.0), 0.6, 0.7)
place(impact(), 3.6, 0.9)
place(sparkle(), 3.6, 0.6)

# основной ритм с 5.4 с до финала
b0 = int(5.4 / BEAT) + 1
music_end = end_t
b = b0
while b * BEAT < music_end:
    tb = b * BEAT
    loud = T['u_music']['t'] + 2.0 <= tb < T['u_sky']['t']            # «погромче» — музыка действительно громче
    soft = T['f_sky1']['t'] <= tb < T['f_sky2']['t'] + T['f_sky2']['dur']   # нейросеть думает — тише
    g = 1.25 if loud else 0.55 if soft else 0.85
    if b % 4 in (0, 2) and not soft: place(kick(), tb, 0.9 * g)
    if b % 4 in (1, 3): place(snap(), tb, 0.45 * g, pan=0.05)
    for h in range(2): place(hat(), tb + h * BEAT / 2, (0.42 if h else 0.28) * g, pan=0.25)
    if b % 8 == 7: place(hat(True), tb + BEAT / 2, 0.3 * g, pan=-0.2)
    bar = (b - b0) // 4
    root, chord = prog[bar % 4]
    place(sub(note(root - 12 + 12), BEAT * 0.9), tb, 0.8 * g)
    for s in range(2):
        place(keys(note(chord[(b * 2 + s) % 3] + 12)), tb + s * BEAT / 2, 0.75 * g, pan=-0.3 if s else 0.3)
    if (b - b0) % 4 == 0: place(pad([note(c) for c in chord], BEAT * 4.2), tb, 0.3 * g)
    b += 1

# шумы интерфейса под действия на экране
fx = [('pop', T['f_dl']['t'] - 0.15), ('whoosh', T['f_dl']['t'] + 0.1), ('pop', T['f_timer']['t'] - 0.1), ('pop', T['f_weather']['t'] - 0.1),
      ('pop', T['f_music']['t'] - 0.1), ('pop', T['f_sky1']['t'] - 0.1), ('sparkle', T['f_sky2']['t'] - 0.2),
      ('whoosh', T['f_link']['t'] - 0.45), ('pop', T['u_phone']['t'] - 0.45), ('pop', T['f_phone']['t'] - 0.1), ('chime', T['f_phone']['t'] + 0.65),
      ('whoosh', T['f_offline']['t'] - 0.4)]
chime = lambda: sum(bell(note(n), 1.2, 4) * 0.5 for n in (79, 83, 86)) + bell(note(91), 1.2, 4) * 0.3   # «будильник поставлен»
for kind, at in fx:
    place({'pop': pop, 'whoosh': whoosh, 'sparkle': sparkle, 'chime': chime}[kind](), at, 0.7)
# финал
place(riser(2.2, 300, 7000), end_t - 2.2, 0.8)
place(impact(), end_t, 1.0)
place(pad([note(62), note(69), note(74), note(78)], DUR - end_t), end_t, 1.0)
for i, n in enumerate([86, 90, 93, 98]):
    place(bell(note(n), 2.4, 1.6), end_t + 0.15 + i * 0.3, 0.55)

# ---------------------------------------------------------------- голоса: музыка приглушается под репликами
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
    place(np.stack([v, v], 1) * (1.55 if l['who'] == 'felix' else 1.35), l['t'], 1.0, )
    if l['who'] == 'felix':
        i0 = int(l['t'] * SR); j = min(N, i0 + len(v)); vtrack[i0:j] += v[: j - i0]

mix = reverb_st(out, 0.18, 2.0, 3.4)
mix = np.tanh(mix * 1.25); mix /= np.max(np.abs(mix)) + 1e-9; mix *= 0.92
fade = int(SR * 1.6); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
with wave.open(os.path.join(HERE, 'audio.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype('<i2').tobytes())

hop = SR // FPS
env = [float(np.sqrt(np.mean(vtrack[i * hop:(i + 1) * hop] ** 2))) for i in range(int(DUR * FPS))]
m = max(env) or 1
json.dump([round(e / m, 3) for e in env], open(os.path.join(HERE, 'lipsync.json'), 'w'))
json.dump({'dur': DUR, 'fps': FPS, 'lines': [{k: v for k, v in l.items() if k != 'audio'} for l in lines]},
          open(os.path.join(HERE, 'timeline.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok audio.wav', DUR, 's')
