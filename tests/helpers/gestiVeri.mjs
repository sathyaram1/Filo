// Gesti veri del sistema (XTest) per le prove che li vogliono: un trascinamento da una vista all'altra lo decide il
// sistema, e Playwright, che parla a un documento solo, non lo prova. Solo su Linux con un display X (lo schermo
// virtuale delle prove); altrove `disponibili()` è false e la prova si salta dicendolo.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bersaglioDi } from './schede.mjs';

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
// gli stessi px); `scheda` è la Page della scheda, da cui si prende la posizione. La scheda si riconosce dalla sua vista,
// non dall'indirizzo: con due home la prima per indirizzo era quella dietro, coi limiti a zero (#2285).
export async function sulloSchermo(app, scheda, doc, sel) {
  const r = await doc.locator(sel).first().boundingBox();
  const o = await app.evaluate(({ BrowserWindow }, b) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = (w._filoTabs?.tabs || []).find((x) => {
        try { return x.view.webContents.getOrCreateDevToolsTargetId() === b; } catch (_) { return false; }
      });
      if (!t) continue;
      const cb = w.getContentBounds();
      const vb = t.view.getBounds();
      const visibile = typeof t.view.getVisible === 'function' ? t.view.getVisible() : true;
      return { x: cb.x + vb.x, y: cb.y + vb.y, aSchermo: visibile && vb.width > 0 && vb.height > 0 };
    }
    return null;
  }, await bersaglioDi(scheda));
  if (!o) throw new Error(`sulloSchermo: ${scheda.url()} non è la Page di una scheda di Filo`);
  if (!o.aSchermo) throw new Error(`sulloSchermo: la scheda di ${scheda.url()} non è a schermo (ce n'è un'altra davanti)`);
  return { x: Math.round(o.x + r.x + r.width / 2), y: Math.round(o.y + r.y + r.height / 2) };
}

// `tappe`: punti di passaggio dopo `a`, col tasto sempre giù (uscire da una vista e rientrare).
export function trascina(da, a, ...tappe) {
  const punti = [da, a, ...tappe].flatMap((p) => [p.x, p.y]);
  execFileSync('python3', ['-I', SCRIPT, 'trascina', ...punti].map(String), { env: process.env });
}

export function scrivi(parola) {
  execFileSync('python3', ['-I', SCRIPT, 'scrivi', String(parola)], { env: process.env });
}
