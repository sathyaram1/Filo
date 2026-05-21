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

  // Invia un feedback. images: array di { dataUrl } (max ~5).
  // Ritorna { id, url } del documento creato.
  async function submit({ text, url, title, userAgent, clientId, images }) {
    const imgs = Array.isArray(images) ? images.slice(0, 5) : [];
    const uploaded = [];
    for (const img of imgs) {
      if (!img?.dataUrl) continue;
      const blob = dataUrlToBlob(img.dataUrl);
      // Limite difensivo lato client: 4 MB per immagine.
      if (blob.size > 4 * 1024 * 1024) continue;
      try {
        const u = await uploadImage(blob);
        uploaded.push(u.url);
      } catch (e) {
        console.warn('[SN feedback] upload immagine fallito:', e);
      }
    }

    const doc = {
      fields: {
        text: toFsValue(text || ''),
        url: toFsValue(url || ''),
        title: toFsValue(title || ''),
        userAgent: toFsValue(userAgent || ''),
        clientId: toFsValue(clientId || ''),
        images: toFsValue(uploaded),
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
      throw new Error(`firestore create fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const json = await res.json();
    return { id: json.name?.split('/').pop() || '', images: uploaded };
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
  async function updateStatus(id, { status, notes }) {
    if (!id) throw new Error('id mancante');
    const fields = {};
    const mask = [];
    if (status !== undefined) { fields.status = toFsValue(status); mask.push('status'); }
    if (notes !== undefined) { fields.notes = toFsValue(notes); mask.push('notes'); }
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
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
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
    configPublic: { projectId: PROJECT_ID, bucket: BUCKET, collection: COLLECTION },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
