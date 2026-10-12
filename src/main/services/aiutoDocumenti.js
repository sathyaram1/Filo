// La ricerca fra i documenti chiesta dall'Aiuto di una scheda (#947.3). Su un sito parte solo col sì dato nella vista
// di Filo sopra la scheda; alla pagina tornano nomi e chiavi a caso, mai percorsi, e i testi restano qui per il modello.
// Regole: patterns/l-aiuto-di-un-sito-cerca-i-documenti-col-si-fuori-dal-sito.md

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const COSA_MAX = 500;
const CARTELLA_MAX = 2000;
// Nel popup la richiesta la scrive il modello, che può averla copiata dalla pagina: si mostra corta e su una riga.
const COSA_NEL_POPUP = 160;

const deps = {
  chiediSi: (wc, richiesta) => require('../confermeSopraPagina').chiediDalMain(wc, richiesta),
  cerca: (cosa, opzioni) => require('./documentiIndice').cerca(cosa, opzioni),
  doveSta: (p) => require('./documentiIndice').doveSta(p),
};
function configura(d) { Object.assign(deps, d || {}); }

// wc → { dati: l'ultima ricerca com'è per il modello, chiavi: chiave → percorso, ferma: AbortController | null }
const perScheda = new WeakMap();

function statoDi(wc) {
  let s = perScheda.get(wc);
  if (s) return s;
  s = { dati: null, chiavi: new Map(), ferma: null };
  perScheda.set(wc, s);
  // Una pagina nuova è un'altra conversazione dell'Aiuto: le chiavi della vecchia non aprono più niente.
  try {
    wc.on('did-navigate', () => {
      if (s.ferma) s.ferma.abort();
      s.dati = null;
      s.chiavi = new Map();
    });
    wc.once('destroyed', () => { if (s.ferma) s.ferma.abort(); });
  } catch (_) {}
  return s;
}

const daFilo = (origine) => String(origine || '').startsWith('filo://');

function unaRiga(v, max) {
  const t = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f​-‏ -‮⁠-⁯﻿]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const segni = Array.from(t);
  return segni.length > max ? `${segni.slice(0, max - 1).join('').trimEnd()}…` : t;
}

function hostDi(origine) {
  try { return new URL(String(origine || '')).hostname; } catch (_) { return ''; }
}

// Perché la cartella esce dal perimetro di lettura ('' se ci sta): il costo di CERCA_DOCUMENTI in chat, e il suo motivo.
function fuoriPerimetro(cartella) {
  if (!cartella) return '';
  const L = globalThis.SN_ACTION_LEVELS;
  const C = globalThis.SN_CMD_CLASSIFY;
  if (!L || !C) return 'non si sa dove legge';
  const win = process.platform === 'win32';
  const perimetro = { home: os.homedir(), win, maiuscole: win || process.platform === 'darwin' };
  if (!(L.costoFor({ type: 'CERCA_DOCUMENTI', cartella, _perimetro: perimetro }) > 0)) return '';
  return C.fuoriPerimetro(cartella, perimetro) || 'non si sa dove legge';
}

function domanda({ cosa, cartella, host, perche }) {
  const dove = cartella ? ` nella cartella ${unaRiga(cartella, 200)}` : '';
  const chi = host ? `L'Aiuto di ${host}` : 'L\'Aiuto';
  const righe = [`${chi} vuole cercare fra i tuoi documenti «${unaRiga(cosa, COSA_NEL_POPUP).replace(/[«»]/g, '"')}»${dove}.`];
  if (host) righe.push('Il sito potrà leggere la risposta dell\'Aiuto, con i nomi dei documenti trovati. Il documento arriva al sito solo se lo trascini tu nella pagina.');
  if (perche) righe.push(`Perché te lo chiedo: ${perche}.`);
  return { tipo: 'confirm', title: 'Cerco fra i tuoi documenti?', text: righe.join('\n\n'), okLabel: 'Cerca', cancelLabel: 'Annulla' };
}

// Della risposta dell'indice alla pagina va solo quello che serve a dirlo: i nomi delle cartelle, mai i percorsi.
function indicePerLaPagina(ind) {
  const i = ind || {};
  return {
    documenti: i.documenti || 0,
    scansioni: i.scansioni || 0,
    senzaTesto: i.senzaTesto || 0,
    troppi: !!i.troppi,
    cartelle: (Array.isArray(i.cartelle) ? i.cartelle : []).map((c) => ({ nome: String((c && c.nome) || ''), esiste: !!(c && c.esiste), negata: !!(c && c.negata) })),
    negate: (Array.isArray(i.negate) ? i.negate : []).map((c) => ({ nome: String((c && c.nome) || '') })),
    comePermesso: String(i.comePermesso || ''),
  };
}

/**
 * La ricerca chiesta dall'Aiuto della scheda `wc`. `origine`: l'indirizzo della scheda. `avanzamento(fatti, totali)`.
 * → { ok, cercato, candidati, indice, fermata, cartellaMancante } | { ok:false, annullata } | { ok:false, errore }
 */
async function cerca(wc, { cosa, cartella = '', origine = '', avanzamento = null } = {}) {
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return { ok: false, errore: 'scheda' };
  const q = unaRiga(cosa, COSA_MAX);
  if (!q) return { ok: false, errore: 'vuota' };
  const c = String(cartella == null ? '' : cartella).trim().slice(0, CARTELLA_MAX);
  const perche = fuoriPerimetro(c);
  const sito = !daFilo(origine);
  if (sito || perche) {
    let si = false;
    try { si = await deps.chiediSi(wc, domanda({ cosa: q, cartella: c, host: sito ? (hostDi(origine) || 'questo sito') : '', perche })); } catch (_) { si = false; }
    if (si !== true) return { ok: false, annullata: true };
  }
  const s = statoDi(wc);
  if (s.ferma) s.ferma.abort();
  const ctrl = new AbortController();
  s.ferma = ctrl;
  let r;
  try {
    r = await deps.cerca(q, {
      cartella: c,
      segnale: ctrl.signal,
      avanzamento: avanzamento ? (st) => {
        if (st && st.fase === 'lettura') { try { avanzamento(Math.min(st.fatti + 1, st.totali), st.totali); } catch (_) {} }
      } : null,
    });
  } catch (_) {
    return { ok: false, errore: 'ricerca' };
  } finally {
    if (s.ferma === ctrl) s.ferma = null;
  }
  const risultati = [];
  for (const x of (r && Array.isArray(r.risultati)) ? r.risultati : []) {
    let dove = '';
    try { dove = await deps.doveSta(x.percorso); } catch (_) {}
    risultati.push({ ...x, dove });
  }
  const chiavi = new Map();
  const candidati = risultati.map((x, i) => {
    const chiave = crypto.randomBytes(16).toString('base64url');
    chiavi.set(chiave, x.percorso);
    return { n: i + 1, nome: x.nome, dove: x.dove, tipo: x.tipo, data: x.data, pagine: x.pagine || 0, scansione: !!x.scansione, chiave };
  });
  s.chiavi = chiavi;
  s.dati = {
    cercato: q,
    risultati: risultati.map(({ percorso, cartella: _c, ...resto }) => resto),
    indice: indicePerLaPagina(r && r.indice),
    fermata: !!(r && r.fermata),
    cartellaMancante: (r && r.cartellaMancante) || '',
  };
  return {
    ok: true,
    cercato: q,
    candidati,
    indice: s.dati.indice,
    fermata: s.dati.fermata,
    cartellaMancante: s.dati.cartellaMancante ? unaRiga(c, 200) : '',
  };
}

function ferma(wc) {
  const s = wc && perScheda.get(wc);
  if (s && s.ferma) { s.ferma.abort(); return true; }
  return false;
}

/** L'ultima ricerca della scheda com'è per il modello (PROMPTS.documentiTrovati, per 'aiuto'), o null. */
function perIlModello(wc) {
  const s = wc && perScheda.get(wc);
  return (s && s.dati) || null;
}

function percorsoDi(wc, chiave) {
  const s = wc && perScheda.get(wc);
  if (!s || typeof chiave !== 'string' || !chiave) return '';
  return s.chiavi.get(chiave) || '';
}

const esiste = (p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } };
const nonCe = { ok: false, frase: 'Il file non c’è più: forse è stato spostato o cancellato' };

async function apri(wc, chiave) {
  const p = percorsoDi(wc, chiave);
  if (!p || !esiste(p)) return nonCe;
  try {
    const errore = await require('electron').shell.openPath(p);
    return errore ? { ok: false, frase: 'Il computer non ha un programma per aprire questo file' } : { ok: true };
  } catch (_) {
    return { ok: false, frase: 'Il computer non ha un programma per aprire questo file' };
  }
}

function mostra(wc, chiave) {
  const p = percorsoDi(wc, chiave);
  if (!p) return nonCe;
  try {
    if (esiste(p)) { require('electron').shell.showItemInFolder(p); return { ok: true }; }
    const dir = path.dirname(p);
    if (fs.statSync(dir).isDirectory()) { require('electron').shell.showItemInFolder(dir); return { ok: true, mancaIlFile: true }; }
  } catch (_) {}
  return nonCe;
}

// L'icona sotto il puntatore: quella che il sistema dà a quel tipo di file; se non ne dà, un quadratino (su Mac un
// trascinamento senza icona non parte).
async function iconaDi(p) {
  const { app, nativeImage } = require('electron');
  try {
    const img = await app.getFileIcon(p, { size: 'normal' });
    if (img && !img.isEmpty()) return img;
  } catch (_) {}
  const lato = 32;
  const bgra = Buffer.alloc(lato * lato * 4);
  for (let i = 0; i < bgra.length; i += 4) { bgra[i] = 0x6b; bgra[i + 1] = 0x8f; bgra[i + 2] = 0xc8; bgra[i + 3] = 0xff; }
  return nativeImage.createFromBitmap(bgra, { width: lato, height: lato });
}

async function trascina(wc, chiave) {
  const p = percorsoDi(wc, chiave);
  if (!p || !esiste(p)) return nonCe;
  try {
    wc.startDrag({ file: p, icon: await iconaDi(p) });
    return { ok: true };
  } catch (_) {
    return { ok: false, frase: 'Non sono riuscito a prendere il file: aprilo dalla sua cartella e trascinalo da lì' };
  }
}

module.exports = { configura, cerca, ferma, perIlModello, percorsoDi, apri, mostra, trascina, _domanda: domanda };
