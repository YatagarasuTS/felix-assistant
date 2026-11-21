// Связь с телефоном («Феликс Link» для Android) по Wi-Fi.
//  • поиск: телефон шлёт широковещательный UDP «FELIX?» на 47891 → отвечаем «FELIX! 47890 <имя ПК>»
//  • связь: TCP 47890. Сразу шлём «FELIXLINK1 <nonce>», телефон отвечает зашифрованным hello с этим nonce.
//  • шифрование: ключ = PBKDF2-SHA256(код сопряжения, «FelixLink1», 100 000, 32 байта); каждая строка —
//    base64(iv[12] + AES-256-GCM(json) + тег[16]); в json счётчик n — повтор старых сообщений отвергается.
//  • APK для установки отдаётся по http://<ПК>:47892/FelixLink.apk
const net = require('net');
const dgram = require('dgram');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const { EventEmitter } = require('events');

const PORT = 47890, DISC_PORT = 47891, APK_PORT = 47892;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function newCode() {
  const b = crypto.randomBytes(8);
  return Array.from(b, x => ALPHABET[x % ALPHABET.length]).join('');
}

class Link extends EventEmitter {
  constructor({ getCode, pcName, apkPath, log }) {
    super();
    this.getCode = getCode;
    this.pcName = pcName || os.hostname();
    this.apkPath = apkPath;
    this.log = log || (() => { });
    this.sock = null;
    this.info = null;          // { device, model, android }
    this.seq = 0;
    this.wait = new Map();
    this._key = null; this._keyFor = '';
  }

  get connected() { return !!(this.sock && this.info); }

  key() {
    const c = normCode(this.getCode());
    if (c !== this._keyFor) { this._key = c ? crypto.pbkdf2Sync(c, 'FelixLink1', 100000, 32, 'sha256') : null; this._keyFor = c; }
    return this._key;
  }

  encrypt(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
  }

  decrypt(line) {
    try {
      const all = Buffer.from(line, 'base64');
      if (all.length < 29) return null;
      const d = crypto.createDecipheriv('aes-256-gcm', this.key(), all.subarray(0, 12));
      d.setAuthTag(all.subarray(all.length - 16));
      const plain = Buffer.concat([d.update(all.subarray(12, all.length - 16)), d.final()]).toString('utf8');
      return JSON.parse(plain);
    } catch { return null; }
  }

  start() {
    // TCP — сама связь
    this.server = net.createServer(s => this.onSocket(s));
    this.server.on('error', e => this.log('link tcp', e.message));
    this.server.listen(PORT, '0.0.0.0');
    // UDP — чтобы телефон нашёл компьютер без ввода IP
    this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('message', (msg, r) => {
      if (String(msg).trim() !== 'FELIX?' || !this.key()) return;
      const reply = Buffer.from(`FELIX! ${PORT} ${this.pcName}`);
      this.udp.send(reply, r.port, r.address);
    });
    this.udp.on('error', e => this.log('link udp', e.message));
    this.udp.bind(DISC_PORT, '0.0.0.0');
    // HTTP — только файл приложения для установки на телефон
    this.http = http.createServer((req, res) => {
      if (req.method === 'GET' && /^\/(FelixLink\.apk)?$/i.test(req.url) && this.apkPath && fs.existsSync(this.apkPath)) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="FelixLink.apk"' });
        fs.createReadStream(this.apkPath).pipe(res);
      } else { res.writeHead(404); res.end(); }
    });
    this.http.on('error', e => this.log('link http', e.message));
    this.http.listen(APK_PORT, '0.0.0.0');
  }

  stop() {
    try { this.server && this.server.close(); } catch { }
    try { this.udp && this.udp.close(); } catch { }
    try { this.http && this.http.close(); } catch { }
    try { this.sock && this.sock.destroy(); } catch { }
  }

  onSocket(s) {
    if (!this.key()) { s.destroy(); return; }
    const nonce = crypto.randomBytes(12).toString('base64');
    let recvN = 0, sendN = 0, authed = false, buf = '';
    s.setNoDelay(true);
    s.setKeepAlive(true, 30000);
    s.setTimeout(120000, () => s.destroy());
    s.write(`FELIXLINK1 ${nonce}\n`);
    const send = obj => { if (s.destroyed) return false; sendN++; s.write(this.encrypt({ ...obj, n: sendN }) + '\n'); return true; };
    s.on('data', chunk => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        const m = this.decrypt(line);
        if (!authed) {
          if (!m || m.t !== 'hello' || m.nonce !== nonce) { this.log('link: неверный код или чужое подключение', s.remoteAddress); s.end('BADCODE\n'); return; }
          authed = true; recvN = m.n || 0;
          // новое подключение телефона заменяет старое
          if (this.sock && this.sock !== s) { const old = this.sock; this.sock = null; old.destroy(); }
          this.sock = s; this._send = send;
          // app — версия «Феликс Link»: с 1.1 телефоном можно управлять с компьютера (дела, экран, кнопки)
          this.info = { device: m.device || m.model || 'телефон', model: m.model || '', android: m.android || '', app: String(m.app || '1.0'), address: s.remoteAddress };
          // MAC и широковещательный адрес — телефон сможет включить компьютер «волшебным пакетом» (Wake-on-LAN)
          send({ t: 'welcome', pc: this.pcName, wol: Link.wolFor(s.remoteAddress) });
          this.log('link: подключён', this.info.device, s.remoteAddress);
          this.emit('connected', this.info);
          continue;
        }
        if (!m || !(m.n > recvN)) { this.log('link: битое сообщение'); s.destroy(); return; }
        recvN = m.n;
        this.onMessage(m);
      }
    });
    const gone = () => {
      if (this.sock === s) {
        this.sock = null; this._send = null;
        const info = this.info; this.info = null;
        for (const [, w] of this.wait) w(null);
        this.wait.clear();
        this.log('link: отключён');
        this.emit('disconnected', info);
      }
    };
    s.on('close', gone);
    s.on('error', () => { });
  }

  onMessage(m) {
    switch (m.t) {
      case 'ping': this.send({ t: 'pong' }); break;
      case 'res': { const w = this.wait.get(String(m.id)); if (w) { this.wait.delete(String(m.id)); w(m); } break; }
      case 'call': this.emit('call', m); break;
      case 'battery': this.battery = { level: m.level, charging: !!m.charging }; this.emit('battery', this.battery); break;
      case 'notif': this.emit('notif', m); break;
      case 'felix': this.emit('felix', String(m.text || '')); break;
    }
  }

  send(obj) { return this._send ? this._send(obj) : false; }

  /** Команда телефону; ответ { ok, text, data } или null (нет связи / не ответил) */
  request(cmd, args = {}, timeout = 10000) {
    if (!this.connected) return Promise.resolve(null);
    const id = String(++this.seq);
    return new Promise(res => {
      this.wait.set(id, res);
      if (!this.send({ t: 'cmd', id, cmd, ...args })) { this.wait.delete(id); res(null); return; }
      setTimeout(() => { if (this.wait.has(id)) { this.wait.delete(id); res(null); } }, timeout);
    });
  }

  /** Для Wake-on-LAN: MAC сетевой карты, через которую виден телефон, и широковещательный адрес её сети */
  static wolFor(remote) {
    const toInt = s => String(s).split('.').reduce((a, x) => ((a << 8) + (+x)) >>> 0, 0);
    const toIp = n => [24, 16, 8, 0].map(b => (n >>> b) & 255).join('.');
    const r = String(remote || '').replace(/^::ffff:/, '');
    const cands = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family !== 'IPv4' || a.internal || !a.mac || /^(00:){5}00$/.test(a.mac) || /^169\.254\./.test(a.address)) continue;
        const ip = toInt(a.address), mask = toInt(a.netmask);
        const item = { mac: a.mac.toUpperCase(), broadcast: toIp(((ip & mask) | (~mask >>> 0)) >>> 0), iface: name };
        if (/^\d+\.\d+\.\d+\.\d+$/.test(r) && ((ip & mask) >>> 0) === ((toInt(r) & mask) >>> 0)) return item;
        if (!/(vpn|xray|v2ray|tun|tap|wsl|vethernet|virtual|hyper-v|vmware|virtualbox|tailscale|zerotier|radmin|hamachi|wireguard)/i.test(name)) cands.push(item);
      }
    }
    return cands[0] || null;
  }

  /** Адреса компьютера в домашней сети (без VPN и виртуальных адаптеров — с телефона они недоступны) */
  static addresses() {
    const VIRTUAL = /(vpn|xray|v2ray|tun|tap|wsl|vethernet|virtual|hyper-v|vmware|virtualbox|tailscale|zerotier|radmin|hamachi|wireguard|loopback)/i;
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      if (VIRTUAL.test(name)) continue;
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) out.push({ name, address: a.address });
    }
    // обычная домашняя сеть 192.168.x.x — первой
    return out.sort((x, y) => (/^192\.168\./.test(y.address) ? 1 : 0) - (/^192\.168\./.test(x.address) ? 1 : 0));
  }
}

module.exports = { Link, newCode, normCode, PORT, DISC_PORT, APK_PORT };
