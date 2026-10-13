// Il menu del tasto destro quando quello di Filo nella pagina non parte (guasto, caricamento, Filo spento, Shift: #1122):
// l'utente ha sempre almeno le azioni del browser. Lo chiede il page-preload; voci e posizione dal `context-menu`.

const { BrowserWindow, clipboard } = require('electron');
const { showPopupMenu } = require('./popup-menu');

const ULTIMI = new WeakMap(); // webContents → { params, alle }
const IN_ATTESA = new WeakMap(); // webContents → chi aspetta il prossimo `context-menu`
// La richiesta porta l'ora del gesto (stesso orologio del main): un `context-menu` arrivato prima di quell'ora è di un
// clic precedente, e si aspetta quello nuovo, che può arrivare dopo la richiesta.
const MARGINE_MS = 20;
const ATTESA_MS = 1000;

function segui(wc) {
  wc.on('context-menu', (_e, params) => {
    ULTIMI.set(wc, { params, alle: Date.now() });
    const chi = IN_ATTESA.get(wc);
    if (chi) { IN_ATTESA.delete(wc); chi(params); }
  });
}

function t(chiave, riserva) {
  try { return globalThis.SN_I18N.t(chiave) || riserva; } catch (_) { return riserva; }
}

function voci(params, wc, conSchede) {
  const f = params.editFlags || {};
  const out = [];
  if (params.isEditable) {
    if (f.canCut) out.push({ label: t('menu_cut', 'Taglia'), action: 'cut' });
    if (f.canCopy) out.push({ label: t('menu_copy', 'Copia'), action: 'copy' });
    if (f.canPaste) out.push({ label: t('menu_paste', 'Incolla'), action: 'paste' });
    if (f.canSelectAll) out.push({ label: t('menu_select_all', 'Seleziona tutto'), action: 'selectAll' });
  } else if (f.canCopy && params.selectionText) {
    out.push({ label: t('menu_copy', 'Copia'), action: 'copy' });
  }
  if (/^https?:/i.test(params.linkURL || '')) {
    if (conSchede) out.push({ label: t('menu_open_in_new_tab', 'Apri in nuova tab'), action: 'link-apri' });
    out.push({ label: t('menu_copy_link', 'Copia URL'), action: 'link-copia' });
  }
  if (params.mediaType === 'image') {
    out.push({ label: t('menu_copy_image', 'Copia immagine'), action: 'immagine-copia' });
    if (/^https?:/i.test(params.srcURL || '')) out.push({ label: t('menu_copy_image_link', 'Copia URL immagine'), action: 'immagine-url' });
  }
  if (out.length) out.push({ type: 'separator' });
  const h = wc.navigationHistory;
  if (h && h.canGoBack()) out.push({ label: t('menu_back', 'Indietro'), action: 'indietro' });
  if (h && h.canGoForward()) out.push({ label: t('menu_forward', 'Avanti'), action: 'avanti' });
  out.push({ label: t('menu_reload', 'Ricarica'), action: 'ricarica' });
  return out;
}

function esegui(azione, params, wc, schede, tab) {
  if (wc.isDestroyed()) return;
  if (['cut', 'copy', 'paste', 'selectAll'].includes(azione)) { wc[azione](); return; }
  if (azione === 'link-copia') { clipboard.writeText(params.linkURL); return; }
  if (azione === 'immagine-copia') { wc.copyImageAt(params.x, params.y); return; }
  if (azione === 'immagine-url') { clipboard.writeText(params.srcURL); return; }
  if (azione === 'link-apri') { if (schede) schede.apriDaCollegamento(params.linkURL); return; }
  const metodo = { indietro: 'goBack', avanti: 'goForward', ricarica: 'reload' }[azione];
  if (!metodo) return;
  // Le schede passano dalle loro porte (pagina d'errore, siti bloccati); una finestra d'accesso no.
  if (schede && tab) schede[metodo](tab.id);
  else if (metodo === 'reload') wc.reload();
  else wc.navigationHistory[metodo]();
}

function mostra(wc, params) {
  if (wc.isDestroyed()) return;
  let win = null; let schede = null; let tab = null;
  for (const w of BrowserWindow.getAllWindows()) {
    const trovata = w._filoTabs && w._filoTabs.tabs && w._filoTabs.tabs.find((s) => s.view.webContents === wc);
    if (trovata) { win = w; schede = w._filoTabs; tab = trovata; break; }
  }
  if (!win) win = BrowserWindow.fromWebContents(wc);
  if (!win || win.isDestroyed()) return;
  const b = tab ? tab.view.getBounds() : { x: 0, y: 0 };
  showPopupMenu(win, voci(params, wc, !!schede), b.x + (params.x || 0), b.y + (params.y || 0), (scelta) => {
    const m = /^@action:([a-zA-Z-]{1,20})$/.exec(String(scelta || ''));
    if (m) { try { esegui(m[1], params, wc, schede, tab); } catch (_) {} }
  });
}

function chiesto(event, richiesta) {
  const wc = event.sender;
  const r = richiesta && typeof richiesta === 'object' ? richiesta : {};
  const ora = Date.now();
  const clic = Number.isFinite(r.clic) && r.clic <= ora ? r.clic : ora;
  if (r.motivo) console.error('[menu di riserva] il menu di Filo non si è aperto:', String(r.motivo).slice(0, 2000));
  const ultimo = ULTIMI.get(wc);
  if (ultimo && ultimo.alle >= clic - MARGINE_MS) { mostra(wc, ultimo.params); return; }
  const scade = setTimeout(() => IN_ATTESA.delete(wc), ATTESA_MS);
  IN_ATTESA.set(wc, (params) => { clearTimeout(scade); mostra(wc, params); });
}

module.exports = { segui, chiesto, voci };
