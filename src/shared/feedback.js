// Client Firebase REST per i feedback alpha.
// Funziona sia nei content script sia nelle pagine dell'estensione: niente SDK,
// solo fetch().
//
// Espone SN_FEEDBACK = { submit, list, configPublic }.

(function (global) {
  'use strict';

  const PROJECT_ID = 'filo-8b9cb';
  const BUCKET = 'filo-8b9cb.firebasestorage.app';
  const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
  const COLLECTION = 'feedback';

  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

  // ---- helpers ----
  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Anti-duplicati (#370): id documento STABILE per una singola composizione di
  // feedback. Se il chiamante fornisce un submissionId, il documento viene creato
  // con quell'id; un secondo invio con lo stesso id (es. un tentativo andato in
  // timeout lato UI ma riuscito sul server, poi ripetuto dall'utente) viene
  // rifiutato dal server (409 ALREADY_EXISTS) invece di creare un duplicato.
  // Ripulisce l'id ai caratteri ammessi da Firestore per un documentId e scarta
  // i pattern vietati ('.', '..', __*__): in quei casi torna '' → creazione
  // normale con id auto-generato (retrocompat, nessuna idempotenza).
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

  // Upload diretto a Firebase Storage. Ritorna { url, name }.
  async function uploadImage(blob) {
    const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
    const name = `${COLLECTION}/${Date.now()}_${uuid()}.${ext}`;
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
    const publicUrl = `${STORAGE_BASE}/${encodeURIComponent(name)}?alt=media${token ? `&token=${token}` : ''}`;
    return { url: publicUrl, name };
  }

  // ---- S1.F2.1: statusPublic — enum grossolano in chiaro ----------------------
  // Mapping fine→pubblico. Tre valori: 'open' (in lavorazione OPPURE bloccato —
  // i due collassano per non regalare hill-climbing: l'attaccante non distingue
  // `blocked` da un normale feedback in lavorazione), 'closed' (risolto/archiviato),
  // 'pending-approval' (riservato al futuro, oggi mai assegnato).
  //
  // ⚠️ NOTA SICUREZZA CRITICA: `blocked` DEVE mappare su `open`, non su `closed`.
  //   Se mappasse su `closed` o su un valore distinto, chi legge Firestore senza
  //   chiave potrebbe riconoscere un attacco beccato e usarlo per fare hill-climbing.
  //
  // Gli stati CANONICI della macchina a stati stanno in SN_FB_STATUS.PUBLIC_MAP
  // (shared/feedbackStatus.js): lì i "beccati" (attack/spam/suspicious_file e i
  // confermati) collassano sugli stessi valori dei feedback normali. Qui resta
  // solo il mapping degli stati LEGACY ritirati (documenti storici non ancora
  // migrati). Non duplicare il mapping altrove.
  const STATUS_PUBLIC_MAP = {
    new:     'open',
    draft:   'open',
    todo:    'open',
    clarify: 'open',
    review:  'open',
    blocked: 'open',   // ← CUORE DI SICUREZZA: collassa insieme agli "in lavorazione"
    done:     'closed',
    verified: 'closed',
    ignored:  'closed',
    archived: 'closed',
  };

  /**
   * Funzione pura condivisa: mappa uno status fine al valore pubblico grossolano.
   * Riusata in tutti i percorsi di scrittura di `status`. Da un unico posto.
   * Lookup pigra su SN_FB_STATUS (se caricato) così i due file non impongono un
   * ordine di caricamento; il fallback legacy copre gli stati ritirati.
   *
   * @param {string} fineStatus - Valore `status` fine (es. 'attack', 'done').
   * @returns {'open'|'closed'|'pending-approval'} Valore pubblico sicuro.
   */
  function statusToPublic(fineStatus) {
    const FS = global.SN_FB_STATUS;
    if (FS && FS.PUBLIC_MAP[fineStatus]) return FS.PUBLIC_MAP[fineStatus];
    return STATUS_PUBLIC_MAP[fineStatus] || 'open'; // default safe: unknown → 'open'
  }

  // ---- cifratura campi sensibili (S1.2) ----
  // Cifra un campo testo se la chiave pubblica è disponibile. Guard: se la
  // pubblica non c'è (hasPublicKey() false) restituisce il valore invariato
  // (niente crash, scrittura in chiaro come prima).
  async function maybeEncrypt(value) {
    if (value == null || value === '') return value;
    const C = global.SN_FEEDBACK_CRYPTO;
    if (!C || !C.isEnabled()) return value; // dormiente finché il cutover non accende SN_FEEDBACK_ENC_ENABLED
    try { return await C.encryptForOwner(String(value)); }
    catch (e) { console.warn('[SN feedback] cifratura testo fallita:', e?.message || e); return value; }
  }

  // S1.F2.1: cifra il campo `status` fine quando il gate è acceso.
  // `statusPublic` (il mapping grossolano) viene sempre scritto in chiaro accanto:
  // calcolato PRIMA della cifratura, in modo che i lettori senza chiave privata
  // (C5, board utente) usino quello. Ritorna { fineStatus, publicStatus }.
  async function encryptStatus(status) {
    const publicStatus = statusToPublic(status);
    const fineStatus = await maybeEncrypt(status); // cifra solo se isEnabled()
    return { fineStatus, publicStatus };
  }

  // Cifra i byte di un'immagine prima dell'upload su Storage.
  // Ritorna un Blob con contentType application/octet-stream (il contenuto è
  // opaco: ciphertext Uint8Array). Guard: senza pubkey ritorna il blob originale.
  async function maybeEncryptBlob(blob) {
    const C = global.SN_FEEDBACK_CRYPTO;
    if (!C || !C.isEnabled()) return blob; // dormiente finché il cutover non accende SN_FEEDBACK_ENC_ENABLED
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

  // Carica un allegato (immagine O file) su Storage e lo classifica per la UI.
  // Usata dalla dashboard per allegare immagini/file ai COMMENTI dei feedback
  // (#190.3). Lo storage path feedback/* è scrivibile da chiunque (storage.rules),
  // quindi non serve token. Ritorna { kind:'img'|'file', url, name, type }.
  async function uploadAttachment(blob, name) {
    const u = await uploadImage(blob); // upload generico (usa blob.type)
    const type = (blob && blob.type) || '';
    const kind = type.startsWith('image/') ? 'img' : 'file';
    return {
      kind,
      url: u.url,
      name: String(name || (kind === 'img' ? 'immagine' : 'allegato')),
      type,
    };
  }

  // Converte un valore JS in un Value Firestore REST.
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

  // ---- numerazione progressiva ----
  // Ogni feedback ha un numero leggibile: `seq` (intero progressivo) per i
  // feedback top-level, `seq`+`subSeq` per i sub-feedback creati dalle routine
  // quando spezzano una spec (es. #22 → #22.1, #22.2). formatNum produce la
  // forma mostrata in dashboard.
  function formatNum(seq, subSeq) {
    const s = Number(seq);
    if (!Number.isInteger(s) || s <= 0) return '';
    const sub = Number(subSeq);
    return Number.isInteger(sub) && sub > 0 ? `${s}.${sub}` : String(s);
  }

  // Tronca una stringa a `max` unità visibili senza mai spezzare un carattere
  // a metà. `String.slice` lavora su unità UTF-16: tagliare in mezzo a un'emoji
  // (coppia surrogata) lascerebbe un surrogato solitario che si vede come
  // rettangolino/glifo rotto. Contiamo per grafema (Intl.Segmenter, quando
  // disponibile, tiene insieme anche le emoji composte da più code point come
  // 👨‍👩‍👧 o le emoji col modificatore di tono pelle) con ripiego a code point.
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

  // Prossimo numero progressivo libero: max(seq) + 1. I documenti senza `seq`
  // (storici, mai backfillati) non compaiono nella query: partono da 1.
  // Best-effort: una race fra due invii simultanei può duplicare un numero,
  // accettabile per il volume dell'alpha (il numero è un'etichetta, non una key).
  async function nextSeq() {
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: COLLECTION }],
        orderBy: [{ field: { fieldPath: 'seq' }, direction: 'DESCENDING' }],
        limit: 1,
      },
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`firestore nextSeq fallito (${res.status})`);
    const arr = await res.json();
    const top = arr.find((r) => r.document);
    const max = top ? Number(fromFsValue(top.document.fields?.seq)) : 0;
    return (Number.isInteger(max) && max > 0 ? max : 0) + 1;
  }

  // Invia un feedback. images: array di { dataUrl } (max ~5).
  // files: array di { name, type, dataUrl } per allegati non-immagine (pdf,
  // txt, md, json…), max ~5. `name` è il titolo breve (generato da un LLM nel
  // main process prima della chiamata). Ritorna { id, url } del documento creato.
  // `parentId` (DC4): se presente, questo feedback nasce COLLEGATO a un altro
  // (es. la riapertura di un fix "Risolti" dalla board). Nessuna sub-numerazione
  // automatica qui (quella è solo per le spec spezzate dalle routine, vedi
  // queue-feedback.mjs): il collegato nasce come un feedback normale (numero
  // proprio), `parentId` serve solo a far comparire "collegato a #N" in
  // dashboard e a far risalire chi triagia all'originale.
  async function submit({ text, url, title, userAgent, clientId, clientIdHash, images, files, name, parentId, capabilityGapId, submissionId }) {
    // Allegati che NON sono riusciti a caricarsi: li riportiamo al chiamante
    // così la UI può avvisare l'utente (un upload fallito veniva ingoiato in
    // silenzio e il feedback partiva senza il file, senza alcun segnale).
    const failed = [];
    const imgs = Array.isArray(images) ? images.slice(0, 5) : [];
    const uploaded = [];
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img?.dataUrl) continue;
      const rawBlob = dataUrlToBlob(img.dataUrl);
      // Limite difensivo lato client: 4 MB per immagine (misurato sul raw,
      // prima della cifratura che aggiunge ~90 byte di overhead fisso).
      if (rawBlob.size > 4 * 1024 * 1024) {
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'troppo grande (max 4 MB)' });
        continue;
      }
      try {
        // S1.2: cifra i byte prima dell'upload. Guard inclusa in maybeEncryptBlob:
        // senza pubkey carica il blob originale invariato.
        const blobToUpload = await maybeEncryptBlob(rawBlob);
        const u = await uploadImage(blobToUpload);
        uploaded.push(u.url);
      } catch (e) {
        console.warn('[SN feedback] upload immagine fallito:', e);
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'caricamento non riuscito' });
      }
    }

    // Allegati non-immagine: stesso bucket /feedback, ma conserviamo nome e
    // tipo originali per mostrarli come link scaricabili nella dashboard.
    const docs = Array.isArray(files) ? files.slice(0, 5) : [];
    const uploadedFiles = [];
    for (const f of docs) {
      const fname = String(f?.name || 'allegato');
      if (!f?.dataUrl) { failed.push({ name: fname, reason: 'file vuoto' }); continue; }
      const rawBlob = dataUrlToBlob(f.dataUrl);
      if (rawBlob.size > 4 * 1024 * 1024) { failed.push({ name: fname, reason: 'troppo grande (max 4 MB)' }); continue; }
      try {
        // S1.2: cifra anche gli allegati non-immagine.
        const blobToUpload = await maybeEncryptBlob(rawBlob);
        const u = await uploadImage(blobToUpload); // upload generico (usa blob.type)
        uploadedFiles.push({ url: u.url, name: fname, type: String(f.type || rawBlob.type || '') });
      } catch (e) {
        console.warn('[SN feedback] upload file fallito:', e);
        failed.push({ name: fname, reason: 'caricamento non riuscito' });
      }
    }

    // Numero progressivo: best-effort, il feedback parte anche se la query
    // fallisce (resterà senza numero invece di bloccare l'invio).
    let seq = null;
    try { seq = await nextSeq(); }
    catch (e) { console.warn('[SN feedback] numerazione non disponibile:', e?.message || e); }

    // S1.2 (Fase 1): cifra SOLO il contenuto inviato dall'utente che nessun
    // altro utente deve poter leggere — `text` e `url` (la superficie d'attacco
    // injection + il contesto di navigazione). NON si cifrano `title`/`name`:
    // sono mostrati all'utente che ha inviato il feedback dal popup ricompense
    // (C5), che gira sulla sua macchina SENZA chiave privata → cifrarli li
    // renderebbe illeggibili. Restano per la Fase 2 (con proiezione sanitizzata).
    // Guard: gate dormiente, senza attivazione i valori restano in chiaro.
    const [encText, encUrl] = await Promise.all([
      maybeEncrypt(text || ''),
      maybeEncrypt(url || ''),
    ]);

    // S1.F2.2: hash deterministico del clientId (SHA-256 troncato, 32 hex, in chiaro).
    // Calcolato SEMPRE (anche con gate dormiente) per uniformità del match C5.
    // Se il chiamante ha già calcolato l'hash (es. src/content/feedback.js), riusa quello.
    let resolvedClientIdHash = (typeof clientIdHash === 'string' && clientIdHash.length === 32) ? clientIdHash : '';
    if (!resolvedClientIdHash) {
      try {
        const H = global.SN_FEEDBACK_CLIENT_ID_HASH;
        if (H && H.hashClientId) {
          resolvedClientIdHash = await H.hashClientId(clientId || '');
        }
      } catch (_) {}
    }

    // S1.F2.2: cifra `clientId` se la cifratura è attiva (il match avviene via hash).
    // Con gate dormiente, clientId rimane in chiaro (retrocompat).
    const encClientId = await maybeEncrypt(clientId || '');

    const doc = {
      fields: {
        text: toFsValue(encText),
        url: toFsValue(encUrl),
        title: toFsValue(title || ''),
        name: toFsValue(String(name || '').slice(0, 200)),
        userAgent: toFsValue(userAgent || ''),
        clientId: toFsValue(encClientId),
        // S1.F2.2: hash in chiaro per il match C5 (il raw clientId può essere cifrato).
        clientIdHash: toFsValue(resolvedClientIdHash),
        images: toFsValue(uploaded),
        files: toFsValue(uploadedFiles),
        // S1.F2.1: statusPublic SEMPRE in chiaro anche se status fine è cifrato.
        // Un feedback nuovo parte da 'new' → mappa su 'open'.
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
    // F4 — auto-feedback: id strutturale del gap di capacità (per dedup F5).
    // Solo per feedback auto (`clientId` inizia con 'auto:'), non per quelli utente.
    if (capabilityGapId && String(clientId || '').startsWith('auto:')) {
      doc.fields.capabilityGapId = toFsValue(String(capabilityGapId).slice(0, 100));
    }

    // Idempotenza anti-duplicati (#370): con un submissionId stabile creiamo il
    // documento con QUELL'id (Firestore: `?documentId=`). Così se un invio va in
    // timeout lato UI ma è comunque riuscito sul server, un secondo invio della
    // stessa bozza non crea un duplicato — il server rifiuta il doc già presente.
    const docId = sanitizeDocId(submissionId);
    const idParam = docId ? `documentId=${encodeURIComponent(docId)}&` : '';
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}?${idParam}key=${API_KEY}`;
    let res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (res.status === 403) {
      // Rules non ancora aggiornate ai campi nuovi (name/seq/subSeq/parentId/clientIdHash):
      // meglio un feedback senza numero/titolo/collegamento che un invio
      // fallito. Ritenta con il solo schema storico.
      delete doc.fields.name;
      delete doc.fields.seq;
      delete doc.fields.subSeq;
      delete doc.fields.parentId;
      delete doc.fields.clientIdHash; // S1.F2.2: rules vecchie potrebbero rifiutarlo
      seq = null;
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    }
    // 409 ALREADY_EXISTS con documentId → il feedback è già stato scritto da un
    // tentativo precedente (identico submissionId). Non è un errore: successo
    // idempotente, nessun duplicato creato.
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

  // Lista tutti i feedback (più recenti prima). Usata dalla dashboard e dalla
  // bacheca. `timeoutMs` (opzionale): se > 0, la fetch si arrende dopo quel tempo
  // invece di restare muta finché il sistema operativo non decide di mollare
  // (offline, un `fetch` del renderer può impiegare ~13 s prima di fallire da
  // solo). Chi lo passa vuole poter mostrare uno stato d'errore in tempi umani;
  // chi lo omette mantiene il comportamento storico (nessun timeout).
  async function list({ pageSize = 200, timeoutMs = 0 } = {}) {
    // structuredQuery via runQuery, ordinamento per createdAt DESC.
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: COLLECTION }],
        orderBy: [
          { field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' },
        ],
        limit: pageSize,
      },
    };
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    // Timeout opzionale via AbortController. Se scatta, rilanciamo un errore con
    // "timeout" nel messaggio: così SN_CHAT_ERRORS lo riconosce come guasto di
    // rete (e non come annullamento volontario, che invece non va segnalato).
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

  // Aggiorna stato/note di un feedback esistente. status ∈ new|todo|done|verified|ignored.
  // opts.idToken (Firebase ID token) viene allegato come Bearer: serve perché le
  // Firestore rules verifichino che l'utente è un admin. Senza token la scrittura
  // riuscirà solo se le regole consentono l'accesso anonimo (sconsigliato).
  async function updateStatus(id, { status, notes, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride }, opts = {}) {
    if (!id) throw new Error('id mancante');
    const idToken = opts.idToken;
    const fields = {};
    const mask = [];
    if (status !== undefined) {
      // S1.F2.1: cifra status fine se il gate è on; scrivi SEMPRE statusPublic in chiaro.
      const { fineStatus, publicStatus } = await encryptStatus(status);
      fields.status = toFsValue(fineStatus);
      mask.push('status');
      fields.statusPublic = toFsValue(publicStatus);
      mask.push('statusPublic');
    }
    // Fase 1: `notes` NON è cifrato — è la spiegazione mostrata all'utente nel
    // popup ricompense (C5) sulla sua macchina, che non ha la chiave privata.
    // Cifrarlo (insieme a status/verdetti) è Fase 2, con una proiezione
    // sanitizzata user-facing separata.
    // La conversazione ha un tetto (SN_FEEDBACK_THREAD.capNotes): oltre quello
    // le regole respingono OGNI scrittura successiva sul feedback, non solo
    // quella sulle note — il feedback resterebbe immobile. Tagliamo i turni più
    // vecchi qui, così il caso non si presenta mai da questo cammino.
    if (notes !== undefined) {
      const T = global.SN_FEEDBACK_THREAD;
      const capped = T && T.capNotes ? T.capNotes(notes) : notes;
      fields.notes = toFsValue(capped); mask.push('notes');
    }
    // Override di revisione (owner sblocca un feedback fermato dalla sicurezza).
    // #476 — LA REVISIONE DELL'OWNER VIAGGIA TUTTA CIFRATA.
    //
    // Questi tre campi li scrive solo la dashboard dell'owner, quando sblocca o
    // CONFERMA un feedback fermato dalla sicurezza. Le letture della collezione
    // sono pubbliche, quindi in chiaro erano un annuncio a chi aveva mandato
    // quel feedback:
    //   · `reviewComment` diceva il PERCHÉ era stato beccato — il manuale per
    //     riprovare meglio;
    //   · `reviewDecision` diceva l'esito con una parola sola ('rejected');
    //   · e persino la SOLA PRESENZA di `reviewedAt` bastava: un feedback
    //     normale non ce l'ha, quindi vederlo significa "sei passato dalle mani
    //     dell'owner", cioè sei stato fermato.
    // Non basta cifrarne uno: l'attaccante gli bastava il campo rimasto. Vanno
    // insieme, o non serve a niente.
    //
    // Li rilegge solo chi ha la chiave: la dashboard (che li decifra prima di
    // mostrarli) e il backend di sicurezza, che su `reviewDecision === 'accepted'`
    // sa di non dover ri-bloccare un feedback che l'owner ha sbloccato a mano —
    // per questo la sua lista di campi da decifrare li comprende.
    // Retrocompat: i valori vecchi in chiaro continuano a leggersi.
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
    // Preferito ⭐ (DB2): bool, "parcheggio per il futuro". Le Firestore rules
    // accettano `starred` (is bool) nel ramo update admin.
    if (starred !== undefined) { fields.starred = { booleanValue: !!starred }; mask.push('starred'); }
    // Override owner per l'auto-archiviazione a punteggio (DC3, vedi
    // boardArchive.js): 'archived' | 'keep_open' | '' (nessun override).
    if (archiveOverride !== undefined) { fields.archiveOverride = toFsValue(archiveOverride); mask.push('archiveOverride'); }
    if (priority !== undefined) {
      // Priorità 1-3 (0 = nessuna). Clamp PRIMA di cifrare.
      const p = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
      // S1.priority: con cifratura attiva, `priority` va scritto come stringValue
      // (ciphertext FENC1:). Senza cifratura, integerValue come prima (retrocompat).
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
    // priorityManual: flag booleano, non cifrato (indica che l'owner ha fissato
    // la priorità a mano — il backend di sicurezza lo usa per saltare l'override
    // automatico). Scritto solo quando esplicitamente passato `true`.
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

  // ---- voti di verifica (DB4) ----
  // Substrato dei voti "funziona / non funziona" che la board utente (DC*) e
  // l'archiviazione automatica a punteggio (DC3) leggono. I voti vivono in un
  // campo `votes` (map) SUL documento feedback: chiave = uid del votante, valore
  // = { vote, at, credibilitySnapshot }. Un voto per utente, cambiabile.
  // Le Firestore rules vincolano ogni utente a scrivere SOLO la propria chiave.
  const VOTE_WORKS = 'works';
  const VOTE_BROKEN = 'broken';
  const VOTE_VALUES = [VOTE_WORKS, VOTE_BROKEN];

  // Credibilità di default di un votante: 1 "per ora" (DC3 — il substrato
  // credibilità per-utente arriva con DC5; finché non c'è, ogni voto pesa 1).
  function normalizeCredibility(v) {
    const c = Number(v);
    return Number.isFinite(c) && c >= 0 ? c : 1;
  }

  // PURA: ripulisce un map di voti grezzo (es. da fsDocToObject) tenendo solo le
  // entry ben formate. Scarta voti con `vote` non valido o entry non-oggetto;
  // normalizza `at` (stringa) e `credibilitySnapshot` (numero ≥ 0, default 1).
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

  // PURA: conteggi e punteggio derivati dai voti. score = Σ credibilità("works")
  // − Σ credibilità("broken") (DC3). total = numero di votanti validi.
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

  // PURA: il voto corrente di un utente ('works' | 'broken' | null).
  function userVote(raw, uid) {
    if (!uid) return null;
    const votes = normalizeVotes(raw);
    return votes[uid] ? votes[uid].vote : null;
  }

  // RETE: l'utente loggato esprime/cambia il proprio voto su un feedback.
  // Scrive solo `votes.<uid>` (updateMask mirato → non tocca altri voti né altri
  // campi). `opts.idToken` = Firebase ID token del votante (le rules verificano
  // chiave==uid). Ritorna l'entry scritta.
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
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
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

  // RETE: l'utente ritira il proprio voto (cancella `votes.<uid>`). updateMask
  // sul field path SENZA includerlo nel body → Firestore elimina solo quella
  // chiave, lasciando intatti i voti altrui.
  async function clearVote(id, uid, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    const fieldPath = `votes.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const res = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ fields: {} }) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore clearVote fallito (${res.status}): ${t.slice(0, 300)}`);
    }
    return true;
  }

  // ---- riapertura a pagamento (DC4) ----
  // RETE: marca SUL FEEDBACK ORIGINALE che l'uid ha chiesto la riapertura.
  // Scrive solo `reopenRequests.<uid>` (updateMask mirato, stesso pattern non-
  // admin di castVote): un utente normale NON può toccare `status` di un doc
  // che non ha creato (ramo admin delle regole, vedi firestore.rules) — flippare
  // l'originale fuori da "Risolti" resta al percorso fidato (routine/owner) che
  // legge questo campo. Qui scriviamo solo il SEGNALE + (nel chiamante) creiamo
  // il feedback collegato: è la parte che un utente può fare da solo.
  async function castReopenRequest(id, uid, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    const entry = { at: new Date().toISOString() };
    const fieldPath = `reopenRequests.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
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
    updateStatus,
    // S1.F2.1: mapping status fine → valore pubblico grossolano (in chiaro).
    // Esportata perché apply-triage.mjs (script .mjs) la riusa per scrivere statusPublic.
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
    formatNum,
    fallbackName,
    // Plumbing REST riutilizzabile (es. dal motore crediti): encoder Value
    // Firestore + endpoint/base. L'API_KEY è la chiave web pubblica Firebase
    // (già nel client), non un segreto.
    toFsValue,
    fromFsValue,
    fsDocToObject,
    rest: { FIRESTORE_BASE, API_KEY, PROJECT_ID },
    configPublic: { projectId: PROJECT_ID, bucket: BUCKET, collection: COLLECTION },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
