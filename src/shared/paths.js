// Client Firestore REST per i percorsi condivisi dell'Aiuto (collezione
// `paths`). Stesso progetto Firebase usato dai feedback.
//
// Pattern uguale a SN_FEEDBACK ma molto più ridotto: niente upload immagini,
// solo create + lettura per dominio.  Funziona sia da service worker sia da
// pagina.
//
// COSA C'È DENTRO UN PERCORSO, e cosa NON c'è (audit pre-alpha, #584).
// Un documento dice: da che punto del sito si parte, qual è l'intento, quali
// azioni portano a farlo, se è andata bene. Non dice CHI l'ha fatto: niente
// clientId, niente user agent, e l'ora è arrotondata (vedi `oraArrotondata`).
// Il motivo sta tutto in una riga: per riusare un percorso non serve sapere
// chi l'ha percorso, e finché un identificativo del mittente c'è, qualcuno
// può ricucire i percorsi della stessa persona su domini diversi.
//
// Per lo stesso motivo il DOMINIO è un segmento del percorso Firestore
// (`paths/<dominio>/entries`) e non un campo: chiedere i percorsi vuol dire
// nominare un dominio, e la collezione intera non è più una cosa che si possa
// scaricare. Le regole (firestore.rules, blocco `match /paths/{domain}`) sono
// l'altra metà: lì la vecchia forma piatta è chiusa in lettura.
//
// Espone SN_PATHS = { submit, listByDomain, formatForPrompt }.

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

  // Quanto testo di percorsi già riusciti può entrare nel prompt dell'agente
  // di pagina.
  const PROMPT_BUDGET_CHARS = 20 * 1024;

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

  // Il dominio diventa l'ID di un documento Firestore: deve essere un nome di
  // host e nient'altro. Fuori da questo insieme (una barra, uno spazio, un ID
  // riservato `__…__`) non si ripiega su qualcosa di simile: si torna stringa
  // vuota e il chiamante non scrive/legge niente. Un dominio "quasi giusto"
  // scriverebbe percorsi in un posto dove nessuno andrà mai a leggerli.
  const DOMINIO_VALIDO = /^[a-z0-9._-]{1,253}$/;

  function segmentoDominio(domain) {
    const d = String(domain || '').trim().toLowerCase();
    if (!DOMINIO_VALIDO.test(d)) return '';
    if (d === '.' || d === '..') return '';
    if (d.startsWith('__') && d.endsWith('__')) return '';
    return d;
  }

  // La data del percorso, arrotondata al GIORNO. A chi riusa un percorso serve
  // sapere se è fresco, perché i siti cambiano e i selettori invecchiano: il
  // giorno risponde a quella domanda. L'ora, il minuto e il secondo rispondono
  // a un'altra, che non deve avere risposta — due percorsi salvati su domini
  // diversi nello stesso momento sono della stessa persona.
  //
  // Era l'ora piena (#584, primo giro) e non bastava: con pochi utenti una
  // fascia oraria contiene spesso i percorsi di una persona sola, e quella da
  // sola ricuce. Il giorno mette nello stesso mucchio tutti quelli di tutti.
  function giornoArrotondato(ms) {
    const t = Number.isFinite(ms) ? ms : Date.now();
    const GIORNO = 24 * 60 * 60 * 1000;
    return new Date(Math.floor(t / GIORNO) * GIORNO).toISOString();
  }

  function urlCollezione(domain) {
    return `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(domain)}/${SUBCOLLECTION}`;
  }

  function urlQuery(domain) {
    return `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(domain)}:runQuery`;
  }

  // Crea un percorso sotto il suo dominio. I campi corrispondono allo schema di
  // firestore.rules. `steps` è un array di {selector, action, retracted}.
  // NON accetta identificativi del mittente: non è una dimenticanza, è il
  // punto (vedi la testata).
  async function submit({ domain, initialUrl, intent, steps, success, now }) {
    const dominio = segmentoDominio(domain);
    if (!dominio) throw new Error(`dominio non valido per un percorso: ${String(domain).slice(0, 80)}`);
    const doc = {
      fields: {
        initialUrl: toFsValue(initialUrl || ''),
        intent: toFsValue(intent || ''),
        steps: toFsValue(Array.isArray(steps) ? steps : []),
        success: toFsValue(!!success),
        createdAt: { timestampValue: giornoArrotondato(now) },
      },
    };
    const endpoint = `${urlCollezione(dominio)}?key=${API_KEY}`;
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

  // Legge i percorsi di UN dominio, dal più recente. La query gira sotto
  // `paths/<dominio>`: non c'è nessun filtro `domain == …` da scrivere, ed è
  // questo che rende impossibile chiederli tutti.
  //
  // L'esito (`success`) lo filtra IL SERVER. Filtrandolo qui, su una pagina di
  // percorsi recenti, un sito con tanti pollice in giù recenti lasciava
  // l'assistente senza niente da riusare pur avendo percorsi buoni più vecchi.
  // Il `where` vuole un indice composto (`firestore.indexes.json`), e il timore
  // era che senza indice la lettura fallisse in silenzio: per questo se la
  // query filtrata fallisce si ritenta subito quella semplice, filtrando qui.
  // Così l'indice mancante costa una richiesta in più, non la funzione.
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
    const res = await fetch(`${urlQuery(dominio)}?key=${API_KEY}`, {
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
      // Indice non ancora pubblicato (o query rifiutata): ripiego sulla query
      // semplice e filtro qui. Peggio della prima strada, molto meglio di zero.
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

  // ---------------------------------------------------------------------
  // Dal documento al prompt: i "percorsi già riusciti" che l'agente di pagina
  // si trova nel messaggio di sistema. Sta qui, accanto alla lettura, perché
  // è l'altra metà dello stesso cammino — e perché così si prova con un unit
  // test, senza accendere Electron.

  function clusterKey(p) {
    const init = (p && p.initialUrl) || '';
    const steps = Array.isArray(p && p.steps) ? p.steps : [];
    const sig = steps.map((s) => `${(s && s.action) || 'click'}|${(s && s.selector) || ''}`).join(',');
    return init + '::' + sig;
  }

  function formatForPrompt(rawPaths, { budgetChars = PROMPT_BUDGET_CHARS } = {}) {
    if (!Array.isArray(rawPaths) || !rawPaths.length) return '';
    const seen = new Set();
    const dedup = [];
    for (const p of rawPaths) {
      const k = clusterKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(p);
    }
    const lines = [];
    let chars = 0;
    for (const p of dedup) {
      const intent = ((p && p.intent) || '').trim() || '(intento ignoto)';
      const init = ((p && p.initialUrl) || '').trim() || '/';
      const header = `## "${intent}" (da ${init})`;
      const stepLines = ((p && p.steps) || []).map((s, i) => {
        const a = (s && s.action) || 'click';
        const sel = (s && s.selector) || '?';
        const r = (s && s.retracted) ? ' [poi corretto]' : '';
        return `  ${i + 1}. ${a} su ${sel}${r}`;
      });
      const block = [header, ...stepLines].join('\n');
      if (chars + block.length + 2 > budgetChars) break;
      lines.push(block);
      chars += block.length + 2;
    }
    return lines.join('\n\n');
  }

  global.SN_PATHS = {
    submit,
    listByDomain,
    formatForPrompt,
    configPublic: { projectId: PROJECT_ID, collection: COLLECTION, subcollection: SUBCOLLECTION },
    rest: { FIRESTORE_BASE, MAX_PAGE_SIZE, PROMPT_BUDGET_CHARS },
    _internal: { segmentoDominio, oraArrotondata, clusterKey },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
