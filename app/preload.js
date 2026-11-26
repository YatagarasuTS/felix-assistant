// Мост между окнами Феликса и главным процессом
const { contextBridge, ipcRenderer } = require('electron');

const listeners = {};
const CHANNELS = ['config', 'say', 'partial', 'heard', 'listen', 'level', 'mic', 'think', 'minimize', 'restore', 'idle-play', 'idle-end',
  'goto', 'chime', 'notice', 'mouse:sync', 'side', 'phone', 'call', 'wardrobe', 'selfie', 'phone:video', 'phone:cast', 'drop', 'fx'];

for (const ch of CHANNELS) {
  ipcRenderer.on(ch, (e, data) => (listeners[ch] || []).forEach(fn => { try { fn(data); } catch (err) { console.error(err); } }));
}

// Своя «пересылка» мыши от главного процесса (окно Феликса прозрачно для кликов и само мышь не видит):
// превращаем её в обычные события страницы — mousemove над элементом под курсором и mouseleave при уходе.
ipcRenderer.on('mouse:fwd', (e, p) => {
  try {
    if (p.out) { document.dispatchEvent(new MouseEvent('mouseleave')); window.dispatchEvent(new MouseEvent('mouseleave')); return; }
    const init = { clientX: p.x, clientY: p.y, screenX: window.screenX + p.x, screenY: window.screenY + p.y, bubbles: true };
    (document.elementFromPoint(p.x, p.y) || document).dispatchEvent(new MouseEvent('mousemove', init));
  } catch { }
});

contextBridge.exposeInMainWorld('felix', {
  on: (ch, fn) => { (listeners[ch] = listeners[ch] || []).push(fn); },
  invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args)
});
