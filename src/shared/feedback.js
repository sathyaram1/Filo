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

  // Titolo di ripiego quando l'LLM non è disponibile: prime parole del testo.
  function fallbackName(text, maxWords = 6) {
    const words = String(text || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!words.length) return '';
    let out = words.slice(0, maxWords).join(' ');
    if (out.length > 60) return out.slice(0, 57).trimEnd() + '…';
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
  async function submit({ text, url, title, userAgent, clientId, images, files, name }) {
    // Allegati che NON sono riusciti a caricarsi: li riportiamo al chiamante
    // così la UI può avvisare l'utente (un upload fallito veniva ingoiato in
    // silenzio e il feedback partiva senza il file, senza alcun segnale).
    const failed = [];
    const imgs = Array.isArray(images) ? images.slice(0, 5) : [];
    const uploaded = [];
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img?.dataUrl) continue;
      const blob = dataUrlToBlob(img.dataUrl);
      // Limite difensivo lato client: 4 MB per immagine.
      if (blob.size > 4 * 1024 * 1024) {
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'troppo grande (max 4 MB)' });
        continue;
      }
      try {
        const u = await uploadImage(blob);
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
      const blob = dataUrlToBlob(f.dataUrl);
      if (blob.size > 4 * 1024 * 1024) { failed.push({ name: fname, reason: 'troppo grande (max 4 MB)' }); continue; }
      try {
        const u = await uploadImage(blob); // upload generico (usa blob.type)
        uploadedFiles.push({ url: u.url, name: fname, type: String(f.type || blob.type || '') });
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

    const doc = {
      fields: {
        text: toFsValue(text || ''),
        url: toFsValue(url || ''),
        title: toFsValue(title || ''),
        name: toFsValue(String(name || '').slice(0, 200)),
        userAgent: toFsValue(userAgent || ''),
        clientId: toFsValue(clientId || ''),
        images: toFsValue(uploaded),
        files: toFsValue(uploadedFiles),
        createdAt: { timestampValue: new Date().toISOString() },
      },
    };
    if (seq) {
      doc.fields.seq = { integerValue: String(seq) };
      doc.fields.subSeq = { integerValue: '0' };
    }

    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}?key=${API_KEY}`;
    let res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (res.status === 403) {
      // Rules non ancora aggiornate ai campi nuovi (name/seq/subSeq): meglio
      // un feedback senza numero/titolo che un invio fallito. Ritenta con il
      // solo schema storico.
      delete doc.fields.name;
      delete doc.fields.seq;
      delete doc.fields.subSeq;
      seq = null;
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore create fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const json = await res.json();
    return { id: json.name?.split('/').pop() || '', seq, images: uploaded, files: uploadedFiles, failed };
  }

  // Lista tutti i feedback (più recenti prima). Usata dalla dashboard.
  async function list({ pageSize = 200 } = {}) {
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
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
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
  async function updateStatus(id, { status, notes, priority }, opts = {}) {
    if (!id) throw new Error('id mancante');
    const idToken = opts.idToken;
    const fields = {};
    const mask = [];
    if (status !== undefined) { fields.status = toFsValue(status); mask.push('status'); }
    if (notes !== undefined) { fields.notes = toFsValue(notes); mask.push('notes'); }
    if (priority !== undefined) {
      // Priorità 1-3 (0 = nessuna). Le regole Firestore validano int 0..3.
      const p = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
      fields.priority = { integerValue: String(p) };
      mask.push('priority');
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

  global.SN_FEEDBACK = {
    submit,
    list,
    updateStatus,
    uploadImage,
    uploadAttachment,
    formatNum,
    fallbackName,
    configPublic: { projectId: PROJECT_ID, bucket: BUCKET, collection: COLLECTION },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
