// L0 lato main (#1403): rilegge un feedback prima che parta, con la rilettura del testo anticipata mentre si scrive.
// Non diventa mai un muro: spento, senza modello, senza crediti, in errore o oltre l'attesa dà «saltato» e il feedback
// parte. Domande e frasi stanno in src/shared/feedbackL0.js; prove: tests/unit/feedbackL0Servizio.test.mjs.

'use strict';

const ATTESA_MS = 8000;
// Una rilettura vale per il testo esatto: si tengono le ultime, per il riquadro che si riapre e si rimanda.
const CACHE_MAX = 30;
const CACHE_MS = 10 * 60 * 1000;

function crea({ gate, azioni, impostazioni, segreti = async () => [], redTeam = () => false, log = console, adesso = () => Date.now() } = {}) {
  const L = () => globalThis.SN_FEEDBACK_L0;
  const G = () => globalThis.SN_GUARDIANO_STATICO;
  const cache = new Map(); // testo -> { promessa, at }

  async function acceso() {
    try {
      const s = await impostazioni();
      return !(s && s.feedbackRilettura && s.feedbackRilettura.enabled === false);
    } catch (_) { return true; }
  }

  function dettaglio(e) {
    return [e && e.code, e && e.status, (e && e.message) || String(e)].filter(Boolean).join(' ');
  }

  // Una chiamata al modello: la risposta letta, o null (non partita, rotta, illeggibile). Chi ha servito va nei log.
  async function chiedi(action, messages, leggi, cosa, signal) {
    try {
      const r = await gate.complete({ action, messages, signal });
      const letto = leggi(r && r.text);
      log.log('[Filo L0]', cosa, 'riletto:', { servito: (r && r.servedBy) || 'sconosciuto', modello: (r && r.model) || '', casi: letto ? letto.length : 'risposta illeggibile' });
      return letto;
    } catch (e) {
      log.warn('[Filo L0]', cosa, 'non riletto, il feedback parte senza:', dettaglio(e));
      return null;
    }
  }

  function rileggiTesto(testo) {
    const k = String(testo);
    const c = cache.get(k);
    if (c && adesso() - c.at < CACHE_MS) return c.promessa;
    if (L().troppoLungo(k)) log.warn('[Filo L0] testo oltre il tetto: rileggo solo i primi', L().MAX_TESTO, 'caratteri');
    const promessa = chiedi(azioni.FEEDBACK_L0, L().richiestaTesto(k), (raw) => L().leggiTesto(raw, k), 'testo')
      .then((r) => {
        // Un fallimento non resta: all'invio si riprova.
        if (r === null && cache.get(k) && cache.get(k).promessa === promessa) cache.delete(k);
        return r;
      });
    cache.delete(k);
    cache.set(k, { promessa, at: adesso() });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return promessa;
  }

  // Mentre l'utente scrive: parte la rilettura del testo, che all'invio si ritrova pronta.
  async function anticipa(testo) {
    const t = String(testo == null ? '' : testo);
    if (!t.trim() || !(await acceso())) return false;
    rileggiTesto(t);
    return true;
  }

  // Quello che il passaggio verso i modelli nasconde il modello della rilettura non lo vede: qui si riconosce con le
  // stesse regole (pavimento della privacy e segreti custoditi anche travestiti), più carte e conti del guardiano.
  function trovatiSenzaModello(g, testo, custoditi) {
    let valori = [];
    let tratti = [];
    try { valori = (g.segretiNelTesto(testo) || []).filter((x) => x && x.valore); } catch (_) {}
    try {
      const P = globalThis.SN_PAVIMENTO || require('../../shared/pavimento.js');
      valori.push(...(P.trova(testo) || []).filter((x) => x && x.valore));
    } catch (_) {}
    try { tratti = g.trattiSegreti(testo, custoditi) || []; } catch (_) {}
    return { valori, tratti };
  }

  async function custoditi() {
    try {
      return ((await segreti()) || []).map((x) => (typeof x === 'string' ? { valore: x } : x)).filter(Boolean);
    } catch (_) { return []; }
  }

  async function statici(testo, allegati) {
    const g = G();
    if (!g) return [];
    const cs = await custoditi();
    const out = [];
    if (testo) {
      const { valori, tratti } = trovatiSenzaModello(g, testo, cs);
      out.push(...L().daValori(testo, valori), ...L().daTratti(testo, tratti));
    }
    allegati.forEach((a, k) => {
      if (a == null) return;
      const { valori, tratti } = trovatiSenzaModello(g, a, cs);
      out.push(...L().daAllegato(k, valori, tratti));
    });
    return out;
  }

  // → { stato: 'pulito' | 'trovato' | 'saltato', esito? }. Non lancia mai. `allegati`: i file del feedback
  // ({ name, type, dataUrl }); si rileggono quelli di testo, nell'indice che hanno nel feedback.
  async function controlla({ testo = '', immagini = [], allegati = [], entroMs = ATTESA_MS } = {}) {
    try {
      if (!(await acceso())) return { stato: 'saltato', motivo: 'spento' };
      const t = String(testo || '');
      const testiAllegati = (Array.isArray(allegati) ? allegati : []).map(testoDiAllegato);
      const imm = (Array.isArray(immagini) ? immagini : []).filter((u) => typeof u === 'string' && /^data:image\//i.test(u));
      const ferma = new AbortController();
      let timer = null;
      const scadenza = new Promise((r) => {
        timer = setTimeout(() => { ferma.abort(); r('scaduto'); }, entroMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
      });
      const entro = (p) => Promise.race([p, scadenza]);
      const parti = [
        statici(t, testiAllegati),
        t.trim() ? entro(rileggiTesto(t)) : Promise.resolve([]),
        imm.length ? entro(chiedi(azioni.FEEDBACK_L0_IMMAGINI, L().richiestaImmagini(t, imm), (raw) => L().leggiImmagini(raw, imm.length), 'immagini', ferma.signal)) : Promise.resolve([]),
      ];
      const [st, tx, im] = await Promise.all(parti);
      clearTimeout(timer);
      if (tx === 'scaduto' || im === 'scaduto') log.warn('[Filo L0] nessuna risposta entro', entroMs, 'ms: vale quello che è arrivato');
      const trovati = [...st, ...(Array.isArray(tx) ? tx : []), ...(Array.isArray(im) ? im : [])];
      if (trovati.length) {
        let rt = false;
        try { rt = !!redTeam(); } catch (_) {}
        return { stato: 'trovato', esito: L().esito(trovati, { redTeam: rt }) };
      }
      const nienteRiletto = (t.trim() && !Array.isArray(tx)) || (imm.length && !Array.isArray(im));
      return { stato: nienteRiletto ? 'saltato' : 'pulito' };
    } catch (e) {
      log.warn('[Filo L0] guasto, il feedback parte senza:', dettaglio(e));
      return { stato: 'saltato', motivo: 'guasto' };
    }
  }

  return { anticipa, controlla, _cache: cache };
}

// Il testo di un allegato che non è un'immagine né un PDF, o null: l'elenco dei tipi è quello del riquadro.
function testoDiAllegato(f) {
  try {
    if (!f || typeof f.dataUrl !== 'string') return null;
    const AT = globalThis.SN_FEEDBACK_ATTACH;
    const tipo = String(f.type || '').toLowerCase();
    if (AT && AT.classify({ name: f.name, type: tipo }) !== 'file') return null;
    if (tipo === 'application/pdf' || /\.pdf$/i.test(String(f.name || ''))) return null;
    const m = /^data:[^,]*?(;base64)?,/i.exec(f.dataUrl);
    if (!m) return null;
    const corpo = f.dataUrl.slice(m[0].length);
    return m[1] ? daByte(Buffer.from(corpo, 'base64')) : decodeURIComponent(corpo);
  } catch (_) { return null; }
}

// Windows salva testo anche in UTF-16 (PowerShell 5.1 con «>», il Visualizzatore eventi): letto come UTF-8 avrebbe
// uno zero fra una lettera e l'altra, e nessuna password si riconoscerebbe.
function daByte(b) {
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return Buffer.from(b.subarray(2)).swap16().toString('utf16le');
  const campione = b.subarray(0, 4096 - (Math.min(b.length, 4096) % 2));
  let pari = 0;
  let dispari = 0;
  for (let i = 0; i < campione.length; i++) if (campione[i] === 0) { if (i % 2) dispari++; else pari++; }
  const meta = campione.length / 2;
  if (meta >= 4 && dispari > meta * 0.3 && pari < meta * 0.05) return b.subarray(0, b.length - (b.length % 2)).toString('utf16le');
  if (meta >= 4 && pari > meta * 0.3 && dispari < meta * 0.05) return Buffer.from(b.subarray(0, b.length - (b.length % 2))).swap16().toString('utf16le');
  return b.toString('utf8');
}

// Lo stesso L0 per il riquadro e per la segnalazione confermata in chat: lo crea chi ha il cancello dei modelli.
let attivo = null;
function usa(l0) { attivo = l0 || null; }
function corrente() { return attivo; }

module.exports = { crea, ATTESA_MS, testoDiAllegato, usa, corrente };
