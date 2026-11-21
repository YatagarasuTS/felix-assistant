// РњРѕСЃС‚ Рє YataCore.exe (СЃС‚СЂРѕРєРё JSON С‡РµСЂРµР· stdin/stdout)
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class Core extends EventEmitter {
  constructor(exe) {
    super();
    this.exe = exe;
    this.id = 0;
    this.pending = new Map();
    this.proc = null;
    this.stopping = false;
    this.restarts = 0;
  }

  start() {
    this.stopping = false;
    try {
      this.proc = spawn(this.exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (e) { console.error('core spawn', e); return; }
    let buf = '';
    this.proc.stdout.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== undefined && this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.t);
          m.ok ? p.res(m.data) : p.rej(new Error(m.error || 'core error'));
        } else if (m.ev) this.emit(m.ev, m);
      }
    });
    this.proc.on('exit', code => {
      for (const p of this.pending.values()) { clearTimeout(p.t); p.rej(new Error('core exited')); }
      this.pending.clear();
      if (!this.stopping && this.restarts++ < 20) setTimeout(() => this.start(), 1500);
    });
    this.proc.stdin.on('error', () => { });
  }

  call(cmd, args = {}, timeout = 15000) {
    return new Promise((res, rej) => {
      if (!this.proc || !this.proc.stdin.writable) return rej(new Error('core not running'));
      const id = ++this.id;
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error('core timeout: ' + cmd)); }, timeout);
      this.pending.set(id, { res, rej, t });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
    });
  }

  safe(cmd, args, timeout) { return this.call(cmd, args, timeout).catch(e => { console.error('core', cmd, e.message); return null; }); }

  stop() {
    this.stopping = true;
    try { this.proc && this.proc.stdin.end(); } catch { }
    setTimeout(() => { try { this.proc && this.proc.kill(); } catch { } }, 1500);
  }
}

module.exports = { Core };

