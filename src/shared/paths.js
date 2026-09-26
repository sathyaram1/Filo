// Raccolta percorsi dell'Aiuto (`paths`): lettura diretta da Firestore REST,
// UN DOMINIO ALLA VOLTA, e scrittura SOLO attraverso il server.
//
// Perché le due strade non sono simmetriche. La lettura serve all'agente Aiuto
// di chiunque, anche di chi non ha un account, e resta aperta. La scrittura no:
// è l'unico contenuto di Filo che un utente scrive e un ALTRO utente si ritrova
// nel prompt. Finché si scriveva di qui con la chiave pubblica del repo,
// chiunque poteva depositare un "percorso" per un dominio a scelta saltando la
// pulizia dell'app (audit pre-alpha, #585). Ora le regole non lasciano scrivere
// nessun client (firestore.rules → match /paths) e l'invio passa dalla callable
// `pathSubmit` del backend di sicurezza, che riapplica la pulizia condivisa
// (SN_PATHS_SAFETY.sanitizeSubmission) e tiene i limiti di frequenza per
// identità.
//
// APERTA NON VUOL DIRE INTERA (audit pre-alpha, #584). I percorsi stavano tutti
// in `paths/{doc}` con un `clientId` in chiaro dentro, e una sola query con la
// chiave web del repo — che è pubblica per design — li scaricava tutti: da lì
// si rimettevano insieme i percorsi della stessa persona su domini diversi, cioè
// il profilo di navigazione che tutto il resto dell'app si sforza di non far
// uscire. Chiudere la scrittura non toccava quella porta.
//
// Adesso il DOMINIO è un segmento del percorso Firestore
// (`paths/<dominio>/entries`) e non solo un campo: chiedere i percorsi vuol dire
// NOMINARE un dominio, e la raccolta intera non è più una cosa che si possa
// chiedere. L'altra metà sta nelle regole (blocco `match /paths/{domain}`), che
// chiudono in lettura la vecchia forma piatta e l'elenco dei domini.
//
// E nel documento non c'è più niente del mittente: né `clientId` né `userAgent`
// (vedi pathsSafety.js → sanitizeSubmission). L'ora che Firestore scrive da sé
// su ogni documento non la può togliere nessuna regola: la scolla dalla
// navigazione la coda di pathsCollector.js, che ritarda l'invio di ore.
//
// Espone SN_PATHS = { submit, listByDomain }.

(function (global) {
  'use strict';

  const PROJECT_ID = 'filo-8b9cb';
  const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
  const COLLECTION = 'paths';
  const SUBCOLLECTION = 'entries';

  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  // Tetto della `limit` accettato dalle regole per una lettura. Il client si
  // ferma prima da solo invece di farsi rifiutare la query: una richiesta più
  // grande viene ridotta a questo, non respinta.
  const MAX_PAGE_SIZE = 200;

  // Quanti percorsi si chiedono quando il chiamante non dice un numero. Il
  // prompt dell'Aiuto ne imbusta al massimo ventinove di dimensione normale
  // prima di finire il suo tetto di ventimila caratteri
  // (pathsSafety → KNOWN_PATHS_BUDGET_CHARS): chiederne cinquanta voleva dire
  // pagare venti letture che non arrivavano mai al modello (#679).
  const DEFAULT_PAGE_SIZE = 30;

  // Una copia in memoria per dominio. L'agente Aiuto rilegge i percorsi a OGNI
  // turno sulla stessa pagina, e ogni rilettura è `limit` letture di Firestore
  // (#679). La copia scade da sola, e un percorso nuovo spedito per quel
  // dominio la butta subito: chi ha appena insegnato una strada a Filo deve
  // ritrovarla, non aspettare il quarto d'ora.
  const CACHE_TTL_MS = 15 * 60 * 1000;
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
    // I siti che non sono di nessuno non si scrivono (pathsSafety.js →
    // sitoCondivisibile) e quindi non si leggono: una cartella come
    // `localhost` o `options` è la stessa per tutti e nessuno deve indovinarla,
    // quindi è l'unico posto dove un percorso depositato apposta arriverebbe
    // a chiunque apra l'Aiuto su una pagina locale o su una pagina di Filo
    // (#584, sesto giro). Senza il modulo di pulizia non si tira a indovinare:
    // non si legge e basta, come non si spedisce.
    const Safety = global.SN_PATHS_SAFETY;
    if (!Safety) return '';
    // Il punto finale della forma assoluta si toglie qui come si toglie in
    // scrittura: `esempio.it.` e `esempio.it` sono lo stesso sito, e senza
    // questa riga la lettura cercherebbe in una cartella dove il server non
    // scrive mai (#584, settimo giro).
    const d = Safety._internal.normalizzaHost(domain);
    if (ID_RISERVATO_RE.test(d)) return '';
    // `sanitizeDomain` risponde con la stessa regola di chi salva: forma del
    // nome, lunghezza massima e siti che non sono di nessuno, tutto insieme.
    return Safety._internal.sanitizeDomain(d);
  }

  // Base delle Cloud Function callable del backend di sicurezza (filo-security):
  // stessa region/progetto degli altri canali (auth, wallet, redteam). Override
  // per i test via env, come là.
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

  // Invia un percorso al server, che lo ripulisce di nuovo e lo scrive.
  //
  // `idToken` è l'identità su cui il server tiene i limiti di frequenza, e la
  // manda OGNI installazione: è il token dell'account anonimo che Filo si crea
  // da sé (quello di crediti e portafoglio), non quello del login Google, che
  // è opzionale. Il mittente resta anonimo lo stesso: l'identità viaggia
  // ACCANTO al documento e non ci entra, perché la raccolta la legge chiunque.
  //
  // `clientId` è il ripiego dichiarato nel contratto della callable (vedi
  // SECURITY.md §8) per una richiesta che arrivasse senza token: oggi Filo non
  // ne genera uno e lo manda vuoto, perché un identificativo che si dichiara
  // da solo non regge un limite di frequenza — chi attacca ne scrive un altro.
  async function submit({ domain, initialUrl, intent, steps, success, clientId, idToken }) {
    const Safety = global.SN_PATHS_SAFETY;
    // Senza il modulo di pulizia non si spedisce: un ripiego che manda il
    // percorso così com'è sarebbe la porta di prima, aperta da un errore di
    // caricamento invece che da una regola.
    if (!Safety) throw new Error('SN_PATHS_SAFETY non caricato: percorso non inviato');
    // La stessa pulizia che rifarà il server: quello che non passa di qui non
    // vale la pena spedirlo.
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

  // Legge i percorsi di UN dominio, dal più recente. La query gira SOTTO
  // `paths/<dominio>`: non c'è nessun filtro `domain == …` da scrivere, ed è
  // questo che rende impossibile chiederli tutti — una query di gruppo su
  // `entries` le regole la negano, perché non esiste nessun match ricorsivo che
  // la autorizzi.
  //
  // L'esito (`success`) lo filtra IL SERVER. Filtrandolo qui, su una pagina di
  // percorsi recenti, un sito con tanti pollice in giù recenti lasciava
  // l'assistente senza niente da riusare pur avendo percorsi buoni più vecchi.
  // Il `where` vuole un indice composto (`firestore.indexes.json`): se la query
  // filtrata fallisce — indice non ancora pubblicato — si ritenta subito quella
  // semplice e si filtra qui. Così l'indice mancante costa una richiesta in
  // più, non la funzione.
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
