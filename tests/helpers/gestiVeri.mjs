// Gesti veri del sistema (XTest) per le prove che li vogliono: un trascinamento da una vista all'altra lo decide il
// sistema, e Playwright, che parla a un documento solo, non lo prova. Solo su Linux con un display X (lo schermo
// virtuale delle prove); altrove `disponibili()` è false e la prova si salta dicendolo.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'gestiVeri.py');

export function disponibili() {
  if (process.platform !== 'linux' || !process.env.DISPLAY) return false;
  try {
    execFileSync('python3', ['-I', '-c', "import ctypes; ctypes.cdll.LoadLibrary('libXtst.so.6'); ctypes.cdll.LoadLibrary('libX11.so.6')"], { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

// La finestra delle prove è parcheggiata fuori schermo e trasparente (src/main/test-window-mode.js): i gesti veri la
// vogliono a schermo, davanti.
export async function finestraASchermo(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.setPosition(0, 0);
    w.setOpacity(1);
    w.show();
    w.focus();
  });
}

// Il centro di `sel` in px dello schermo. `doc` è la Page dove sta il nodo (la scheda o lo strato sopra di lei, che ha
// gli stessi px); `scheda` è la Page della scheda, da cui si prende la posizione.
export async function sulloSchermo(app, scheda, doc, sel) {
  const r = await doc.locator(sel).first().boundingBox();
  const o = await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const cb = w.getContentBounds();
    const t = w._filoTabs.tabs.find((x) => x.view.webContents.getURL() === u);
    const vb = t.view.getBounds();
    return { x: cb.x + vb.x, y: cb.y + vb.y };
  }, scheda.url());
  return { x: Math.round(o.x + r.x + r.width / 2), y: Math.round(o.y + r.y + r.height / 2) };
}

export function trascina(da, a) {
  execFileSync('python3', ['-I', SCRIPT, 'trascina', da.x, da.y, a.x, a.y].map(String), { env: process.env });
}

export function scrivi(parola) {
  execFileSync('python3', ['-I', SCRIPT, 'scrivi', String(parola)], { env: process.env });
}
