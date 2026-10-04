// Leggere e guidare le schede aperte per la chat (#534): quale scheda, se si può, e il lavoro dentro la pagina.
// Il gesto nella pagina lo fa paginaGuidata.js; il livello e le uscite li decide handlers.js prima di arrivare qui.
// Prove: tests/schede-aperte.spec.mjs.

const { MONDO, CODICE } = require('./paginaGuidata');

// Le pagine dell'account Google sono le più sorvegliate contro l'automazione: lì Filo non legge e non tocca niente.
const HOST_VIETATI = ['accounts.google.com', 'myaccount.google.com', 'passwords.google.com', 'security.google.com',
  'admin.google.com', 'payments.google.com', 'pay.google.com'];
const TETTO_CHIAMATA = 10000;

const pausa = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

function hostDi(url) {
  try { return new URL(String(url)).hostname.toLowerCase(); } catch (_) { return ''; }
}

function vietata(url) {
  const h = hostDi(url);
  return !!h && HOST_VIETATI.some((v) => h === v || h.endsWith(`.${v}`));
}

async function abilitata() {
  try {
    const s = await globalThis.SN_STORAGE.getSettings();
    return !(s && s.schedeAperte && s.schedeAperte.leggere === false);
  } catch (_) { return true; }
}

const web = (t) => !!t && !t.isInternal && /^https?:\/\//i.test(t.url || '');

// Lo stesso ordine dell'elenco TAB APERTE che il modello legge nello stato (src/shared/filoState.js): il numero
// che cita è il numero di quella riga.
function inOrdine(tm) {
  return [...(tm && Array.isArray(tm.tabs) ? tm.tabs : [])].sort((a, b) => {
    const la = a.lastActiveAt || 0;
    const lb = b.lastActiveAt || 0;
    return la !== lb ? lb - la : 0;
  });
}

const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// `rif`: il numero della riga in TAB APERTE, parole del titolo o del sito, oppure niente = la scheda web davanti.
function trovaScheda(win, rif) {
  const tm = win && win._filoTabs;
  if (!tm) return null;
  const s = String(rif == null ? '' : rif).trim();
  const ord = inOrdine(tm);
  if (!s) {
    const davanti = tm.tabs.find((t) => t.id === tm.activeId);
    return web(davanti) ? davanti : (ord.find(web) || null);
  }
  if (/^\d{1,3}$/.test(s)) return ord[Number(s) - 1] || null;
  const q = norm(s);
  const parole = q.split(' ').filter(Boolean);
  const voto = (t) => {
    const testo = norm(`${t.title || ''} ${hostDi(t.url)}`);
    return parole.filter((p) => testo.includes(p)).length;
  };
  let meglio = null;
  let punti = 0;
  for (const t of ord) {
    if (!web(t)) continue;
    const v = voto(t);
    if (v > punti) { meglio = t; punti = v; }
  }
  return meglio;
}

function descriviScheda(tab) {
  return { id: tab.id, titolo: String(tab.title || ''), url: String(tab.url || ''), host: hostDi(tab.url) };
}

// `fn` è il nome di una funzione del copione (mai un testo del modello); gli argomenti viaggiano come JSON.
async function chiama(wc, fn, args = []) {
  if (!wc || wc.isDestroyed?.()) throw new Error('scheda chiusa');
  const code = `${CODICE}\n;window.__filoPagina.${fn}(...${JSON.stringify(args)})`;
  let timer = null;
  const scade = new Promise((_, no) => { timer = setTimeout(() => no(new Error('la pagina non risponde')), TETTO_CHIAMATA); timer.unref?.(); });
  try {
    return await Promise.race([wc.executeJavaScriptInIsolatedWorld(MONDO, [{ code }]), scade]);
  } finally { clearTimeout(timer); }
}

async function attendi(prova, { tetto = 8000, passo = 200 } = {}) {
  const fine = Date.now() + tetto;
  for (;;) {
    let v = null;
    try { v = await prova(); } catch (_) { v = null; }
    if (v) return v;
    if (Date.now() >= fine) return null;
    await pausa(passo);
  }
}

// Finito di caricare e fermo da `calma` millisecondi (il DOM non cambia): quello che si legge è quello che si vede.
async function assesta(wc, { calma = 350, tetto = 6000 } = {}) {
  await attendi(async () => !wc.isDestroyed() && !wc.isLoading(), { tetto: Math.min(tetto, 15000) });
  await attendi(async () => (await chiama(wc, 'quiete')) >= calma, { tetto, passo: 120 });
}

// La scheda di dietro si allarga sotto quella davanti finché Filo ci lavora: senza area non si disegna e non risponde.
async function lavoraSu(win, tab, fn) {
  const tm = win && win._filoTabs;
  const wc = tab && tab.view && tab.view.webContents;
  if (!wc || wc.isDestroyed()) return { ok: false, errore: 'chiusa' };
  const rilascia = tm && typeof tm.alLavoro === 'function' ? tm.alLavoro(tab.id) : () => {};
  try {
    return await fn(wc, tab);
  } catch (e) {
    if (wc.isDestroyed()) return { ok: false, errore: 'chiusa' };
    return { ok: false, errore: 'pagina', dettaglio: String((e && e.message) || e).slice(0, 200) };
  } finally {
    rilascia();
  }
}

async function preparaScheda(win, rif) {
  if (!(await abilitata())) return { errore: 'spento' };
  const tab = trovaScheda(win, rif);
  if (!tab) return { errore: 'nessuna-scheda' };
  if (!web(tab)) return { errore: 'non-web', scheda: descriviScheda(tab) };
  if (vietata(tab.url)) return { errore: 'vietata', scheda: descriviScheda(tab) };
  return { tab };
}

async function leggi({ win, rif, gmail = null }) {
  const p = await preparaScheda(win, rif);
  if (p.errore) return { ok: false, errore: p.errore, scheda: p.scheda };
  if (gmail && gmail.eGmail(p.tab.url)) return gmail.leggiVista(win, p.tab);
  return lavoraSu(win, p.tab, async (wc, tab) => {
    await assesta(wc);
    const r = await chiama(wc, 'leggi', [{ max: 400000, quanti: 200 }]);
    const F = globalThis.SN_FIDUCIA;
    const fid = await require('./fiduciaStore').leggi();
    return {
      ok: true, scheda: { ...descriviScheda(tab), titolo: String(r.titolo || tab.title || ''), url: String(r.url || tab.url || '') },
      testo: String(r.testo || ''), troncato: !!r.troncato,
      elementi: Array.isArray(r.elementi) ? r.elementi : [], totaleElementi: Number(r.totale) || 0,
      fonte: F.fonteSito(fid, r.url || tab.url),
    };
  });
}

async function apri({ win, rif, elemento }) {
  const p = await preparaScheda(win, rif);
  if (p.errore) return { ok: false, errore: p.errore, scheda: p.scheda };
  return lavoraSu(win, p.tab, async (wc, tab) => {
    await assesta(wc, { tetto: 3000 });
    const r = await chiama(wc, 'apri', [String(elemento == null ? '' : elemento)]);
    if (!r || !r.ok) return { ok: false, errore: (r && r.motivo) || 'non-trovato', nome: r && r.nome, url: r && r.url, scheda: descriviScheda(tab) };
    await pausa(150);
    await assesta(wc);
    if (vietata(wc.getURL())) return { ok: true, nome: r.nome, tipo: r.tipo, scheda: descriviScheda(tab), vietataDopo: true };
    return { ok: true, nome: r.nome, tipo: r.tipo, scheda: { ...descriviScheda(tab), titolo: wc.getTitle(), url: wc.getURL() } };
  });
}

async function scrivi({ win, rif, campo, testo }) {
  const p = await preparaScheda(win, rif);
  if (p.errore) return { ok: false, errore: p.errore, scheda: p.scheda };
  return lavoraSu(win, p.tab, async (wc, tab) => {
    await assesta(wc, { tetto: 3000 });
    const r = await chiama(wc, 'scrivi', [String(campo == null ? '' : campo), String(testo == null ? '' : testo)]);
    if (!r || !r.ok) return { ok: false, errore: (r && r.motivo) || 'non-trovato', nome: r && r.nome, scheda: descriviScheda(tab) };
    return { ok: true, nome: r.nome, valore: r.valore, scheda: descriviScheda(tab) };
  });
}

async function scorri({ win, rif, verso }) {
  const p = await preparaScheda(win, rif);
  if (p.errore) return { ok: false, errore: p.errore, scheda: p.scheda };
  return lavoraSu(win, p.tab, async (wc, tab) => {
    const r = await chiama(wc, 'scorri', [String(verso || 'giu')]);
    await assesta(wc, { tetto: 2500 });
    return { ok: true, ...r, scheda: descriviScheda(tab) };
  });
}

// Per «considera fidato questo sito»: i segni di molti autori nelle schede aperte su quel sito.
async function segnaliSito(win, sito) {
  const tm = win && win._filoTabs;
  const F = globalThis.SN_FIDUCIA;
  if (!tm || !F || !(await abilitata())) return null;
  const tab = inOrdine(tm).find((t) => web(t) && !vietata(t.url) && F.sito(t.url) && (F.sito(t.url) === sito || F.sito(t.url).endsWith(`.${sito}`)));
  if (!tab) return null;
  const r = await lavoraSu(win, tab, async (wc) => {
    await assesta(wc, { tetto: 2500 });
    return chiama(wc, 'segnaliAutori');
  });
  return r && typeof r === 'object' && r.ok !== false ? r : null;
}

module.exports = {
  HOST_VIETATI, vietata, abilitata, trovaScheda, descriviScheda, chiama, attendi, assesta, lavoraSu, pausa,
  leggi, apri, scrivi, scorri, segnaliSito, hostDi, inOrdine, web,
};
