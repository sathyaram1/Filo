// Client Firebase REST per i feedback: niente SDK, solo fetch(),
// così gira sia nei content script sia nelle pagine interne.

(function (global) {
  'use strict';

  const PROJECT_ID = 'filo-8b9cb';
  const BUCKET = 'filo-8b9cb.firebasestorage.app';
  const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
  const COLLECTION = 'feedback';
  // La vista pubblica: un documento per feedback, stesso id, solo i campi sicuri (#583).
  // La collezione vera non si legge senza credenziali: vedi feedbackPublicView.js.
  const VIEW_COLLECTION = 'feedback-public';
  const COUNTERS_COLLECTION = 'counters';
  const SEQ_COUNTER = 'feedbackSeq';

  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

  // L'uuid è ANCHE il segreto del percorso di un allegato: storage.rules concede la creazione
  // solo su un nome che lo contiene, quindi i bit vengono dal generatore crittografico.
  function uuid() {
    const c = global.crypto;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // FONTE UNICA della forma del nome di un allegato: storage.rules concede la creazione SOLO
  // su un nome fatto così. Cambiarla qui e non là = dal deploy nessun allegato si carica.
  function attachmentPath(mimeOrExt, label) {
    const raw = String(mimeOrExt || '');
    const ext = (raw.includes('/') ? raw.split('/')[1] : raw).replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'bin';
    const et = String(label || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 16);
    return `${COLLECTION}/${et ? `${et}_` : ''}${Date.now()}_${uuid()}.${ext}`;
  }

  // Host → inizi ammessi, NOME DEL DEPOSITO compreso: REST di Firebase e diretto di Storage.
  // I nomi del deposito sono due: senza quello storico un allegato vecchio non si apre più.
  const DEPOSITI = [BUCKET, `${PROJECT_ID}.appspot.com`];
  // Tabella SENZA eredità: la chiave la scrive chi manda, e su `__proto__` o `toString`
  // una tabella normale esplodeva invece di dire «no»: una domanda di sicurezza risponde.
  const PREFISSI_ALLEGATO = Object.assign(Object.create(null), {
    'firebasestorage.googleapis.com': DEPOSITI.map((b) => `/v0/b/${b}/o/`),
    'storage.googleapis.com': DEPOSITI.map((b) => `/${b}/`),
  });

  // Un URL è un allegato del bucket dei feedback? Il confronto è sul BUCKET, non sull'host:
  // un feedback lo crea chiunque, e col solo host basterebbe un altro bucket di Google.
  function isAttachmentUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (_) { return false; }
    if (u.protocol !== 'https:') return false;
    const prefissi = PREFISSI_ALLEGATO[u.hostname];
    // `Array.isArray` e non `!!`: se la tabella tornasse un oggetto normale qui si dice «no»
    // invece di esplodere su una domanda che decide se firmare col gettone dell'owner.
    return Array.isArray(prefissi) && prefissi.some((p) => u.pathname.startsWith(p));
  }

  // Quello che apre un allegato è il download token nell'URL, non questo Bearer (#583).
  // Il token dell'owner esce SOLO verso il deposito di Filo, altrove niente intestazioni.
  function attachmentFetchHeaders(url, idToken) {
    const t = String(idToken || '');
    if (!t || !isAttachmentUrl(url)) return {};
    return { Authorization: `Bearer ${t}` };
  }

  // Etichetta di un indirizzo che arriva da fuori: deve dire dove si va, o è un'esca.
  // La parte prima della chiocciola non si mostra; l'host non si taglia MAI dalla coda.
  const LINK_LABEL_MAX = 80;
  function linkLabel(rawUrl, max) {
    const limite = Number.isFinite(max) && max >= 8 ? Math.floor(max) : LINK_LABEL_MAX;
    let u;
    try { u = new URL(String(rawUrl || '')); } catch (_) { return ''; }
    // Solo indirizzi che portano su un sito: `javascript:alert(1)` si parsa, ha host vuoto,
    // e l'etichetta diventerebbe `alert(1)`, che non dice dove si va.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const host = u.host; // host = dominio + porta, senza credenziali davanti
    const resto = `${u.pathname}${u.search}${u.hash}`;
    if (host.length >= limite) return `…${host.slice(host.length - (limite - 1))}`;
    if (host.length + resto.length <= limite) return `${host}${resto}`;
    return `${host}${resto.slice(0, limite - host.length - 1)}…`;
  }

  // Anti-duplicati (#370): col submissionId il documento nasce con QUELL'id, e un secondo
  // invio uguale viene rifiutato. Id non ammesso → '', cioè nessuna idempotenza.
  function sanitizeDocId(id) {
    if (!id) return '';
    const s = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);
    if (!s || s === '.' || s === '..' || /^__.*__$/.test(s)) return '';
    return s;
  }

  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // L'upload è una CREAZIONE: le regole non concedono la sovrascrittura, un nome già usato
  // torna 403. L'URL che torna porta il download token, da trattare come il contenuto.
  async function uploadImage(blob) {
    const name = attachmentPath(blob.type || 'png');
    const url = `${STORAGE_BASE}?uploadType=media&name=${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`upload storage fallito (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const token = json.downloadTokens || (json.metadata?.downloadTokens) || '';
    // Il token di scarico è la CHIAVE dell'allegato (#583): senza, l'indirizzo non apre nulla.
    // Meglio dirlo subito: chi invia lo ritrova fra i non caricati e riprova.
    if (!token) {
      throw new Error('il deposito non ha rilasciato il codice di scarico: '
        + "senza, l'allegato non sarebbe più leggibile da nessuno.");
    }
    const publicUrl = `${STORAGE_BASE}/${encodeURIComponent(name)}?alt=media&token=${token}`;
    return { url: publicUrl, name };
  }

  // Mapping status fine → pubblico. Gli stati CANONICI stanno in SN_FB_STATUS.PUBLIC_MAP:
  // qui resta solo il mapping dei LEGACY ritirati, e non si duplica altrove.
  const STATUS_PUBLIC_MAP = {
    new:     'open',
    draft:   'open',
    todo:    'open',
    clarify: 'open',
    review:  'open',
    blocked: 'open', // sicurezza: collassa sugli «in lavorazione» (feedbackTransitions.js)
    done:     'closed',
    verified: 'closed',
    ignored:  'closed',
    archived: 'closed',
  };

  // Un unico posto per tutti i percorsi di scrittura.
  // Lookup pigra su SN_FB_STATUS: i due file non impongono un ordine di caricamento.
  function statusToPublic(fineStatus) {
    const FS = global.SN_FB_STATUS;
    if (FS && FS.PUBLIC_MAP[fineStatus]) return FS.PUBLIC_MAP[fineStatus];
    return STATUS_PUBLIC_MAP[fineStatus] || 'open'; // default safe: unknown → 'open'
  }

  // Senza chiave pubblica il valore passa invariato: niente crash, scrittura in chiaro.
  async function maybeEncrypt(value) {
    if (value == null || value === '') return value;
    const C = global.SN_FEEDBACK_CRYPTO;
    if (!C || !C.isEnabled()) return value; // dormiente finché il cutover non accende SN_FEEDBACK_ENC_ENABLED
    try { return await C.encryptForOwner(String(value)); }
    catch (e) { console.warn('[SN feedback] cifratura testo fallita:', e?.message || e); return value; }
  }

  // `statusPublic` si calcola PRIMA e si scrive sempre in chiaro accanto allo status cifrato:
  // i lettori senza chiave privata (bacheca, popup ricompense) usano quello.
  async function encryptStatus(status) {
    const publicStatus = statusToPublic(status);
    // Lunghezza fissa dello status cifrato: regola in feedbackTransitions.js (#476).
    const FS = global.SN_FB_STATUS;
    const daCifrare = FS && FS.padForCipher ? FS.padForCipher(status) : status;
    const fineStatus = await maybeEncrypt(daCifrare);
    return { fineStatus, publicStatus };
  }

  // Il contenuto diventa opaco; senza chiave pubblica torna il blob originale.
  async function maybeEncryptBlob(blob) {
    const C = global.SN_FEEDBACK_CRYPTO;
    if (!C || !C.isEnabled()) return blob;
    try {
      const ab = await blob.arrayBuffer();
      const plain = new Uint8Array(ab);
      const sealed = await C.encryptBytesForOwner(plain);
      return new Blob([sealed], { type: 'application/octet-stream' });
    } catch (e) {
      console.warn('[SN feedback] cifratura bytes fallita:', e?.message || e);
      return blob;
    }
  }

  // Allegati ai COMMENTI (#190.3): chiunque può CREARE senza login, nessuno sovrascrivere.
  // Quindi di qui non passa nessun token.
  async function uploadAttachment(blob, name) {
    const u = await uploadImage(blob);
    const type = (blob && blob.type) || '';
    const kind = type.startsWith('image/') ? 'img' : 'file';
    return {
      kind,
      url: u.url,
      name: String(name || (kind === 'img' ? 'immagine' : 'allegato')),
      type,
    };
  }

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

  // La collezione vera la leggono solo owner e server (#583), e il token dell'owner vive nel
  // main: da una pagina la lettura si CHIEDE al main, che torna le righe già decodificate.
  function pageBridge() {
    const w = (typeof window !== 'undefined') ? window : null;
    if (w && w.filo && typeof w.filo.message === 'function') return (m) => w.filo.message(m);
    return null;
  }

  async function readViaMain(bridge, payload) {
    // Il vocabolario dei messaggi non è caricato: questo modulo gira anche fuori dalle pagine.
    const r = await bridge({ type: 'feedback_fetch', ...payload });
    if (!r || r.ok !== true) {
      const code = r && r.code;
      if (code === 'not_admin' || code === 'forbidden') {
        // Non è un guasto ma un permesso che manca: «controlla la connessione» sarebbe fuorviante.
        const e = new Error('i feedback li legge solo chi li gestisce: accedi con l\'account amministratore per vederli.');
        e.code = 'FEEDBACK_READ_DENIED';
        throw e;
      }
      throw new Error((r && r.error) || 'lettura dei feedback non riuscita');
    }
    return Array.isArray(r.rows) ? r.rows : [];
  }

  function fsDocToObject(doc) {
    const out = {};
    for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFsValue(v);
    out._id = doc.name?.split('/').pop() || '';
    out._createTime = doc.createTime || null;
    // È il segno con cui la dashboard riconosce cosa è cambiato senza rileggere tutto.
    out._updateTime = doc.updateTime || null;
    return out;
  }

  // `subSeq` è SOLO STORICO: la spezzatura delle spec in sotto-feedback è abolita.
  // I sub-feedback esistenti restano visibili, quindi si produce ancora la forma #N.M.
  function formatNum(seq, subSeq) {
    const s = Number(seq);
    if (!Number.isInteger(s) || s <= 0) return '';
    const sub = Number(subSeq);
    return Number.isInteger(sub) && sub > 0 ? `${s}.${sub}` : String(s);
  }

  // Tronca senza spezzare un carattere: `slice` lavora su unità UTF-16 e taglierebbe un'emoji
  // a metà. Si conta per grafema con Intl.Segmenter, con ripiego a code point.
  function truncateSafe(str, max) {
    const s = String(str == null ? '' : str);
    let units;
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        units = Array.from(seg.segment(s), (g) => g.segment);
      } else {
        units = Array.from(s); // iteratore stringa → per code point, no surrogati soli
      }
    } catch {
      units = Array.from(s);
    }
    if (units.length <= max) return s;
    return units.slice(0, max).join('');
  }

  // Titolo di ripiego quando l'LLM non è disponibile: prime parole del testo.
  function fallbackName(text, maxWords = 6) {
    const words = String(text || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!words.length) return '';
    let out = words.slice(0, maxWords).join(' ');
    if (out.length > 60) return truncateSafe(out, 57).trimEnd() + '…';
    return words.length > maxWords ? out + '…' : out;
  }

  // Il numero viene da un contatore, non da una query: la collezione non si legge senza
  // credenziali e l'invio resta anonimo. Torna `null` invece di lanciare: meglio senza numero.
  const SEQ_RETRIES = 5;

  async function nextSeq() {
    const docUrl = `${FIRESTORE_BASE}/${COUNTERS_COLLECTION}/${SEQ_COUNTER}`;
    for (let attempt = 0; attempt < SEQ_RETRIES; attempt++) {
      const res = await fetch(`${docUrl}?key=${API_KEY}`);
      if (res.status === 404) return null;      // contatore non ancora creato
      if (!res.ok) throw new Error(`firestore nextSeq fallito (${res.status})`);
      const doc = await res.json();
      const current = Number(fromFsValue(doc.fields?.value));
      const base = Number.isInteger(current) && current > 0 ? current : 0;
      const next = base + 1;
      const qs = [
        'updateMask.fieldPaths=value',
        `currentDocument.updateTime=${encodeURIComponent(doc.updateTime || '')}`,
        `key=${API_KEY}`,
      ].join('&');
      const w = await fetch(`${docUrl}?${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { value: { integerValue: String(next) } } }),
      });
      if (w.ok) return next;
      // 400/409/412: qualcun altro ha scritto nel frattempo, si rilegge e si riprova.
      if (w.status === 400 || w.status === 409 || w.status === 412) continue;
      throw new Error(`firestore nextSeq fallito (${w.status})`);
    }
    return null;
  }

  // `allowLower` riporta GIÙ il contatore: farlo salire lo può chiunque, e senza questa cura
  // i numeri nuovi resterebbero assurdi. Si scende solo con uno scarto più largo di una corsa.
  const SEQ_LOWER_MARGIN = 10;

  async function ensureSeqCounter(maxSeq, opts = {}) {
    const value = Math.max(0, Math.trunc(Number(maxSeq) || 0));
    const docUrl = `${FIRESTORE_BASE}/${COUNTERS_COLLECTION}/${SEQ_COUNTER}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    // La lettura del contatore è pubblica: qui il token non serve.
    const res = await fetch(`${docUrl}?key=${API_KEY}`);
    let current = -1;
    if (res.ok) {
      const doc = await res.json();
      const v = Number(fromFsValue(doc.fields?.value));
      current = Number.isInteger(v) ? v : -1;
    } else if (res.status !== 404) {
      throw new Error(`firestore contatore non leggibile (${res.status})`);
    }
    if (current === value) return current;
    if (current > value && !opts.allowLower) return current;
    if (current > value && current - value < SEQ_LOWER_MARGIN) return current;
    const w = await fetch(`${docUrl}?updateMask.fieldPaths=value&key=${API_KEY}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: { value: { integerValue: String(value) } } }),
    });
    if (!w.ok) {
      const t = await w.text().catch(() => '');
      throw new Error(`firestore contatore non scritto (${w.status}): ${t.slice(0, 200)}`);
    }
    return value;
  }

  // `name` è il titolo breve, generato da un LLM nel main prima della chiamata.
  // `parentId`: il feedback nasce collegato a un altro, che ha comunque un numero proprio.
  async function submit({ text, url, title, userAgent, clientId, clientIdHash, images, files, name, parentId, capabilityGapId, submissionId }) {
    // Gli allegati non caricati tornano al chiamante: un upload fallito non si ingoia.
    const failed = [];
    const imgs = Array.isArray(images) ? images.slice(0, 5) : [];
    const uploaded = [];
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img?.dataUrl) continue;
      const rawBlob = dataUrlToBlob(img.dataUrl);
      // Limite misurato sul raw: la cifratura aggiunge una novantina di byte fissi.
      if (rawBlob.size > 4 * 1024 * 1024) {
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'troppo grande (max 4 MB)' });
        continue;
      }
      try {
        const blobToUpload = await maybeEncryptBlob(rawBlob);
        const u = await uploadImage(blobToUpload);
        uploaded.push(u.url);
      } catch (e) {
        console.warn('[SN feedback] upload immagine fallito:', e);
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'caricamento non riuscito' });
      }
    }

    // Nome e tipo originali si conservano: in dashboard diventano link scaricabili.
    const docs = Array.isArray(files) ? files.slice(0, 5) : [];
    const uploadedFiles = [];
    for (const f of docs) {
      const fname = String(f?.name || 'allegato');
      if (!f?.dataUrl) { failed.push({ name: fname, reason: 'file vuoto' }); continue; }
      const rawBlob = dataUrlToBlob(f.dataUrl);
      if (rawBlob.size > 4 * 1024 * 1024) { failed.push({ name: fname, reason: 'troppo grande (max 4 MB)' }); continue; }
      try {
        const blobToUpload = await maybeEncryptBlob(rawBlob);
        const u = await uploadImage(blobToUpload);
        uploadedFiles.push({ url: u.url, name: fname, type: String(f.type || rawBlob.type || '') });
      } catch (e) {
        console.warn('[SN feedback] upload file fallito:', e);
        failed.push({ name: fname, reason: 'caricamento non riuscito' });
      }
    }

    // Best-effort: il feedback parte anche senza numero, invece di bloccare l'invio.
    let seq = null;
    try { seq = await nextSeq(); }
    catch (e) { console.warn('[SN feedback] numerazione non disponibile:', e?.message || e); }

    // Si cifra SOLO il contenuto che nessun altro utente deve leggere: `text` e `url`.
    // `title`/`name` no: li mostra il popup ricompense, sulla macchina di chi ha inviato.
    const [encText, encUrl] = await Promise.all([
      maybeEncrypt(text || ''),
      maybeEncrypt(url || ''),
    ]);

    // L'hash del clientId si calcola SEMPRE, anche a cifratura spenta: il match passa da lì.
    let resolvedClientIdHash = (typeof clientIdHash === 'string' && clientIdHash.length === 32) ? clientIdHash : '';
    if (!resolvedClientIdHash) {
      try {
        const H = global.SN_FEEDBACK_CLIENT_ID_HASH;
        if (H && H.hashClientId) {
          resolvedClientIdHash = await H.hashClientId(clientId || '');
        }
      } catch (_) {}
    }

    // Il `clientId` si può cifrare perché il match passa dall'hash.
    const encClientId = await maybeEncrypt(clientId || '');

    const doc = {
      fields: {
        text: toFsValue(encText),
        url: toFsValue(encUrl),
        title: toFsValue(title || ''),
        name: toFsValue(String(name || '').slice(0, 200)),
        userAgent: toFsValue(userAgent || ''),
        clientId: toFsValue(encClientId),
        clientIdHash: toFsValue(resolvedClientIdHash),
        images: toFsValue(uploaded),
        files: toFsValue(uploadedFiles),
        statusPublic: toFsValue('open'),
        createdAt: { timestampValue: new Date().toISOString() },
      },
    };
    if (seq) {
      doc.fields.seq = { integerValue: String(seq) };
      doc.fields.subSeq = { integerValue: '0' };
    }
    if (parentId) {
      doc.fields.parentId = toFsValue(String(parentId));
    }
    // F4: id strutturale del gap di capacità per il dedup F5, solo per gli auto-feedback.
    if (capabilityGapId && String(clientId || '').startsWith('auto:')) {
      doc.fields.capabilityGapId = toFsValue(String(capabilityGapId).slice(0, 100));
    }

    // Idempotenza: vedi sanitizeDocId (#370).
    const docId = sanitizeDocId(submissionId);
    const idParam = docId ? `documentId=${encodeURIComponent(docId)}&` : '';
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}?${idParam}key=${API_KEY}`;
    let res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (res.status === 403) {
      // Se le rules non conoscono i campi nuovi si ritenta col solo schema storico:
      // meglio un feedback senza numero o titolo che un invio fallito.
      delete doc.fields.name;
      delete doc.fields.seq;
      delete doc.fields.subSeq;
      delete doc.fields.parentId;
      delete doc.fields.clientIdHash; // le rules vecchie potrebbero rifiutarlo
      seq = null;
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    }
    // 409 con documentId: il feedback c'era già. Non è un errore, è un successo idempotente.
    if (docId && res.status === 409) {
      return { id: docId, seq: null, images: uploaded, files: uploadedFiles, failed, deduped: true };
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore create fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const json = await res.json();
    return { id: json.name?.split('/').pop() || '', seq, images: uploaded, files: uploadedFiles, failed };
  }

  // È un TETTO, non un totale: oltre la soglia i più vecchi restano fuori,
  // e nessun conteggio calcolato in pagina può vederli.
  const LIST_PAGE_SIZE = 500;

  // Toccato il tetto, ogni numero che ne deriva è un «almeno N», non un totale.
  function listHitCap(loaded, pageSize) {
    const cap = Number(pageSize) > 0 ? Number(pageSize) : LIST_PAGE_SIZE;
    return Array.isArray(loaded) && loaded.length >= cap;
  }

  // Il «+» dice che è un minimo: un numero che afferma un totale che non conosce
  // sembra una risposta ed è peggio di nessun numero.
  function countLabel(n, truncated) {
    const v = Math.max(0, Math.trunc(Number(n) || 0));
    return truncated ? `(${v}+)` : `(${v})`;
  }

  // Spiega il «+», e anche una sezione che sembra vuota perché i vecchi non sono in pagina:
  // per questo non nomina il numero.
  const COUNT_CAP_HINT =
    `Caricati i ${LIST_PAGE_SIZE} feedback più recenti: se ce ne sono di più vecchi, non sono in pagina e non entrano nel conto.`;

  // `timeoutMs`: la fetch si arrende invece di restare muta finché il sistema operativo molla.
  // `afterName` (anche ''): pagina ordinata per NOME del documento, il cursore di `listAll`.
  async function list({ pageSize = 200, timeoutMs = 0, fields = null, idToken = '', afterName = null } = {}) {
    const bridge = pageBridge();
    if (bridge) {
      if (typeof afterName === 'string') {
        throw new Error('lettura completa dei feedback non disponibile da una pagina: passa dal main');
      }
      return readViaMain(bridge, { op: 'list', pageSize, timeoutMs, fields });
    }
    if (typeof afterName === 'string') {
      const { rows } = await listByNameDirect(COLLECTION, { pageSize, timeoutMs, afterName, idToken });
      return rows;
    }
    return listDirect(COLLECTION, { pageSize, timeoutMs, fields, idToken });
  }

  // I feedback CHIUSI più di recente, non i più recenti per data: una segnalazione vecchia
  // chiusa oggi non entrerebbe mai in bacheca, e chi l'ha mandata non avrebbe i crediti.
  async function listResolved({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, idToken = '' } = {}) {
    return listDirect(COLLECTION, { pageSize, timeoutMs, idToken, orderField: 'resolvedAt' });
  }

  // TUTTE le segnalazioni: `list` è una finestra sui più recenti, e una domanda sull'INSIEME
  // salta i più vecchi (patterns/una-pagina-dei-piu-recenti-non-e-tutto.md).
  async function listAllPaged({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, idToken = '', maxPages = ALL_PAGES_MAX } = {}) {
    const limit = Math.max(1, Math.min(LIST_PAGE_SIZE, Number(pageSize) || LIST_PAGE_SIZE));
    const rows = [];
    const visti = new Set();
    let cursor = '';
    let complete = false;
    for (let page = 0; page < Math.max(1, Number(maxPages) || ALL_PAGES_MAX); page += 1) {
      const porta = (global.SN_FEEDBACK && global.SN_FEEDBACK.list) || list;
      // eslint-disable-next-line no-await-in-loop
      const batch = await porta({ pageSize: limit, timeoutMs, idToken, afterName: cursor });
      const arr = Array.isArray(batch) ? batch : [];
      let nuove = 0;
      for (const r of arr) {
        const id = String((r && r._id) || '');
        if (id && visti.has(id)) continue;
        if (id) visti.add(id);
        rows.push(r);
        nuove += 1;
      }
      const ultimo = nomeDocumento(COLLECTION, arr[arr.length - 1]);
      if (arr.length < limit || nuove === 0 || !ultimo || ultimo === cursor) { complete = true; break; }
      cursor = ultimo;
    }
    return { rows, complete };
  }

  async function listAll(opts = {}) {
    const { rows } = await listAllPaged(opts);
    return rows;
  }

  // La query vera, senza ponti: main con token, script, e la vista pubblica senza token.
  async function listDirect(collectionId, { pageSize = 200, timeoutMs = 0, fields = null, idToken = '', orderField = 'createdAt' } = {}) {
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId }],
        orderBy: [
          { field: { fieldPath: String(orderField || 'createdAt') }, direction: 'DESCENDING' },
        ],
        limit: pageSize,
      },
    };
    if (Array.isArray(fields) && fields.length > 0) {
      body.structuredQuery.select = { fields: fields.map((f) => ({ fieldPath: String(f) })) };
    }
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const opts = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    };
    // L'errore porta «timeout» nel messaggio: SN_CHAT_ERRORS lo riconosce come guasto di rete
    // e non come annullamento volontario, che invece non va segnalato.
    let timer = null;
    let timedOut = false;
    if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(() => { timedOut = true; try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    let res;
    try {
      res = await fetch(endpoint, opts);
    } catch (e) {
      if (timedOut) throw new Error('firestore list: timeout di rete');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore list fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const arr = await res.json();
    const out = [];
    for (const row of arr) {
      if (!row.document) continue;
      out.push(fsDocToObject(row.document));
    }
    return out;
  }

  // Il numero più alto MAI assegnato, chiesto al server: il massimo dei feedback caricati
  // non basta, perché il caricamento si ferma ai più recenti. Costa UNA lettura ed è esatto.
  async function maxSeq({ idToken = '', timeoutMs = 0 } = {}) {
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const opts = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: COLLECTION }],
          orderBy: [{ field: { fieldPath: 'seq' }, direction: 'DESCENDING' }],
          limit: 1,
        },
      }),
    };
    let timer = null;
    if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    let res;
    try { res = await fetch(endpoint, opts); } finally { if (timer) clearTimeout(timer); }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore maxSeq fallito (${res.status}): ${t.slice(0, 200)}`);
    }
    const arr = await res.json();
    for (const row of Array.isArray(arr) ? arr : []) {
      if (!row || !row.document) continue;
      const n = Number(fromFsValue(row.document.fields?.seq));
      if (Number.isInteger(n) && n >= 0) return n;
    }
    // `null`, non 0: «non lo so» non è «zero», o il contatore tornerebbe a zero.
    return null;
  }

  // Id e `_updateTime`, niente campi: la dashboard si aggiorna senza riscaricare tutto.
  async function listVersions({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0 } = {}) {
    const rows = await list({ pageSize, timeoutMs, fields: ['__name__'] });
    return rows.map((r) => ({ _id: r._id, _updateTime: r._updateTime }));
  }

  // batchGet torna solo i documenti trovati: un id cancellato nel frattempo non compare.
  async function getMany(ids, { timeoutMs = 0, idToken = '' } = {}) {
    const wanted = (Array.isArray(ids) ? ids : []).map((s) => String(s || '')).filter(Boolean);
    if (wanted.length === 0) return [];
    const bridge = pageBridge();
    if (bridge) return readViaMain(bridge, { op: 'getMany', ids: wanted, timeoutMs });
    const endpoint = `${FIRESTORE_BASE}:batchGet?key=${API_KEY}`;
    const prefix = `${FIRESTORE_BASE}/${COLLECTION}/`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const opts = {
      method: 'POST',
      headers,
      body: JSON.stringify({ documents: wanted.map((id) => prefix + id) }),
    };
    let timer = null;
    let timedOut = false;
    if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(() => { timedOut = true; try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    let res;
    try {
      res = await fetch(endpoint, opts);
    } catch (e) {
      if (timedOut) throw new Error('firestore batchGet: timeout di rete');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore batchGet fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const arr = await res.json();
    const out = [];
    for (const row of Array.isArray(arr) ? arr : []) {
      if (row && row.found) out.push(fsDocToObject(row.found));
    }
    return out;
  }

  // La vista pubblica (#583): una scheda per feedback chiuso, coi soli campi pubblici.
  // La leggono bacheca e popup ricompense: niente token, qui non c'è nulla da proteggere.

  // Senza `afterName`: le più recenti per data d'invio, come la lista vera.
  // Con `afterName` (anche ''): ordine per NOME, unico e stabile — una data può ripetersi.
  async function listPublic({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, afterName = null } = {}) {
    if (typeof afterName === 'string') {
      const { rows } = await listByNameDirect(VIEW_COLLECTION, { pageSize, timeoutMs, afterName });
      return rows;
    }
    return listDirect(VIEW_COLLECTION, { pageSize, timeoutMs });
  }

  // TUTTE le schede: la finestra sui più recenti per DATA D'INVIO non risponde a «mi spetta
  // una ricompensa?» né a «quale scheda va tolta?». `maxPages` è un freno: se scatta lo dice.
  const ALL_PAGES_MAX = 40;

  async function listAllPublicPaged({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, maxPages = ALL_PAGES_MAX } = {}) {
    const limit = Math.max(1, Math.min(LIST_PAGE_SIZE, Number(pageSize) || LIST_PAGE_SIZE));
    const rows = [];
    const visti = new Set();
    let cursor = '';
    let complete = false;
    for (let page = 0; page < Math.max(1, Number(maxPages) || ALL_PAGES_MAX); page += 1) {
      // Si passa dalla porta ESPOSTA: chi sostituisce `listPublic` in una prova sostituisce
      // anche questa lettura, o si ritrova la rete vera sotto una pagina che crede finta.
      const porta = (global.SN_FEEDBACK && global.SN_FEEDBACK.listPublic) || listPublic;
      // eslint-disable-next-line no-await-in-loop
      const batch = await porta({ pageSize: limit, timeoutMs, afterName: cursor });
      const arr = Array.isArray(batch) ? batch : [];
      let nuove = 0;
      for (const r of arr) {
        const id = String((r && r._id) || '');
        if (id && visti.has(id)) continue;
        if (id) visti.add(id);
        rows.push(r);
        nuove += 1;
      }
      // Una sorgente che ignora il cursore ripete la pagina: niente di nuovo = si è in fondo.
      const ultimo = nomeDocumento(VIEW_COLLECTION, arr[arr.length - 1]);
      if (arr.length < limit || nuove === 0 || !ultimo || ultimo === cursor) { complete = true; break; }
      cursor = ultimo;
    }
    return { rows, complete };
  }

  // Memoria breve: l'annuncio della ricompensa gira a ogni caricamento della home, e senza
  // rileggerebbe tutte le schede ogni volta. Si ricorda solo una lettura COMPLETA.
  const ALL_CACHE_TTL_MS = 30_000;
  let allCache = { at: 0, rows: null, porta: null };

  async function listAllPublic(opts = {}) {
    const porta = (global.SN_FEEDBACK && global.SN_FEEDBACK.listPublic) || listPublic;
    const fresca = !!(opts && opts.fresh);
    if (!fresca && allCache.rows && allCache.porta === porta
        && (Date.now() - allCache.at) < ALL_CACHE_TTL_MS) {
      return allCache.rows;
    }
    const { rows, complete } = await listAllPublicPaged(opts);
    allCache = complete ? { at: Date.now(), rows, porta } : { at: 0, rows: null, porta: null };
    return rows;
  }

  /** Butta via la memoria breve: dopo aver scritto o tolto una scheda. */
  function forgetAllPublic() { allCache = { at: 0, rows: null, porta: null }; }

  // Il nome intero del documento, quello che Firestore vuole come cursore.
  function nomeDocumento(collectionId, row) {
    const id = String((row && row._id) || '');
    if (!id) return '';
    return `${FIRESTORE_BASE.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '')}/${collectionId}/${id}`;
  }

  // Una pagina ordinata per nome, con cursore: è il mattone delle letture complete.
  // `idToken` serve per la collezione vera; la vista pubblica lo lascia vuoto.
  async function listByNameDirect(collectionId, { pageSize = LIST_PAGE_SIZE, timeoutMs = 0, afterName = '', idToken = '' } = {}) {
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const structuredQuery = {
      from: [{ collectionId }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: pageSize,
    };
    if (afterName) {
      structuredQuery.startAt = { before: false, values: [{ referenceValue: afterName }] };
    }
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const opts = { method: 'POST', headers, body: JSON.stringify({ structuredQuery }) };
    let timer = null;
    let timedOut = false;
    if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(() => { timedOut = true; try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    let res;
    try {
      res = await fetch(endpoint, opts);
    } catch (e) {
      if (timedOut) throw new Error('firestore list: timeout di rete');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore list fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const arr = await res.json();
    const rows = [];
    let lastName = '';
    for (const row of arr) {
      if (!row.document) continue;
      lastName = row.document.name || lastName;
      rows.push(fsDocToObject(row.document));
    }
    return { rows, lastName };
  }

  // Torna null se non c'è: un feedback che non è in bacheca semplicemente non ha scheda.
  async function getPublic(id, { idToken = '' } = {}) {
    const key = String(id || '');
    if (!key) return null;
    const url = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(key)}?key=${API_KEY}`;
    const headers = idToken ? { Authorization: `Bearer ${idToken}` } : undefined;
    const res = await fetch(url, headers ? { headers } : undefined);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`firestore vista pubblica fallita (${res.status})`);
    return fsDocToObject(await res.json());
  }

  // La maschera elenca SOLO i campi della scheda: `votes` e `reopenRequests` li scrivono
  // gli utenti, e una ripubblicazione non deve cancellarli.
  async function publishPublicCard(id, card, opts = {}) {
    const key = String(id || '');
    if (!key) throw new Error('id mancante');
    const V = global.SN_FEEDBACK_PUBLIC_VIEW;
    const names = (V && V.CARD_FIELDS) ? V.CARD_FIELDS : Object.keys(card || {});
    const fields = {};
    const mask = [];
    for (const f of names) {
      if (f === 'publishedAt') continue;
      const v = (card || {})[f];
      fields[f] = toFsValue(v === undefined ? '' : v);
      mask.push(f);
    }
    fields.publishedAt = toFsValue(new Date().toISOString());
    mask.push('publishedAt');
    // Entrano nella maschera solo per il travaso dal documento alla scheda (carryUserFields),
    // e lì il valore che arriva contiene già quello che c'era sulla scheda.
    const userFields = (V && V.USER_FIELDS) ? V.USER_FIELDS : ['votes', 'reopenRequests'];
    for (const f of userFields) {
      const v = (card || {})[f];
      if (!v || typeof v !== 'object') continue;
      fields[f] = toFsValue(v);
      mask.push(f);
    }
    const qs = mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&');
    const url = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(key)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore pubblicazione scheda fallita (${res.status}): ${t.slice(0, 300)}`);
    }
    return true;
  }

  // Un fix riaperto esce dalla bacheca perché la scheda non c'è più, non perché è nascosta.
  async function unpublishPublicCard(id, opts = {}) {
    const key = String(id || '');
    if (!key) throw new Error('id mancante');
    const url = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(key)}?key=${API_KEY}`;
    const headers = {};
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const res = await fetch(url, { method: 'DELETE', headers });
    // 404 = già tolta: l'esito voluto è lo stesso.
    if (!res.ok && res.status !== 404) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore rimozione scheda fallita (${res.status}): ${t.slice(0, 300)}`);
    }
    return true;
  }

  // `idToken` va come Bearer: senza, passa solo ciò che le regole ammettono all'anonimo.
  async function updateStatus(id, { status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride, mergePreapproved }, opts = {}) {
    if (!id) throw new Error('id mancante');
    const idToken = opts.idToken;
    const fields = {};
    const mask = [];
    if (status !== undefined) {
      const { fineStatus, publicStatus } = await encryptStatus(status);
      fields.status = toFsValue(fineStatus);
      mask.push('status');
      fields.statusPublic = toFsValue(publicStatus);
      mask.push('statusPublic');
    }
    // `notes` è il report per l'OWNER e viaggia CIFRATO: racconta come è stato chiuso un fix
    // di sicurezza. Ha un tetto: oltre, le regole respingono OGNI scrittura sul feedback.
    if (notes !== undefined) {
      const T = global.SN_FEEDBACK_THREAD;
      const capped = T && T.capNotes ? T.capNotes(notes) : notes;
      const C = global.SN_FEEDBACK_CRYPTO;
      let value = capped;
      if (C && C.isEnabled && C.isEnabled() && capped && !C.isEncrypted(capped)) {
        // Se la cifratura non riesce NON si scrive in chiaro: la conversazione resta com'era.
        try { value = await C.encryptForOwner(capped); } catch (_) { value = undefined; }
      }
      if (value !== undefined) { fields.notes = toFsValue(value); mask.push('notes'); }
    }
    // La frase per chi ha mandato il feedback: in chiaro per forza, la legge senza chiave.
    // Il tetto è in CARATTERI e combacia con quello delle regole, provato su un documento-cavia.
    if (userNote !== undefined) {
      // Il taglio degli spazi si fa alla consegna, non mentre l'owner scrive: riscrivere
      // la casella sotto le dita mangia lo spazio appena battuto.
      fields.userNote = toFsValue(String(userNote || '').trim().slice(0, 500)); mask.push('userNote');
    }
    // La revisione dell'owner viaggia TUTTA cifrata (#476): in chiaro diceva a chi ha mandato
    // un attacco che è stato beccato e perché. Vanno insieme: anche solo `reviewedAt` basta.
    if (reviewDecision !== undefined) {
      fields.reviewDecision = toFsValue(await maybeEncrypt(reviewDecision));
      mask.push('reviewDecision');
    }
    if (reviewComment !== undefined) {
      fields.reviewComment = toFsValue(await maybeEncrypt(reviewComment));
      mask.push('reviewComment');
    }
    if (reviewedAt !== undefined) {
      fields.reviewedAt = toFsValue(await maybeEncrypt(reviewedAt));
      mask.push('reviewedAt');
    }
    // Preferito (DB2): le rules accettano `starred` nel ramo update admin.
    if (starred !== undefined) { fields.starred = { booleanValue: !!starred }; mask.push('starred'); }
    // Override owner per l'auto-archiviazione a punteggio (DC3, boardArchive.js).
    if (archiveOverride !== undefined) { fields.archiveOverride = toFsValue(archiveOverride); mask.push('archiveOverride'); }
    // La pre-approvazione della fusione per QUESTA pratica: `{ by, at }` per metterla,
    // `null` per toglierla, cioè CANCELLARE il campo: scritto come valore resterebbe lì.
    if (mergePreapproved !== undefined) {
      if (mergePreapproved && typeof mergePreapproved === 'object') {
        fields.mergePreapproved = toFsValue({
          by: String(mergePreapproved.by || '').slice(0, 120),
          at: String(mergePreapproved.at || new Date().toISOString()).slice(0, 40),
        });
      }
      mask.push('mergePreapproved');
    }
    if (priority !== undefined) {
      // Clamp PRIMA di cifrare.
      const p = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
      // Con la cifratura attiva `priority` va come stringValue, altrimenti come integerValue.
      const C = global.SN_FEEDBACK_CRYPTO;
      if (C && C.isEnabled()) {
        try {
          const encPriority = await C.encryptForOwner(String(p));
          fields.priority = { stringValue: encPriority };
        } catch (e) {
          console.warn('[SN feedback] cifratura priority fallita, scrivo in chiaro:', e?.message || e);
          fields.priority = { integerValue: String(p) };
        }
      } else {
        fields.priority = { integerValue: String(p) };
      }
      mask.push('priority');
    }
    // `priorityManual` non è cifrato: dice che l'owner ha fissato la priorità a mano,
    // e il backend di sicurezza lo legge per saltare l'override automatico.
    if (priorityManual === true) {
      fields.priorityManual = { booleanValue: true };
      mask.push('priorityManual');
    }
    if (status === 'done') {
      fields.resolvedAt = { timestampValue: new Date().toISOString() };
      mask.push('resolvedAt');
    }
    if (status === 'verified') {
      fields.verifiedAt = { timestampValue: new Date().toISOString() };
      mask.push('verifiedAt');
    }
    const qs = mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&');
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore update fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    return true;
  }

  // Un voto per utente, cambiabile; le rules vincolano ognuno a scrivere solo la sua chiave.
  // Stanno sulla SCHEDA pubblica (#583): il documento vero chi vota non lo può aprire.
  const VOTE_WORKS = 'works';
  const VOTE_BROKEN = 'broken';
  const VOTE_VALUES = [VOTE_WORKS, VOTE_BROKEN];

  // Credibilità di default 1: finché non c'è il substrato per-utente ogni voto pesa uguale.
  function normalizeCredibility(v) {
    const c = Number(v);
    return Number.isFinite(c) && c >= 0 ? c : 1;
  }

  // Tiene solo le entry ben formate: i voti non validi si scartano.
  function normalizeVotes(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [uid, v] of Object.entries(raw)) {
      if (!uid || !v || typeof v !== 'object') continue;
      if (v.vote !== VOTE_WORKS && v.vote !== VOTE_BROKEN) continue;
      out[uid] = {
        vote: v.vote,
        at: typeof v.at === 'string' ? v.at : '',
        credibilitySnapshot: normalizeCredibility(v.credibilitySnapshot),
      };
    }
    return out;
  }

  // score = Σ credibilità(«works») − Σ credibilità(«broken»); total = votanti validi.
  function tallyVotes(raw) {
    const votes = normalizeVotes(raw);
    let works = 0;
    let broken = 0;
    let score = 0;
    for (const v of Object.values(votes)) {
      if (v.vote === VOTE_WORKS) { works += 1; score += v.credibilitySnapshot; }
      else { broken += 1; score -= v.credibilitySnapshot; }
    }
    return { works, broken, total: works + broken, score };
  }

  // Il voto corrente di un utente: 'works' | 'broken' | null.
  function userVote(raw, uid) {
    if (!uid) return null;
    const votes = normalizeVotes(raw);
    return votes[uid] ? votes[uid].vote : null;
  }

  // Scrive solo `votes.<uid>` con updateMask mirato: non tocca altri voti né altri campi.
  // Le rules verificano chiave == uid.
  async function castVote(id, { uid, vote, credibilitySnapshot } = {}, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    if (vote !== VOTE_WORKS && vote !== VOTE_BROKEN) {
      throw new Error("vote dev'essere 'works' o 'broken'");
    }
    const entry = {
      vote,
      at: new Date().toISOString(),
      credibilitySnapshot: normalizeCredibility(credibilitySnapshot),
    };
    const fieldPath = `votes.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const body = { fields: { votes: { mapValue: { fields: { [uid]: toFsValue(entry) } } } } };
    const res = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore castVote fallito (${res.status}): ${t.slice(0, 300)}`);
    }
    return entry;
  }

  // updateMask sul field path SENZA metterlo nel body: Firestore elimina quella chiave
  // e lascia intatti i voti altrui.
  async function clearVote(id, uid, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    const fieldPath = `votes.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const res = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ fields: {} }) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore clearVote fallito (${res.status}): ${t.slice(0, 300)}`);
    }
    return true;
  }

  // Si marca sul feedback ORIGINALE che l'uid ha chiesto la riapertura, come castVote.
  // Un utente non può toccare `status` di un documento che non ha creato.
  async function castReopenRequest(id, uid, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    const entry = { at: new Date().toISOString() };
    const fieldPath = `reopenRequests.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const body = { fields: { reopenRequests: { mapValue: { fields: { [uid]: toFsValue(entry) } } } } };
    const res = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore castReopenRequest fallito (${res.status}): ${t.slice(0, 300)}`);
    }
    return entry;
  }

  global.SN_FEEDBACK = {
    submit,
    list,
    listResolved,
    listAll,
    listAllPaged,
    listVersions,
    getMany,
    listPublic,
    listAllPublic,
    listAllPublicPaged,
    forgetAllPublic,
    getPublic,
    publishPublicCard,
    unpublishPublicCard,
    ensureSeqCounter,
    nextSeq,
    maxSeq,
    LIST_PAGE_SIZE,
    listHitCap,
    countLabel,
    COUNT_CAP_HINT,
    updateStatus,
    // Esportata perché owner-feedback.mjs la riusa per scrivere statusPublic.
    statusToPublic,
    // Voti di verifica (DB4): substrato letto da board (DC*) e archiviazione (DC3).
    castVote,
    clearVote,
    normalizeVotes,
    tallyVotes,
    userVote,
    VOTE_VALUES,
    // Riapertura a pagamento (DC4).
    castReopenRequest,
    uploadImage,
    uploadAttachment,
    // Il confine degli allegati (#582), usato anche dal main.
    attachmentPath,
    isAttachmentUrl,
    attachmentFetchHeaders,
    // La scritta di un collegamento che arriva da fuori: dice dove si va (#582).
    linkLabel,
    LINK_LABEL_MAX,
    formatNum,
    fallbackName,
    // L'API_KEY è la chiave web pubblica Firebase, già nel client: non è un segreto.
    toFsValue,
    fromFsValue,
    fsDocToObject,
    rest: { FIRESTORE_BASE, API_KEY, PROJECT_ID, VIEW_COLLECTION },
    configPublic: { projectId: PROJECT_ID, bucket: BUCKET, collection: COLLECTION },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
