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
      return !(s && s.feedbackL0 && s.feedbackL0.enabled === false);
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

  // I segreti che si riconoscono senza modello: chiavi, password annunciate, quelli che Filo custodisce.
  async function statici(testo) {
    const g = G();
    if (!g || !testo) return [];
    const valori = [];
    try { for (const x of g.segretiNelTesto(testo) || []) if (x && x.valore) valori.push(x.valore); } catch (_) {}
    try {
      for (const x of (await segreti()) || []) {
        const sg = typeof x === 'string' ? { valore: x } : x;
        const { v, min } = g.segretoDi(sg);
        if (v && v.length >= min && testo.includes(v)) valori.push(v);
      }
    } catch (_) {}
    return L().daValori(testo, valori);
  }

  // → { stato: 'pulito' | 'trovato' | 'saltato', esito? }. Non lancia mai.
  async function controlla({ testo = '', immagini = [], entroMs = ATTESA_MS } = {}) {
    try {
      if (!(await acceso())) return { stato: 'saltato', motivo: 'spento' };
      const t = String(testo || '');
      const imm = (Array.isArray(immagini) ? immagini : []).filter((u) => typeof u === 'string' && /^data:image\//i.test(u));
      const ferma = new AbortController();
      let timer = null;
      const scadenza = new Promise((r) => {
        timer = setTimeout(() => { ferma.abort(); r('scaduto'); }, entroMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
      });
      const entro = (p) => Promise.race([p, scadenza]);
      const parti = [
        statici(t),
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

module.exports = { crea, ATTESA_MS };
