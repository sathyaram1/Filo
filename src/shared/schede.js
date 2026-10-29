// Le schede dei feedback per il manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): campi, validazione e forma della scheda salvata
// nel feedback. Unica fonte per gli script dell'app e per il server (bake-shared → functions/src/routine/schedeCondivise.js).
// Prove: tests/unit/schede.test.mjs e functions/test/schede-lettura-1785.test.js.

(function (global) {
  'use strict';

  // La forma della scheda salvata nel feedback: cambia quando cambiano i campi, e chi legge una versione che non sa la dice.
  const VERSIONE = 1;
  const STATI_CHIUSI = Object.freeze(['done', 'archived', 'attack_confirmed', 'spam_confirmed']);
  const VALIDI = Object.freeze(['si', 'no', 'dubbio', 'non letto']);
  const TIPI = Object.freeze(['bug', 'feature', 'design', 'processo', 'sicurezza', 'documento']);
  const AREE = Object.freeze(['chat-filo', 'home', 'editor', 'browser-schede', 'impostazioni', 'gestione-owner', 'feedback-app',
    'server-filo-security', 'routine-script', 'test', 'sito', 'pacchetti-rilasci', 'deck-builder', 'altro']);
  // Una scheda sta sotto i 200 token di riassunto: 32 KB serializzata sono dieci volte il massimo dei suoi campi.
  const MAX_BYTE = 32 * 1024;

  const numeroPulito = (n) => String(n == null ? '' : n).replace(/^#/, '');

  /** I motivi per cui una scheda non è buona (vuoto = buona). PURA. */
  function validaScheda(s, num) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return ['non è un oggetto JSON'];
    const m = [];
    const testo = (k, max) => {
      if (typeof s[k] !== 'string' || !s[k].trim()) m.push(`manca «${k}»`);
      else if (max && s[k].length > max) m.push(`«${k}» è lungo ${s[k].length} caratteri, il massimo è ${max}`);
    };
    const elenco = (k, max) => {
      if (!Array.isArray(s[k]) || s[k].some((x) => typeof x !== 'string')) m.push(`«${k}» non è un elenco di testi`);
      else if (max && s[k].length > max) m.push(`«${k}» ha ${s[k].length} voci, il massimo è ${max}`);
    };
    if (numeroPulito(s.numero) !== numeroPulito(num)) m.push(`«numero» è ${JSON.stringify(s.numero)}, non ${num}`);
    testo('titolo_breve', 80);
    testo('riassunto', 2000);
    testo('prova', 1000);
    if (VALIDI.indexOf(s.valido) < 0) m.push(`«valido» deve essere uno fra ${VALIDI.join(', ')}`);
    if (TIPI.indexOf(s.tipo) < 0 && s.valido !== 'non letto') m.push(`«tipo» deve essere uno fra ${TIPI.join(', ')}`);
    if (AREE.indexOf(s.area) < 0 && s.valido !== 'non letto') m.push(`«area» deve essere una fra ${AREE.join(', ')}`);
    if (typeof s.urgente !== 'boolean') m.push('«urgente» deve essere true o false');
    elenco('file_probabili', 5);
    elenco('doppione_di');
    elenco('parole_chiave', 10);
    if (s.risolto_su_main !== null && typeof s.risolto_su_main !== 'string') m.push('«risolto_su_main» è uno sha con la riga, o null');
    if (s.valido === 'no' && !String(s.prova || '').trim()) m.push('«valido: no» vuole la prova');
    return m;
  }

  /** I campi dell'agente, senza quelli che timbra chi salva (`_fonte`, `_riletta`, …). PURA. */
  function campiDellAgente(s) {
    const out = {};
    for (const k of Object.keys(s || {})) if (k.charAt(0) !== '_') out[k] = s[k];
    return out;
  }

  /**
   * Quello che si cifra nel feedback: i campi, lo stato da cui la scheda è nata, la rilettura e chi l'ha scritta. `aggiornato`
   * non c'è: è l'ora della scrittura stessa, che il feedback tiene accanto in chiaro (`schedaAt`). PURA.
   */
  function perIlDocumento(s, { stato = '', at = '', modello = '', rilettura = false, fiducia = '', scrittaDa = '' } = {}) {
    return {
      v: VERSIONE,
      campi: campiDellAgente(s),
      fonte: { stato: String(stato || ''), at: String(at || ''), modello: String(modello || '') },
      ...(rilettura ? { riletta: { at: String(at || ''), modello: String(modello || '') } } : {}),
      fiducia: fiducia === 'fidato' ? 'fidato' : 'non_fidato',
      scrittaDa: String(scrittaDa || ''),
    };
  }

  /**
   * La scheda salvata nel feedback nella forma dei file della cartella delle schede: `aggiornato` è l'ora della scrittura,
   * uguale all'aggiornamento del feedback finché nessuno lo tocca. null se la versione non è questa. PURA.
   */
  function dalDocumento(d, { id = '', aggiornato = '' } = {}) {
    if (!d || typeof d !== 'object' || d.v !== VERSIONE || !d.campi || typeof d.campi !== 'object') return null;
    const f = d.fonte || {};
    const out = Object.assign({}, campiDellAgente(d.campi), {
      _fonte: { id: String(id), stato: String(f.stato || ''), aggiornato: String(aggiornato || ''), at: String(f.at || ''), modello: String(f.modello || '') },
      _fiducia: d.fiducia === 'fidato' ? 'fidato' : 'non_fidato',
    });
    if (d.riletta && typeof d.riletta === 'object') out._riletta = { at: String(d.riletta.at || ''), modello: String(d.riletta.modello || '') };
    return out;
  }

  global.SN_SCHEDE = {
    VERSIONE, STATI_CHIUSI, VALIDI, TIPI, AREE, MAX_BYTE,
    validaScheda, campiDellAgente, perIlDocumento, dalDocumento,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
