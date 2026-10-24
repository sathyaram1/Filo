// La ricerca fra i documenti chiesta dall'Aiuto di una scheda (#947.3). Su un sito parte solo col sì dato nella vista
// di Filo sopra la scheda; alla pagina tornano nomi e chiavi a caso, mai percorsi, e i testi restano qui per il modello.
// Regole: patterns/una-conferma-su-un-sito-sta-fuori-dal-suo-documento.md

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const COSA_MAX = 500;
const CARTELLA_MAX = 2000;
// Nel popup la richiesta la scrive il modello, che può averla copiata dalla pagina: si mostra corta e su una riga.
const COSA_NEL_POPUP = 160;
// I bottoni delle ricerche di prima restano in chat e devono aprire ancora il loro file: le chiavi si tengono tutte
// finché la pagina non cambia; il tetto è solo una guardia (quattro ricerche per conversazione da otto candidati).
const CHIAVI_MAX = 1000;

const deps = {
  chiediSi: (wc, richiesta) => require('../confermeSopraPagina').chiediDalMain(wc, richiesta),
  cerca: (cosa, opzioni) => require('./documentiIndice').cerca(cosa, opzioni),
  doveSta: (p) => require('./documentiIndice').doveSta(p),
  cartellaChiesta: (c) => require('./documentiIndice').cartellaChiesta(c),
};
function configura(d) { Object.assign(deps, d || {}); }

// wc → { dati: l'ultima ricerca com'è per il modello, chiavi: chiave → percorso, ferma: AbortController | null, chiede }
const perScheda = new WeakMap();

function statoDi(wc) {
  let s = perScheda.get(wc);
  if (s) return s;
  s = { dati: null, chiavi: new Map(), ferma: null, chiede: false };
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
  const t = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const segni = Array.from(t);
  return segni.length > max ? `${segni.slice(0, max - 1).join('').trimEnd()}…` : t;
}

function hostDi(origine) {
  try { return new URL(String(origine || '')).hostname; } catch (_) { return ''; }
}

// Perché la cartella esce dal perimetro di lettura ('' se ci sta): il costo di CERCA_DOCUMENTI in chat, e il suo motivo,
// misurati sulla cartella che l'indice leggerà (`risolta`: '' per una di serie, #1499).
function fuoriPerimetro(cartella, risolta) {
  if (!cartella) return '';
  const L = globalThis.SN_ACTION_LEVELS;
  const C = globalThis.SN_CMD_CLASSIFY;
  if (!L || !C) return 'non si sa dove legge';
  const win = process.platform === 'win32';
  const perimetro = { home: os.homedir(), win, maiuscole: win || process.platform === 'darwin' };
  if (!(L.costoFor({ type: 'CERCA_DOCUMENTI', cartella, _cartella: risolta, _perimetro: perimetro }) > 0)) return '';
  return C.fuoriPerimetro(risolta || cartella, perimetro) || 'non si sa dove legge';
}

function domanda({ cosa, cartella, host, perche }) {
  const dove = cartella ? ` nella cartella ${unaRiga(cartella, 200)}` : '';
  const chi = host ? `L'Aiuto di ${host}` : 'L\'Aiuto';
  const righe = [`${chi} vuole cercare fra i tuoi documenti «${unaRiga(cosa, COSA_NEL_POPUP).replace(/[«»]/g, '"')}»${dove}.`];
  if (host) righe.push('Il sito potrà leggere la risposta dell\'Aiuto, con i nomi dei documenti trovati. Il documento arriva al sito solo se lo trascini tu nella pagina.');
  if (perche) righe.push(`Perché te lo chiedo: ${perche}.`);
  // Nel popup la richiesta e la cartella, intere, stanno nel loro riquadro: le scrive il modello, guidato dalla pagina (#592.7).
  const parti = [`${chi} vuole cercare fra i tuoi documenti:\n`, { citazione: unaRiga(cosa, COSA_MAX) },
    ...(cartella ? ['\nNella cartella:\n', { citazione: unaRiga(cartella, CARTELLA_MAX), nuda: true }] : []),
    ...righe.slice(1).map((r) => `\n\n${r}`)];
  return { tipo: 'confirm', title: 'Cerco fra i tuoi documenti?', text: righe.join('\n\n'), parti, okLabel: 'Cerca', cancelLabel: 'Annulla' };
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
  let ch = null;
  if (c) { try { ch = await deps.cartellaChiesta(c); } catch (_) { ch = null; } }
  const s = statoDi(wc);
  // Una cartella su un altro computer non si cerca (#1499): lo si dice senza chiedere un sì che non porterebbe a niente.
  if (ch && ch.rete) {
    s.dati = { cercato: q, risultati: [], indice: indicePerLaPagina(null), fermata: false, cartellaMancante: '', cartellaDiRete: c };
    return { ok: true, cercato: q, candidati: [], indice: s.dati.indice, fermata: false, cartellaMancante: '', cartellaDiRete: unaRiga(c, 200) };
  }
  // Senza la cartella risolta vale la regola sul nome scritto.
  const perche = fuoriPerimetro(c, ch ? (ch.serie ? '' : ch.percorso) : undefined);
  const sito = !daFilo(origine);
  if (sito || perche) {
    // Una domanda alla volta per scheda: chi ne chiede altre mentre una aspetta non accoda popup all'utente.
    if (s.chiede) return { ok: false, errore: 'in attesa' };
    s.chiede = true;
    let si = false;
    try { si = await deps.chiediSi(wc, domanda({ cosa: q, cartella: c, host: sito ? (hostDi(origine) || 'questo sito') : '', perche })); } catch (_) { si = false; }
    s.chiede = false;
    if (si !== true) return { ok: false, annullata: true };
  }
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
  const candidati = risultati.map((x, i) => {
    const chiave = crypto.randomBytes(16).toString('base64url');
    s.chiavi.set(chiave, x.percorso);
    return { n: i + 1, nome: x.nome, dove: x.dove, tipo: x.tipo, data: x.data, pagine: x.pagine || 0, scansione: !!x.scansione, chiave };
  });
  for (const k of s.chiavi.keys()) {
    if (s.chiavi.size <= CHIAVI_MAX) break;
    s.chiavi.delete(k);
  }
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

// L'icona sotto il puntatore: quella che il sistema dà a quel tipo di file, se arriva subito (il trascinamento parte
// mentre il tasto è giù; su Linux senza tema di icone la richiesta non torna); se no un foglio disegnato qui. Su Mac
// un trascinamento senza icona non parte.
const ICONA_MS = 150;
const icone = new Map();
function foglio() {
  const { nativeImage } = require('electron');
  const L = 24; const A = 30;
  const bgra = Buffer.alloc(L * A * 4);
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      const i = (y * L + x) * 4;
      const bordo = x === 0 || y === 0 || x === L - 1 || y === A - 1;
      const riga = x > 4 && x < L - 5 && y > 6 && y < A - 5 && y % 4 === 0;
      const v = bordo ? 0x8a : (riga ? 0xb8 : 0xfa);
      bgra[i] = v; bgra[i + 1] = v; bgra[i + 2] = v; bgra[i + 3] = 0xff;
    }
  }
  return nativeImage.createFromBitmap(bgra, { width: L, height: A });
}
async function iconaDi(p) {
  const ext = path.extname(p).toLowerCase();
  if (icone.has(ext)) return icone.get(ext);
  let img = null;
  try {
    img = await Promise.race([
      require('electron').app.getFileIcon(p, { size: 'normal' }),
      new Promise((ok) => setTimeout(() => ok(null), ICONA_MS)),
    ]);
  } catch (_) { img = null; }
  if (img && !img.isEmpty()) { icone.set(ext, img); return img; }
  return foglio();
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
