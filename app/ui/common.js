// Общие функции окон Феликса: тема, звуки, SVG-значки
export const Y = window.felix;
export let CONFIG = null, THEME = null;

export function applyTheme(t) {
  THEME = t;
  const r = document.documentElement.style;
  r.setProperty('--accent', t.accent);
  r.setProperty('--accent2', t.accent2 || t.accent);
  r.setProperty('--bg', t.bg);
  r.setProperty('--panel', t.panel);
  r.setProperty('--text', t.text);
  r.setProperty('--dim', t.dim);
  r.setProperty('--radius', (t.radius ?? 14) + 'px');
  document.documentElement.classList.toggle('light', t.dark === false);
}

export async function init(onConfig) {
  const c = await Y.invoke('config:get');
  CONFIG = c.config; applyTheme(c.theme);
  onConfig && onConfig(c.config, c);
  Y.on('config', d => { CONFIG = d.config; applyTheme(d.theme); onConfig && onConfig(d.config, d); });
  return c;
}

const soundCache = {};
export async function sound(name, vol = 0.5) {
  if (CONFIG && CONFIG.sounds && CONFIG.sounds.ui === false) return;
  try {
    if (!soundCache[name]) soundCache[name] = await Y.invoke('sound', name);
    const a = new Audio(soundCache[name]); a.volume = vol; a.play().catch(() => { });
  } catch { }
}

export const ICONS = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  min: '<path d="M6 12h12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  voice: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 10a3 3 0 0 0 1 2.2A3 3 0 0 0 6 17a3 3 0 0 0 3 3 2 2 0 0 0 3-1V5a2 2 0 0 0-3-1z"/><path d="M15 4a3 3 0 0 1 3 3v.2a3 3 0 0 1 2 2.8 3 3 0 0 1-1 2.2 3 3 0 0 1-1 4.8 3 3 0 0 1-3 3 2 2 0 0 1-3-1"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  clover: '<circle cx="12" cy="7.2" r="3.4"/><circle cx="16.8" cy="12" r="3.4"/><circle cx="12" cy="16.8" r="3.4"/><circle cx="7.2" cy="12" r="3.4"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>'
};
export const svg = (name, cls = 'ico', vb = '0 0 24 24') => `<svg class="${cls}" viewBox="${vb}">${ICONS[name] || ''}</svg>`;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
