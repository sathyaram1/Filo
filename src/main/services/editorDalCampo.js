// L'Editor che nasce dal campo della home (#2389): tiene la bozza finché l'editor la prende, prepara l'editor sotto la
// home a misura piena e lo porta davanti quando il velo della home è arrivato. Mai una bozza persa: non presa, torna
// nel campo. Prove: tests/editor-dal-campo.spec.mjs, tests/unit/editorDalCampo.test.mjs.

const { randomUUID } = require('node:crypto');

const URL_EDITOR = 'filo://editor/editor.html';
const PRONTO_MS = 6000;
const VELO_MS = 2500;
const TESTO_MAX = 5_000_000;

const attese = new Map();

const eHome = (url) => /^filo:\/\/newtab(\/|$|\?|#)/i.test(String(url || ''));
const eEditor = (url) => /^filo:\/\/editor\//i.test(String(url || ''));
const colore = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i.test(c.trim()) ? c.trim() : '');
const vivo = (wc) => !!(wc && !(wc.isDestroyed && wc.isDestroyed()));

function manda(wc, msg) {
  try { if (vivo(wc)) wc.send('filo:broadcast', msg); } catch (_) {}
}

// Solo numeri finiti e colori: la geometria passa dall'editor alla home, e la home ci disegna sopra.
function geometriaPulita(g) {
  if (!g || typeof g !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(-100000, Math.min(100000, Number(v))) : null);
  const rett = (r) => {
    if (!r || typeof r !== 'object') return null;
    const o = { left: num(r.left), top: num(r.top), width: num(r.width), height: num(r.height) };
    return Object.values(o).every((v) => v != null) ? o : null;
  };
  const testo = rett(g.testo);
  if (!testo) return null;
  const font = g.font && typeof g.font === 'object' ? g.font : {};
  const fam = typeof font.famiglia === 'string' ? font.famiglia.slice(0, 300) : '';
  return {
    vw: num(g.vw), vh: num(g.vh),
    testo,
    font: { size: num(font.size), lineHeight: num(font.lineHeight), spazio: num(font.spazio), famiglia: fam, colore: colore(font.colore) },
    sfondo: colore(g.sfondo),
    colonna: rett(g.colonna) ? { ...rett(g.colonna), sfondo: colore(g.colonna.sfondo), bordo: colore(g.colonna.bordo), raggio: num(g.colonna.raggio) } : null,
  };
}

function chiudi(id) {
  const a = attese.get(id);
  if (!a) return null;
  clearTimeout(a.timer);
  attese.delete(id);
  return a;
}

// L'editor viene davanti, se la home che l'ha chiesto è ancora davanti: chi nel frattempo è andato altrove non viene
// strappato via. Una bozza mai presa torna nel campo.
function davanti(id) {
  const a = chiudi(id);
  if (!a) return;
  const tabs = a.tabs;
  try { tabs.fineArrivo(a.tabId); } catch (_) {}
  if (a.testo != null) { manda(a.homeWc, { type: globalThis.SN_MSG.MSG.EDITOR_BOZZA_RESA, id, testo: a.testo }); return; }
  const editor = tabs.tabs.find((t) => t.id === a.tabId);
  if (!editor) return;
  if (tabs.activeId === a.homeTabId) tabs.activate(a.tabId);
  manda(editor.view && editor.view.webContents, { type: globalThis.SN_MSG.MSG.EDITOR_ARRIVO, id, davanti: true });
}

function consegna({ tabs, homeTab, homeWc, testo, sfondo, velo }) {
  const t = typeof testo === 'string' ? testo : '';
  if (!t.trim()) return { ok: false, error: 'vuoto' };
  if (t.length > TESTO_MAX) return { ok: false, error: `troppo lungo: ${t.length} caratteri, il massimo è ${TESTO_MAX}` };
  if (!tabs || !homeTab) return { ok: false, error: 'nessuna scheda' };
  const id = randomUUID();
  const url = `${URL_EDITOR}?bozza=${id}`;
  let editor = tabs.tabs.find((x) => eEditor(x.url));
  // Un editor già caricato prende la bozza dove sta: ricaricarlo costerebbe tempo, e una pagina con un salvataggio in
  // sospeso può trattenere la navigazione.
  const wcEditor = editor && editor.view && editor.view.webContents;
  const caricato = !!(wcEditor && vivo(wcEditor) && !editor._rinviata && !wcEditor.isLoading?.() && eEditor(wcEditor.getURL?.()));
  if (editor && !caricato) tabs.navigate(editor.id, url);
  else if (!editor) {
    const tabId = tabs.openTab(url, { activate: false });
    editor = tabs.tabs.find((x) => x.id === tabId);
  }
  if (!editor) return { ok: false, error: 'editor non aperto' };
  const bg = colore(sfondo);
  if (bg) { try { editor.view.setBackgroundColor(bg); } catch (_) {} }
  const a = { id, testo: t, tabs, tabId: editor.id, homeTabId: homeTab.id, homeWc, velo: !!velo, timer: null };
  a.timer = setTimeout(() => davanti(id), PRONTO_MS);
  attese.set(id, a);
  try { tabs.arrivoSotto(editor.id); } catch (_) {}
  if (caricato) manda(wcEditor, { type: globalThis.SN_MSG.MSG.EDITOR_BOZZA, id });
  return { ok: true, id };
}

function prendi(id, tab) {
  const a = attese.get(String(id || ''));
  if (!a || !tab || tab.id !== a.tabId || a.testo == null) return { ok: false };
  const testo = a.testo;
  a.testo = null;
  return { ok: true, testo };
}

function editorPronto(id, tab, geometria) {
  const a = attese.get(String(id || ''));
  if (!a || !tab || tab.id !== a.tabId || a.testo != null) return { ok: false };
  if (!a.velo || !vivo(a.homeWc)) { davanti(a.id); return { ok: true }; }
  clearTimeout(a.timer);
  a.timer = setTimeout(() => davanti(a.id), VELO_MS);
  manda(a.homeWc, { type: globalThis.SN_MSG.MSG.EDITOR_ARRIVO, id: a.id, geometria: geometriaPulita(geometria) });
  return { ok: true };
}

function veloPronto(id, wc) {
  const a = attese.get(String(id || ''));
  if (!a || wc !== a.homeWc) return { ok: false };
  davanti(a.id);
  return { ok: true };
}

// Una home che torna davanti sa se arriva dall'editor: solo allora l'editor si restringe nel campo.
function schedaDavanti(prima, ora) {
  if (!ora || !eHome(ora.url)) return;
  const wc = ora.view && ora.view.webContents;
  manda(wc, { type: globalThis.SN_MSG.MSG.EDITOR_RIENTRO, daEditor: !!(prima && eEditor(prima.url)) });
}

module.exports = { consegna, prendi, editorPronto, veloPronto, schedaDavanti, geometriaPulita, eHome, eEditor, _attese: attese };
