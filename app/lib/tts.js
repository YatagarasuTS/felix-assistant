// Голос Феликса. Варианты (config.assistant.voice):
//   'piper'             — нейросетевой офлайн-голос Piper «Дмитрий» (CC0, по умолчанию)
//   'piper:<путь.onnx>' — любая другая модель Piper, в том числе свой обученный голос
//                         (кладётся в %APPDATA%\Felix\voices вместе с файлом .onnx.json)
//   'http'              — свой ИИ-голос через HTTP (XTTS, Silero, Coqui, облачный API): config.assistant.voiceHttp
//   'sapi'              — голос Windows;  'off' — только субтитры
// Если выбранный голос не сработал, Феликс говорит запасным Piper «Дмитрий», а затем — голосом Windows.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const NAMES = { 'ru_RU-dmitri-medium': 'Дмитрий (по умолчанию)', 'ru_RU-denis-medium': 'Денис — ниже и спокойнее' };

class Tts {
  constructor(home, dataDir, core) {
    this.home = home;
    this.piperExe = path.join(home, 'voice', 'piper', 'piper.exe');
    this.model = path.join(home, 'voice', 'ru_RU-dmitri-medium.onnx');
    this.custom = path.join(dataDir, 'voices');
    this.core = core;
    this.dir = path.join(os.tmpdir(), 'felix-voice');
    fs.mkdirSync(this.dir, { recursive: true });
    this.p = null;
    this.n = 0;
    this.cleanup();
  }

  cleanup() {
    try { for (const f of fs.readdirSync(this.dir)) if (/\.(wav|mp3|ogg)$/i.test(f)) fs.unlinkSync(path.join(this.dir, f)); } catch { }
  }

  customDir() { fs.mkdirSync(this.custom, { recursive: true }); return this.custom; }
  available(model = this.model) { return fs.existsSync(this.piperExe) && fs.existsSync(model); }
  /** звучит «как есть» — без поднятия тона ускорением */
  natural(voice) { return voice === 'http'; }

  /** Список голосов для настроек */
  voices() {
    const list = [];
    for (const d of [path.join(this.home, 'voice'), this.custom]) {
      let files = [];
      try { files = fs.readdirSync(d).filter(f => /\.onnx$/i.test(f)); } catch { }
      for (const f of files) {
        const full = path.join(d, f);
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(full + '.json', 'utf8')); } catch { continue; }   // без .onnx.json Piper не работает
        const base = f.replace(/\.onnx$/i, '');
        const isDefault = path.resolve(full) === path.resolve(this.model);
        const lang = (meta.language && (meta.language.name_native || meta.language.code)) || '';
        const speakers = meta.speaker_id_map && Object.keys(meta.speaker_id_map).length > 1
          ? Object.entries(meta.speaker_id_map).map(([name, id]) => ({ id, name })) : [];
        list.push({ id: isDefault ? 'piper' : 'piper:' + full, name: NAMES[base] || `${base}${lang ? ' — ' + lang : ''}${d === this.custom ? ' · свой' : ''}`, kind: 'piper', speakers });
      }
    }
    list.sort((a, b) => (a.id === 'piper' ? -1 : b.id === 'piper' ? 1 : 0));
    list.push({ id: 'http', name: 'Свой ИИ-голос (HTTP-сервер или API)', kind: 'http', speakers: [] });
    list.push({ id: 'sapi', name: 'Голос Windows', kind: 'sapi', speakers: [] });
    list.push({ id: 'off', name: 'Без голоса (только субтитры)', kind: 'off', speakers: [] });
    return list;
  }

  _proc(model, ls, speaker) {
    const key = `${model}|${ls}|${speaker}`;
    if (this.p && this.p.key === key) return this.p;
    if (this.p) { try { this.p.proc.stdin.end(); } catch { } }
    const args = ['--model', model, '--json-input', '--sentence_silence', '0.15', '--length_scale', ls.toFixed(2)];
    if (speaker != null && speaker !== '' && +speaker > 0) args.push('--speaker', String(+speaker));
    const proc = spawn(this.piperExe, args, { cwd: path.dirname(this.piperExe), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const st = { proc, queue: [], key };
    let buf = '';
    proc.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        const job = st.queue.shift();
        if (job) { clearTimeout(job.t); job.res(line); }
      }
    });
    proc.on('exit', () => {
      if (this.p === st) this.p = null;
      for (const j of st.queue) { clearTimeout(j.t); j.rej(new Error('piper exited')); }
      st.queue = [];
    });
    proc.stdin.on('error', () => { });
    this.p = st;
    return st;
  }

  async _piper(text, file, model, pitch, speaker) {
    const st = this._proc(model, Math.max(0.7, Math.min(1.5, pitch)), speaker);
    return await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('piper timeout')), 20000);
      st.queue.push({ res, rej, t });
      st.proc.stdin.write(JSON.stringify({ text, output_file: file }) + '\n');
    });
  }

  // свой ИИ-голос: GET/POST на адрес пользователя, ответ — звук (wav/mp3/ogg) или JSON с полем audio/wav (base64)
  async _http(text, base, h = {}) {
    if (!h.url) throw new Error('не задан адрес');
    const enc = encodeURIComponent(text);
    const jsonText = JSON.stringify(text).slice(1, -1);
    const url = h.url.replace(/\{text\}/g, enc);
    const headers = {};
    for (const line of String(h.headers || '').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    const body = (h.body || '').trim() ? h.body.replace(/\{text\}/g, jsonText) : null;
    if (body && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = body.startsWith('{') ? 'application/json' : 'text/plain; charset=utf-8';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(url, { method: body ? 'POST' : 'GET', headers, body, signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let buf = Buffer.from(await r.arrayBuffer());
      if (/json/i.test(r.headers.get('content-type') || '') || buf[0] === 0x7b) {
        const j = JSON.parse(buf.toString('utf8'));
        const b64 = j.audio || j.wav || j.audio_base64 || j.data || (j.result && j.result.audio);
        if (!b64) throw new Error('в JSON нет поля audio');
        buf = Buffer.from(String(b64).replace(/^data:[^,]+,/, ''), 'base64');
      }
      const ext = buf.slice(0, 4).toString('ascii') === 'RIFF' ? 'wav' : buf.slice(0, 4).toString('ascii') === 'OggS' ? 'ogg'
        : (buf.slice(0, 3).toString('ascii') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) ? 'mp3' : null;
      if (!ext) throw new Error('ответ не похож на звук');
      const file = base + '.' + ext;
      fs.writeFileSync(file, buf);
      return file;
    } finally { clearTimeout(timer); }
  }

  /** Путь к звуку с фразой. pitch > 1 — голос выше (для Piper: синтезируем медленнее, проигрываем быстрее). */
  async synth(text, pitch = 1.0, voice = 'piper', opts = {}) {
    text = String(text || '').replace(/Claude/g, 'Клод').replace(/\bFelix\b/g, 'Феликс').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const base = path.join(this.dir, `say_${Date.now()}_${++this.n}`);
    const file = base + '.wav';
    voice = voice || 'piper';
    if (voice === 'http') {
      try { return await this._http(text, base, opts.voiceHttp); } catch (e) { console.error('voice http', e.message); this.lastError = 'Свой голос: ' + e.message; }
    }
    if (voice.startsWith('piper:') && this.available(voice.slice(6))) {
      try { return await this._piper(text, file, voice.slice(6), pitch, opts.voiceSpeaker); } catch (e) { console.error('piper custom', e.message); this.lastError = 'Модель Piper: ' + e.message; }
    }
    if (voice !== 'sapi' && this.available()) {
      try { return await this._piper(text, file, this.model, this.natural(voice) ? 1 : pitch, 0); } catch (e) { console.error('piper', e.message); }
    }
    if (this.core) {
      const r = await this.core.safe('sapi', { text, path: file, rate: 1 }, 30000);
      if (r) return r;
    }
    return null;
  }

  stop() { try { this.p && this.p.proc.kill(); } catch { } }
}

module.exports = { Tts };
