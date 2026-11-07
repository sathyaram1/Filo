// Per test:shoot (#1246): la barra laterale aperta con le azioni sulla pagina e «Altro…» aperto, aperto come un clic
// vero sulla freccia. Uso: main-file:tests/agent/scenari/barra-icone.js; wait:700; shot:barra (prima, per il tema scuro:
// main-file:tests/agent/scenari/tema-scuro.js).
const w = electron.BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
const b = w._filoTabs.barra;
b.apri('clic');
await new Promise((r) => setTimeout(r, 450));
const wc = b.vista.webContents;
const p = await wc.executeJavaScript(`(() => { const e = document.querySelector('#nav [data-altro]');
  const q = e.getBoundingClientRect(); return { x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height / 2) }; })()`);
wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
