// Il controllo senza modello della rilettura (#1403): testo e allegati di testo letti con le regole del pavimento e del
// guardiano. Gira nel processo a parte (feedbackL0StaticoFiglio.js) perché un log da 4 MB non fermi finestre e schede
// (#1403.2); qui solo se il processo non c'è (unit test). Prove: tests/unit/feedbackL0Statico.test.mjs.

'use strict';

const path = require('node:path');

// Cinque log da 4 MB si leggono in qualche secondo: oltre, il lettore è fermo e la rilettura vale come saltata.
const TEMPO_MAX_MS = 30_000;
const RIPOSO_MS = 60_000;

// La lettura dei byte è quella del lettore dei documenti: una regola sola per UTF-16 senza firma e tabella di Windows.
function testoDiDataUrl(dataUrl) {
  try {
    if (typeof dataUrl !== 'string') return null;
    const m = /^data:[^,]*?(;base64)?,/i.exec(dataUrl);
    if (!m) return null;
    const corpo = dataUrl.slice(m[0].length);
    return m[1] ? require('./documentRead').decodeText(Buffer.from(corpo, 'base64')) : decodeURIComponent(corpo);
  } catch (_) { return null; }
}

function condiviso(nome, globale) {
  if (!globalThis[globale]) require(path.join(__dirname, '..', '..', 'shared', nome));
  return globalThis[globale];
}

function trovatiIn(g, testo, custoditi) {
  let valori = [];
  let tratti = [];
  try { valori = (g.segretiNelTesto(testo) || []).filter((x) => x && x.valore); } catch (_) {}
  try { valori.push(...(condiviso('pavimento.js', 'SN_PAVIMENTO').trova(testo) || []).filter((x) => x && x.valore)); } catch (_) {}
  try { tratti = g.trattiSegreti(testo, custoditi) || []; } catch (_) {}
  return { valori, tratti };
}

// → { testo: { valori, tratti } | null, allegati: [{ valori, tratti } | null] }. `allegati`: data URL degli allegati
// di testo, null al posto degli altri.
function leggiQui({ testo = '', allegati = [], custoditi = [] } = {}) {
  if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
  const g = condiviso('guardianoStatico.js', 'SN_GUARDIANO_STATICO');
  const t = String(testo || '');
  return {
    testo: g && t ? trovatiIn(g, t, custoditi) : null,
    allegati: (Array.isArray(allegati) ? allegati : []).map((u) => {
      const s = u == null ? null : testoDiDataUrl(u);
      return g && s != null ? trovatiIn(g, s, custoditi) : null;
    }),
  };
}

let figlio = null;
let senzaFiglio = false;
let prossimo = 1;
const attese = new Map();
let riposo = null;

function abbandona(f) {
  if (figlio === f) figlio = null;
  for (const [id, a] of attese) {
    if (a.f !== f) continue;
    attese.delete(id);
    clearTimeout(a.timer);
    a.resolve(null);
  }
  try { if (f) f.kill(); } catch (_) {}
}

function avvia() {
  let utilityProcess;
  try { ({ utilityProcess } = require('electron')); } catch (_) { utilityProcess = null; }
  if (!utilityProcess || typeof utilityProcess.fork !== 'function') { senzaFiglio = true; return null; }
  try {
    const f = utilityProcess.fork(path.join(__dirname, 'feedbackL0StaticoFiglio.js'), [], { serviceName: 'Filo · rilettura dei feedback' });
    f.on('message', (msg) => {
      const a = msg && attese.get(msg.id);
      if (!a) return;
      attese.delete(msg.id);
      clearTimeout(a.timer);
      a.resolve(msg.r || null);
    });
    f.on('exit', () => abbandona(f));
    return f;
  } catch (_) {
    senzaFiglio = true;
    return null;
  }
}

function programmaRiposo() {
  clearTimeout(riposo);
  riposo = setTimeout(() => {
    if (!attese.size && figlio) abbandona(figlio);
  }, RIPOSO_MS);
  if (riposo.unref) riposo.unref();
}

function prepara() {
  if (!senzaFiglio && !figlio) figlio = avvia();
  if (figlio) programmaRiposo();
}

// Fin qui si legge nel processo principale: qualche decina di millisecondi, meno di quanto costa avviare l'altro.
const SOGLIA_QUI = 256 * 1024;
function dimensione({ testo = '', allegati = [] } = {}) {
  return String(testo || '').length + (Array.isArray(allegati) ? allegati : []).reduce((n, u) => n + (typeof u === 'string' ? u.length : 0), 0);
}

// Come leggiQui, o null se il lettore non ha risposto entro TEMPO_MAX_MS. Non rifiuta mai.
async function leggi(dati, { tempoMaxMs = TEMPO_MAX_MS, sogliaQui = SOGLIA_QUI } = {}) {
  if (dimensione(dati) > sogliaQui) prepara();
  if (!figlio || dimensione(dati) <= sogliaQui) {
    try { return leggiQui(dati); } catch (_) { return null; }
  }
  const f = figlio;
  const id = prossimo++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { if (attese.has(id)) abbandona(f); }, tempoMaxMs);
    attese.set(id, { resolve, timer, f });
    try { f.postMessage({ id, dati }); } catch (_) { abbandona(f); }
  });
}

module.exports = { leggi, leggiQui, testoDiDataUrl, TEMPO_MAX_MS, SOGLIA_QUI };
