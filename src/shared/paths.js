// Raccolta percorsi dell'Aiuto: lettura da Firestore UN DOMINIO ALLA VOLTA, scrittura SOLO
// dalla callable `pathSubmit`, che tiene i limiti di frequenza (la pulizia: pathsSafety.js).
// Il dominio è un SEGMENTO del percorso, così non si può scaricare l'archivio intero.

(function (global) {
  'use strict';

  const PROJECT_ID = 'filo-8b9cb';
  const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
  const COLLECTION = 'paths';
  const SUBCOLLECTION = 'entries';

  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  // Tetto della `limit` accettato dalle regole: il client si ferma prima da solo invece di
  // farsi rifiutare la query.
  const MAX_PAGE_SIZE = 200;

  // Quanti percorsi si chiedono quando il chiamante non dice un numero. Il
  // tetto del prompt (pathsSafety → KNOWN_PATHS_BUDGET_CHARS) ne tiene
  // quarantotto lunghi otto passi e centotrentacinque corti: abbassare qui a
  // trenta toglieva all'Aiuto strade che nel messaggio ci sarebbero entrate,
  // e con la copia in memoria le letture risparmiate erano poche decine
  // all'ora (#679, primo giro). Il numero si misura, non si indovina:
  // tests/unit/percorsiCopiaInMemoria.test.mjs.
  const DEFAULT_PAGE_SIZE = 50;

  // Una copia in memoria per dominio. L'agente Aiuto rilegge i percorsi a OGNI
  // turno sulla stessa pagina, e ogni rilettura è `limit` letture di Firestore
  // (#679). La copia scade da sola, e un percorso nuovo spedito per quel
  // dominio la butta subito: chi ha appena insegnato una strada a Filo deve
  // ritrovarla, non aspettare il quarto d'ora.
  const CACHE_TTL_MS = 15 * 60 * 1000;
  // Quanti domini si tengono insieme. Serve solo a non far crescere la memoria
  // di una sessione lunghissima: chi apre l'Aiuto su duecento siti diversi
  // nello stesso quarto d'ora non esiste, e a chi ci arrivasse costa una
  // rilettura.
  const CACHE_MAX_DOMINI = 200;
  const cache = new Map();
  let adesso = () => Date.now();

  function chiaveCache(dominio, limit, onlySuccess) {
    return `${dominio}\u0000${limit}\u0000${onlySuccess ? 1 : 0}`;
  }

  // Butta tutte le varianti (limiti, filtro esito) di un dominio: chi invalida
  // sa il dominio, non con che parametri qualcun altro l'ha chiesto.
  function invalidaDominio(domain) {
    const Safety = global.SN_PATHS_SAFETY;
    const d = Safety ? Safety._internal.normalizzaHost(domain) : String(domain || '').toLowerCase();
    if (!d) return;
    const prefisso = `${d}\u0000`;
    for (const k of Array.from(cache.keys())) {
      if (k.startsWith(prefisso)) cache.delete(k);
    }
  }

  // Il dominio diventa l'ID di un documento Firestore: deve essere un nome di
  // host e nient'altro. Fuori da questo insieme (una barra, uno spazio, un ID
  // riservato `__…__`) non si ripiega su qualcosa di simile: si torna stringa
  // vuota e il chiamante non legge niente. Un dominio "quasi giusto" leggerebbe
  // percorsi da un posto dove non ce n'è mai stato nessuno.
  //
  // La FORMA del nome non si riscrive qui: la decide la stessa pulizia che
  // salva (`sanitizeDomain`), o le due porte divergono. Divergevano: un nome
  // col trattino basso dentro (`mio_sito.it`) o che comincia con un trattino
  // non si può salvare, ma si poteva chiedere, e la richiesta partiva verso una
  // cartella destinata a restare vuota per sempre (#584, nono giro). Questa
  // riga tiene solo il vincolo in più che viene da Firestore, cioè gli ID
  // riservati.
  const ID_RISERVATO_RE = /^__.*__$/;

  function segmentoDominio(domain) {
    // I siti che non sono di nessuno non si scrivono e quindi non si leggono: `localhost` è la
    // stessa cartella per tutti. Senza il modulo di pulizia non si legge, come non si spedisce.
    const Safety = global.SN_PATHS_SAFETY;
    if (!Safety) return '';
    // Il punto finale si toglie come in scrittura: `esempio.it.` ed `esempio.it` sono lo stesso
    // sito, e senza si leggerebbe da una cartella dove il server non scrive mai.
    const d = Safety._internal.normalizzaHost(domain);
    if (ID_RISERVATO_RE.test(d)) return '';
    // `sanitizeDomain` risponde con la stessa regola di chi salva: forma del nome, lunghezza
    // massima e siti che non sono di nessuno, tutto insieme.
    return Safety._internal.sanitizeDomain(d);
  }

  // Callable del backend di sicurezza (filo-security): stessa region/progetto degli altri
  // canali (auth, wallet, redteam), override per i test via env come là.
  const FUNCTIONS_BASE = (typeof process !== 'undefined' && process.env && process.env.FILO_FUNCTIONS_BASE)
    || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
  const SUBMIT_FUNCTION = 'pathSubmit';

  function fromFsValue(val) {
    if (!val) return null;
    if ('stringValue' in val) return val.stringValue;
    if ('integerValue' in val) return Number(val.integerValue);
    if ('doubleValue' in val) return val.doubleValue;
    if ('booleanValue' in val) return val.booleanValue;
    if ('timestampValue' in val) return val.timestampValue;
    if ('nullValue' in val) return null;
    if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFsValue);
    if ('mapValue' in val) {
      const out = {};
      for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fromFsValue(v);
      return out;
    }
    return null;
  }

  function fsDocToObject(doc) {
    const out = {};
    for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFsValue(v);
    out._id = doc.name?.split('/').pop() || '';
    out._createTime = doc.createTime || null;
    return out;
  }

  // `idToken` è l'identità su cui il server tiene i limiti (account anonimo, non il login
  // Google): viaggia ACCANTO al documento, che legge chiunque. `clientId` resta vuoto.
  async function submit({ domain, initialUrl, intent, steps, success, clientId, idToken }) {
    const Safety = global.SN_PATHS_SAFETY;
    // Senza il modulo di pulizia non si spedisce: un ripiego che manda il percorso com'è
    // sarebbe la porta di prima, aperta da un errore di caricamento invece che da una regola.
    if (!Safety) throw new Error('SN_PATHS_SAFETY non caricato: percorso non inviato');
    // Ciò che non passa la pulizia qui non vale la pena spedirlo.
    const pulito = Safety.sanitizeSubmission({ domain, initialUrl, intent, steps, success });
    if (!pulito.ok) throw new Error(`percorso scartato prima dell'invio: ${pulito.reason}`);

    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const res = await fetch(`${FUNCTIONS_BASE}/${SUBMIT_FUNCTION}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: { ...pulito.doc, clientId: clientId || '' } }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch (_) {}
      throw new Error(`pathSubmit ${res.status}${detail ? ': ' + detail : ''}`);
    }
    const body = await res.json().catch(() => null);
    const r = body && body.result;
    if (!r || r.saved === false) {
      throw new Error(`pathSubmit ha rifiutato il percorso: ${(r && r.reason) || 'motivo non dichiarato'}`);
    }
    // Il percorso appena insegnato deve tornare al turno dopo, non fra un
    // quarto d'ora: la copia in memoria di questo dominio non vale più.
    invalidaDominio(pulito.doc && pulito.doc.domain);
    return { id: (r && r.id) || '' };
  }

  // La query gira SOTTO `paths/<dominio>`: senza filtro `domain == …`, ed è questo che rende
  // impossibile chiederli tutti. L'esito lo filtra IL SERVER; senza indice si ritenta qui.
  function corpoQuery({ limit, onlySuccess }) {
    const q = {
      from: [{ collectionId: SUBCOLLECTION }],
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit,
    };
    if (onlySuccess) {
      q.where = { fieldFilter: { field: { fieldPath: 'success' }, op: 'EQUAL', value: { booleanValue: true } } };
    }
    return { structuredQuery: q };
  }

  async function chiedi(dominio, corpo) {
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(dominio)}:runQuery?key=${API_KEY}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore list paths fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    return res.json();
  }

  async function listByDomain(domain, { pageSize = DEFAULT_PAGE_SIZE, onlySuccess = true } = {}) {
    const dominio = segmentoDominio(domain);
    if (!dominio) return [];
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(pageSize) || DEFAULT_PAGE_SIZE));

    const chiave = chiaveCache(dominio, limit, onlySuccess);
    const inCache = cache.get(chiave);
    if (inCache && adesso() - inCache.ts < CACHE_TTL_MS) return inCache.righe.slice();

    let arr;
    try {
      arr = await chiedi(dominio, corpoQuery({ limit, onlySuccess }));
    } catch (e) {
      let secondo = e;
      if (onlySuccess) {
        try {
          arr = await chiedi(dominio, corpoQuery({ limit, onlySuccess: false }));
          secondo = null;
        } catch (e2) { secondo = e2; }
      }
      if (secondo) {
        // Una rete che cade non cancella la copia buona: scaduta è comunque
        // meglio del nulla, e l'errore resta un errore solo se non c'è niente
        // da servire.
        if (inCache) return inCache.righe.slice();
        throw secondo;
      }
    }

    const out = [];
    for (const row of Array.isArray(arr) ? arr : []) {
      if (!row.document) continue;
      const obj = fsDocToObject(row.document);
      if (onlySuccess && obj.success !== true) continue;
      out.push(obj);
    }
    // La Map rende le chiavi in ordine d'inserimento: la più vecchia è la prima.
    if (cache.size >= CACHE_MAX_DOMINI) cache.delete(cache.keys().next().value);
    cache.set(chiave, { ts: adesso(), righe: out });
    return out.slice();
  }

  global.SN_PATHS = {
    submit,
    listByDomain,
    configPublic: { projectId: PROJECT_ID, collection: COLLECTION, subcollection: SUBCOLLECTION },
    invalidaDominio,
    rest: { FIRESTORE_BASE, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, CACHE_TTL_MS },
    _internal: {
      segmentoDominio, corpoQuery,
      svuotaCache: () => cache.clear(),
      // L'orologio si sostituisce solo nei test: far scadere una copia di un
      // quarto d'ora aspettandola davvero non è una prova che si possa correre.
      _setAdesso: (fn) => { adesso = typeof fn === 'function' ? fn : Date.now; },
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
