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

  // Il dominio diventa l'ID di un documento: fuori dalla forma di un host si torna stringa
  // vuota, non qualcosa di simile. La FORMA la decide `sanitizeDomain`, la stessa che salva.
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
