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
  // I 200 token della spec coi caratteri per token di SN_FILO_CONTESTO (la sentinella in schede.test.mjs li tiene uguali).
  const RIASSUNTO_MAX = 700;
  // Gli incroci confrontano i file probabili coi rami solo nella forma di git: un glob, una graffa, un numero di riga, un
  // percorso fuori dal repo non si confrontano, e una scheda che li porta non è buona.
  const FILE_NON_CONFRONTABILE = /[*?[\]{}]|:\d+(?::\d+)?$/;

  const numeroPulito = (n) => String(n == null ? '' : n).replace(/^#/, '');

  /** Un file probabile come lo scrive l'agente, nella forma che si confronta: barre normali, senza «./» in testa. PURA. */
  function fileNormale(p) {
    return String(p == null ? '' : p).trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^(\.\/)+/, '');
  }

  /** Il file (già normale, relativo alla radice) non si può confrontare coi rami: vuoto, fuori dal repo, glob o riga. PURA. */
  function fileStorto(v) {
    return !v || /^([A-Za-z]:|\/|~)/.test(v) || v.split('/').indexOf('..') >= 0 || FILE_NON_CONFRONTABILE.test(v);
  }

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
    testo('riassunto', RIASSUNTO_MAX);
    testo('prova', 1000);
    if (VALIDI.indexOf(s.valido) < 0) m.push(`«valido» deve essere uno fra ${VALIDI.join(', ')}`);
    if (TIPI.indexOf(s.tipo) < 0 && s.valido !== 'non letto') m.push(`«tipo» deve essere uno fra ${TIPI.join(', ')}`);
    if (AREE.indexOf(s.area) < 0 && s.valido !== 'non letto') m.push(`«area» deve essere una fra ${AREE.join(', ')}`);
    if (typeof s.urgente !== 'boolean') m.push('«urgente» deve essere true o false');
    elenco('file_probabili', 5);
    const storte = (Array.isArray(s.file_probabili) ? s.file_probabili : []).filter((f) => typeof f === 'string' && fileStorto(fileNormale(f)));
    if (storte.length) m.push(`«file_probabili» vuole un percorso per voce come lo stampa git, relativo alla radice (le cartelle finiscono con «/»), senza glob, graffe né numero di riga: non ${storte.slice(0, 3).map((f) => JSON.stringify(f)).join(', ')}`);
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
    VERSIONE, STATI_CHIUSI, VALIDI, TIPI, AREE, MAX_BYTE, RIASSUNTO_MAX,
    validaScheda, campiDellAgente, perIlDocumento, dalDocumento, numeroPulito, fileNormale, fileStorto,
  };

})(typeof globalThis !== 'undefined' ? globalThis : self);
