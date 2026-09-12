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
  async function submit({ domain, initialUrl, intent, steps, success, userAgent, clientId, idToken }) {
    const Safety = global.SN_PATHS_SAFETY;
    // Senza il modulo di pulizia non si spedisce: un ripiego che manda il
    // percorso così com'è sarebbe la porta di prima, aperta da un errore di
    // caricamento invece che da una regola.
    if (!Safety) throw new Error('SN_PATHS_SAFETY non caricato: percorso non inviato');
    // La stessa pulizia che rifarà il server: quello che non passa di qui non
    // vale la pena spedirlo.
    const pulito = Safety.sanitizeSubmission({ domain, initialUrl, intent, steps, success, userAgent });
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
