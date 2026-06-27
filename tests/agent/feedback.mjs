// Push delle issue trovate dagli agenti nella collezione `feedback` di Firestore
// (stesso DB dei feedback alpha), in una "categoria" dedicata.
//
// Le Firestore rules accettano in CREATE solo i campi:
//   text, url, title, userAgent, clientId, images, createdAt
// quindi NON possiamo aggiungere campi nuovi (source/model/…) senza toccare le
// rules (che vivono nell'extension, congelata). Codifichiamo perciò la
// provenienza dentro i campi consentiti:
//   clientId = "agent:<model>"           → categoria + modello
//   title    = "<severity>|<area>|<titolo>"
//   text     = dettaglio
//   url      = dove è stato trovato (filo://…)
//   images   = [screenshot]
// La pagina feedback riconosce il prefisso "agent:" e mostra tutto come categoria
// dedicata con badge del modello. Vedi src/pages/feedback/feedback.js.

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Stessi valori (pubblici) di src/shared/feedback.js.
const PROJECT_ID = 'filo-8b9cb';
const BUCKET = 'filo-8b9cb.firebasestorage.app';
const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
const COLLECTION = 'feedback';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

async function uploadImage(buffer, mime = 'image/png') {
  const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
  const name = `${COLLECTION}/agent_${Date.now()}_${randomUUID()}.${ext}`;
  const url = `${STORAGE_BASE}?uploadType=media&name=${encodeURIComponent(name)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': mime }, body: buffer });
  if (!res.ok) throw new Error(`upload storage ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
  const json = await res.json();
  const token = json.downloadTokens || json.metadata?.downloadTokens || '';
  return `${STORAGE_BASE}/${encodeURIComponent(name)}?alt=media${token ? `&token=${token}` : ''}`;
}

// Crea un documento feedback per una issue d'agente.
export async function pushIssue({ model, severity, area, title, detail, foundAt, screenshotPath }) {
  let images = [];
  if (screenshotPath) {
    try {
      const buf = readFileSync(screenshotPath);
      if (buf.length <= 4 * 1024 * 1024) images = [await uploadImage(buf)];
    } catch (_) { /* niente immagine: il feedback resta valido */ }
  }
  // pipe-encoding compatto: severità|area|titolo (la pagina lo splitta).
  const encTitle = `${severity || 'low'}|${(area || '?').replace(/\|/g, '/')}|${(title || '(senza titolo)').replace(/\|/g, '/')}`.slice(0, 500);
  const doc = {
    fields: {
      text: toFsValue((detail || '').slice(0, 10000)),
      url: toFsValue((foundAt || '').slice(0, 2000)),
      title: toFsValue(encTitle),
      userAgent: toFsValue('filo-agent'),
      clientId: toFsValue(`agent:${(model || 'unknown')}`.slice(0, 100)),
      images: toFsValue(images),
      createdAt: { timestampValue: new Date().toISOString() },
    },
  };
  const endpoint = `${FIRESTORE_BASE}/${COLLECTION}?key=${API_KEY}`;
  const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
  if (!res.ok) throw new Error(`firestore create ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json = await res.json();
  return { id: json.name?.split('/').pop() || '', images };
}
