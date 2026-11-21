// Мост к FelixInput.exe: клавиши в программах (do …), музыка (media …), устройства вывода звука (audio …)
const { spawn } = require('child_process');
const readline = require('readline');

class Input {
  constructor(exe, log) { this.exe = exe; this.log = log || (() => { }); this.p = null; this.seq = 0; this.wait = new Map(); this.quitting = false; this.fails = 0; }

  start() {
    if (this.p) return true;
    try {
      const p = spawn(this.exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      this.p = p;
      readline.createInterface({ input: p.stdout }).on('line', line => {
        const a = line.trim().split(' ');
        const res = this.wait.get(a[1]); if (!res) return;
        this.wait.delete(a[1]);
        const dec = s => { try { return Buffer.from(s || '', 'base64').toString('utf8'); } catch { return ''; } };
        if (a[0] === 'media') res({ ok: a[2] === '1', status: a[3] || '', artist: dec(a[4]), title: dec(a[5]), app: dec(a[6]) });
        else if (a[0] === 'audio') res({ ok: a[2] === '1', text: a[3] ? dec(a[3]) : '' });
      });
      p.stdin.on('error', () => { });
      p.on('exit', code => {
        if (this.p === p) this.p = null;
        for (const r of this.wait.values()) r(null);
        this.wait.clear();
        this.log('felixinput exit', code);
        if (!this.quitting && ++this.fails < 5) setTimeout(() => this.start(), 3000);
      });
      return true;
    } catch (e) { this.log('felixinput', e.message); this.p = null; return false; }
  }

  get ready() { return !!this.p; }
  send(line) { try { if (this.p) this.p.stdin.write(line + '\n'); } catch { } }
  /** Шаги: 'activate <hwnd>', 'sleep <мс>', 'keys CTRL T', 'type <base64>' — выполняются по порядку */
  steps(list) { list.forEach(s => this.send('do ' + s)); }

  ask(cmd, args, timeout = 6000) {
    if (!this.p) return Promise.resolve(null);
    const id = String(++this.seq);
    return new Promise(res => {
      this.wait.set(id, res);
      this.send(`${cmd} ${id} ${args}`);
      setTimeout(() => { if (this.wait.has(id)) { this.wait.delete(id); res(null); } }, timeout);
    });
  }
  media(action) { return this.ask('media', action); }
  audio(op, dev = '') { return this.ask('audio', op + (dev ? ' ' + dev : '')); }

  stop() {
    this.quitting = true;
    try { if (this.p) { this.p.stdin.write('quit\n'); this.p.stdin.end(); } } catch { }
  }
}

module.exports = { Input };
