// Raccolta percorsi dell'Aiuto: lettura diretta da Firestore REST UN DOMINIO ALLA VOLTA,
// scrittura SOLO attraverso il server. La lettura serve all'agente di chiunque, anche senza
// account, e resta aperta; la scrittura no — è l'unico contenuto che un utente scrive e un
// ALTRO si ritrova nel prompt, e con la chiave pubblica del repo chiunque poteva depositare
// un percorso saltando la pulizia (#585): ora passa dalla callable `pathSubmit`, che
// riapplica SN_PATHS_SAFETY.sanitizeSubmission e tiene i limiti di frequenza.
// Aperta non vuol dire intera (#584): con tutto in `paths/{doc}` e un `clientId` dentro, una
// sola query scaricava l'archivio e rimetteva insieme i percorsi della stessa persona su
// domini diversi, cioè il profilo di navigazione. Ora il dominio è un SEGMENTO del percorso
// (`paths/<dominio>/entries`): chiederli vuol dire nominare un dominio, e nel documento non
// c'è più niente del mittente. L'ora che Firestore scrive da sé la scolla dalla navigazione
// la coda di pathsCollector.js, che ritarda l'invio di ore.

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

  // Il dominio diventa l'ID di un documento Firestore: fuori dalla forma di un host non si
  // ripiega su qualcosa di simile ma si torna stringa vuota, perché un dominio «quasi giusto»
  // leggerebbe da una cartella dove non c'è mai stato niente. La FORMA la decide la stessa
  // pulizia che salva (`sanitizeDomain`), o le due porte divergono come già successo (#584):
  // qui resta solo il vincolo in più di Firestore, gli ID riservati `__…__`.
  const ID_RISERVATO_RE = /^__.*__$/;

  function segmentoDominio(domain) {
    // I siti che non sono di nessuno non si scrivono (pathsSafety.js → sitoCondivisibile) e
    // quindi non si leggono: `localhost` o `options` è la stessa cartella per tutti, l'unico
    // posto dove un percorso depositato apposta arriverebbe a chiunque apra l'Aiuto lì (#584).
    // Senza il modulo di pulizia non si tira a indovinare: non si legge, come non si spedisce.
    const Safety = global.SN_PATHS_SAFETY;
    if (!Safety) return '';
    // Il punto finale della forma assoluta si toglie come in scrittura: `esempio.it.` ed
    // `esempio.it` sono lo stesso sito, e senza questa riga si leggerebbe da una cartella dove
    // il server non scrive mai.
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

  // `idToken` è l'identità su cui il server tiene i limiti di frequenza, e la manda ogni
  // installazione: è il token dell'account anonimo che Filo si crea da sé, non il login
  // Google, che è opzionale. Viaggia ACCANTO al documento e non ci entra, perché la raccolta
  // la legge chiunque. `clientId` è il ripiego dichiarato nel contratto (SECURITY.md §8) e
  // oggi resta vuoto: un identificativo che si dichiara da solo non regge un limite di
  // frequenza, chi attacca ne scrive un altro.
  async function submit({ domain, initialUrl, intent, steps, success, clientId, idToken }) {
    const Safety = global.SN_PATHS_SAFETY;
    // Senza il modulo di pulizia non si spedisce: un ripiego che manda il percorso com'è
    // sarebbe la porta di prima, aperta da un errore di caricamento invece che da una regola.
    if (!Safety) throw new Error('SN_PATHS_SAFETY non caricato: percorso non inviato');
    // La stessa pulizia che rifarà il server: ciò che non passa di qui non vale la pena spedirlo.
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
    return { id: (r && r.id) || '' };
  }

  // Legge i percorsi di UN dominio, dal più recente. La query gira SOTTO `paths/<dominio>`:
  // non c'è nessun filtro `domain == …` da scrivere, ed è questo che rende impossibile
  // chiederli tutti (una query di gruppo su `entries` le regole la negano). L'esito lo filtra
  // IL SERVER: filtrandolo qui, un sito con tanti pollice in giù recenti lasciava l'assistente
  // senza niente da riusare pur avendo percorsi buoni più vecchi. Il `where` vuole un indice
  // composto: se fallisce perché non è ancora pubblicato si ritenta la query semplice e si
  // filtra qui, così l'indice mancante costa una richiesta in più, non la funzione.
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

  async function listByDomain(domain, { pageSize = 50, onlySuccess = true } = {}) {
    const dominio = segmentoDominio(domain);
    if (!dominio) return [];
    const limit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(pageSize) || 50));

    let arr;
    try {
      arr = await chiedi(dominio, corpoQuery({ limit, onlySuccess }));
    } catch (e) {
      if (!onlySuccess) throw e;
      arr = await chiedi(dominio, corpoQuery({ limit, onlySuccess: false }));
    }

    const out = [];
    for (const row of Array.isArray(arr) ? arr : []) {
      if (!row.document) continue;
      const obj = fsDocToObject(row.document);
      if (onlySuccess && obj.success !== true) continue;
      out.push(obj);
    }
    return out;
  }

  global.SN_PATHS = {
    submit,
    listByDomain,
    configPublic: { projectId: PROJECT_ID, collection: COLLECTION, subcollection: SUBCOLLECTION },
    rest: { FIRESTORE_BASE, MAX_PAGE_SIZE },
    _internal: { segmentoDominio, corpoQuery },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
