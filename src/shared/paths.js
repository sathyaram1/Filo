// Raccolta percorsi dell'Aiuto (`paths`): lettura diretta da Firestore REST,
// scrittura SOLO attraverso il server.
//
// Perché le due strade non sono simmetriche. La lettura è pubblica per
// costruzione (i percorsi servono all'agente Aiuto di chiunque). La scrittura
// no: è l'unico contenuto di Filo che un utente scrive e un ALTRO utente si
// ritrova nel prompt. Finché si scriveva di qui con la chiave pubblica del
// repo, chiunque poteva depositare un "percorso" per un dominio a scelta
// saltando la pulizia dell'app (audit pre-alpha, #585). Ora le regole non
// lasciano scrivere nessun client (firestore.rules → match /paths) e l'invio
// passa dalla callable `pathSubmit` del backend di sicurezza, che riapplica la
// pulizia condivisa (SN_PATHS_SAFETY.sanitizeSubmission) e tiene i limiti di
// frequenza per identità.
//
// Espone SN_PATHS = { submit, listByDomain }.

(function (global) {
  'use strict';

  const PROJECT_ID = 'filo-8b9cb';
  const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
  const COLLECTION = 'paths';

  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  // Base delle Cloud Function callable del backend di sicurezza (filo-security):
  // stessa region/progetto degli altri canali (auth, wallet, redteam). Override
  // per i test via env, come là.
  const FUNCTIONS_BASE = (typeof process !== 'undefined' && process.env && process.env.FILO_FUNCTIONS_BASE)
    || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
  const SUBMIT_FUNCTION = 'pathSubmit';

  function toFsValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (Array.isArray(v)) {
      return { arrayValue: { values: v.map(toFsValue) } };
    }
    if (typeof v === 'object') {
      const fields = {};
      for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv);
      return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
  }

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

  // Crea un documento `paths`. I campi corrispondono allo schema di
  // firestore.rules. `steps` è un array di {selector, action, retracted}.
  async function submit({ domain, initialUrl, intent, steps, success, userAgent, clientId }) {
    const doc = {
      fields: {
        domain: toFsValue(domain || ''),
        initialUrl: toFsValue(initialUrl || ''),
        intent: toFsValue(intent || ''),
        steps: toFsValue(Array.isArray(steps) ? steps : []),
        success: toFsValue(!!success),
        userAgent: toFsValue(userAgent || ''),
        clientId: toFsValue(clientId || ''),
        createdAt: { timestampValue: new Date().toISOString() },
      },
    };
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}?key=${API_KEY}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore create paths fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const json = await res.json();
    return { id: json.name?.split('/').pop() || '' };
  }

  // Lista i path di un dominio specifico, ordinati per recency. Usata in
  // futuro dal consumer (sidebar Aiuto) per arricchire il prompt.
  async function listByDomain(domain, { pageSize = 50, onlySuccess = true } = {}) {
    if (!domain) return [];
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const filters = [
      { fieldFilter: { field: { fieldPath: 'domain' }, op: 'EQUAL', value: { stringValue: domain } } },
    ];
    if (onlySuccess) {
      filters.push({ fieldFilter: { field: { fieldPath: 'success' }, op: 'EQUAL', value: { booleanValue: true } } });
    }
    const where = filters.length === 1
      ? filters[0]
      : { compositeFilter: { op: 'AND', filters } };
    const body = {
      structuredQuery: {
        from: [{ collectionId: COLLECTION }],
        where,
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
        limit: pageSize,
      },
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore list paths fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const arr = await res.json();
    const out = [];
    for (const row of arr) {
      if (!row.document) continue;
      out.push(fsDocToObject(row.document));
    }
    return out;
  }

  global.SN_PATHS = {
    submit,
    listByDomain,
    configPublic: { projectId: PROJECT_ID, collection: COLLECTION },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
