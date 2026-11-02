// Il microfono di Filo sulle pagine web (#586): lo apre la cornice della finestra e alla pagina arrivano solo i campioni,
// nel mondo del preload di Filo. Il sito non riceve mai il permesso, e Detta funziona anche dove l'utente gliel'ha negato.
// Non concede niente a nessuna pagina: i permessi dei siti stanno in permessiPagine.js.
'use strict';

const { randomUUID } = require('node:crypto');

// Chi aspetta il sistema (su Mac la prima volta chiede lui) ha tempo; oltre, la dettatura si dice fallita.
const ATTESA_CORNICE_MS = 60_000;
// Più microfoni aperti dalla stessa scheda vogliono dire una pagina rotta, non un utente: si chiude il più vecchio.
const PER_SCHEDA = 2;

const aperti = new Map();
const inAttesa = new Map();

function vivo(wc) {
  try { return Boolean(wc && !wc.isDestroyed()); } catch (_) { return false; }
}

function finestraDellaScheda(wc, BrowserWindow) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs;
      if (tm && Array.isArray(tm.tabs) && tm.tabs.some((t) => t && t.view && t.view.webContents === wc)) return w;
    }
  } catch (_) {}
  return null;
}

function cornice(w) {
  try { return w && !w.isDestroyed() && vivo(w.webContents) ? w.webContents : null; } catch (_) { return null; }
}

function chiudi(id, { dallaCornice = false } = {}) {
  const a = aperti.get(id);
  if (!a) return false;
  aperti.delete(id);
  if (!dallaCornice) { const c = cornice(a.win); if (c) c.send('shell:microfono', { azione: 'chiudi', id }); }
  if (vivo(a.wc)) { try { a.wc.send('microfono:dati', { id, fine: true }); } catch (_) {} }
  return true;
}

// Una pagina nuova nella scheda, o la scheda chiusa: il microfono aperto per quella vecchia si spegne.
function seguiScheda(wc) {
  if (wc._filoMicrofonoSeguito) return;
  wc._filoMicrofonoSeguito = true;
  const chiudiTutti = () => { for (const [id, a] of [...aperti]) if (a.wc === wc) chiudi(id); };
  try { wc.once('destroyed', chiudiTutti); } catch (_) {}
  try {
    wc.on('did-start-navigation', (e, _url, isInPlace, isMainFrame) => {
      const principale = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      const stessa = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      if (principale && !stessa) chiudiTutti();
    });
  } catch (_) {}
}

function seguiFinestra(win) {
  if (win._filoMicrofonoSeguita) return;
  win._filoMicrofonoSeguita = true;
  const chiudiTutti = () => {
    for (const [id, a] of [...aperti]) if (a.win === win) chiudi(id, { dallaCornice: true });
    for (const [id, p] of [...inAttesa]) if (p.win === win) { inAttesa.delete(id); p.ok({ ok: false, errore: 'AbortError' }); }
  };
  try { win.once('closed', chiudiTutti); } catch (_) {}
  try { win.webContents.on('render-process-gone', chiudiTutti); } catch (_) {}
}

async function apri(wc, BrowserWindow) {
  // Lo strato dei riquadri sopra una scheda (l'Aiuto di un sito, #1509.3) ascolta con la cornice della sua scheda.
  let sotto = null;
  try { sotto = require('../stratoDeiRiquadri').paginaDelloStrato(wc); } catch (_) { sotto = null; }
  const win = finestraDellaScheda(sotto ? sotto.wc : wc, BrowserWindow);
  const c = cornice(win);
  if (!c) return { ok: false, errore: 'NotAllowedError' };
  const suoi = [...aperti].filter(([, a]) => a.wc === wc);
  for (const [id] of suoi.slice(0, Math.max(0, suoi.length - PER_SCHEDA + 1))) chiudi(id);
  seguiScheda(wc);
  seguiFinestra(win);
  const id = randomUUID();
  const esito = await new Promise((ok) => {
    const scade = setTimeout(() => { if (inAttesa.delete(id)) ok({ ok: false, errore: 'AbortError' }); }, ATTESA_CORNICE_MS);
    inAttesa.set(id, { win, wc, ok: (r) => { clearTimeout(scade); ok(r); } });
    c.send('shell:microfono', { azione: 'apri', id });
  });
  if (!esito || !esito.ok) {
    const cc = cornice(win);
    if (cc) cc.send('shell:microfono', { azione: 'chiudi', id });
    return { ok: false, errore: String((esito && esito.errore) || 'NotAllowedError').slice(0, 40) };
  }
  if (!vivo(wc)) { const cc = cornice(win); if (cc) cc.send('shell:microfono', { azione: 'chiudi', id }); return { ok: false, errore: 'AbortError' }; }
  aperti.set(id, { wc, win });
  return { ok: true, id, rate: Number(esito.rate) || 16000 };
}

function dallaCornice(event, id) {
  const p = aperti.get(id) || inAttesa.get(id);
  return p && cornice(p.win) === event.sender ? p : null;
}

function registra({ ipcMain, BrowserWindow }) {
  // Dal preload di Filo nella scheda: il mondo della pagina non vede ipcRenderer.
  ipcMain.handle('microfono:apri', (event) => apri(event.sender, BrowserWindow));
  ipcMain.handle('microfono:chiudi', (event, { id } = {}) => {
    const a = aperti.get(String(id || ''));
    return { ok: Boolean(a && a.wc === event.sender && chiudi(String(id))) };
  });
  ipcMain.on('shell:microfono-esito', (event, { id, ok, errore, rate } = {}) => {
    const k = String(id || '');
    const p = inAttesa.get(k);
    if (!p || cornice(p.win) !== event.sender) return;
    inAttesa.delete(k);
    p.ok({ ok: ok === true, errore, rate });
  });
  ipcMain.on('shell:microfono-dati', (event, { id, dati } = {}) => {
    const k = String(id || '');
    if (!aperti.has(k) || !dallaCornice(event, k)) return;
    const a = aperti.get(k);
    if (!vivo(a.wc)) { chiudi(k); return; }
    try { a.wc.send('microfono:dati', { id: k, dati }); } catch (_) {}
  });
  ipcMain.on('shell:microfono-fine', (event, { id } = {}) => {
    const k = String(id || '');
    if (dallaCornice(event, k)) chiudi(k, { dallaCornice: true });
  });
}

module.exports = { registra, _aperti: aperti };
