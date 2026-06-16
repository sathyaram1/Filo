// Upload di un allegato (screenshot) a Firebase Storage sul path /feedback.
//
// PERCHÉ ESISTE
//   Quando una routine cloud deposita un feedback d'audit (vedi
//   queue-feedback.mjs) vuole allegare la PROVA VISIVA del problema — uno
//   screenshot che mostra l'errore — così l'utente lo verifica a colpo d'occhio
//   senza dover ricostruire il bug dal testo. Le storage.rules consentono
//   l'upload su /feedback/* SENZA autenticazione (fino a 4 MB, content-type
//   immagine/testo/pdf): è la stessa porta che usa l'app
//   (src/shared/feedback.js → uploadImage). Quindi la routine carica il file al
//   momento dell'accodamento — ha già rete (fa git push) — e mette solo l'URL
//   pubblico risultante nell'entry della coda. L'applier non tocca i byte:
//   scrive l'URL nel campo `images` del documento feedback.

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Stesso bucket usato dall'app (src/shared/feedback.js). Tenuto in sync a mano:
// se cambia lì, cambialo qui.
const BUCKET = 'filo-8b9cb.firebasestorage.app';
const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;
const MAX_BYTES = 4 * 1024 * 1024; // limite delle storage.rules

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Logica pura (testabile senza rete): mime da estensione, default PNG.
export function mimeForPath(p) {
  return MIME_BY_EXT[extname(String(p)).toLowerCase()] || 'image/png';
}

// Upload di un buffer immagine. Ritorna l'URL pubblico (con download token,
// così il link funziona anche con read aperto ma cache-busting coerente).
export async function uploadImageBuffer(buf, mime) {
  const ext = (String(mime).split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
  const name = `feedback/${Date.now()}_${randomUUID()}.${ext}`;
  const endpoint = `${STORAGE_BASE}?uploadType=media&name=${encodeURIComponent(name)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': mime || 'application/octet-stream' },
    body: buf,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`upload storage fallito (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const token = json.downloadTokens || json.metadata?.downloadTokens || '';
  return `${STORAGE_BASE}/${encodeURIComponent(name)}?alt=media${token ? `&token=${token}` : ''}`;
}

// Legge un file locale e lo carica. Lancia con un messaggio chiaro se il file
// supera il limite delle rules (4 MB) — meglio dirlo che farsi rifiutare con un
// 403 opaco.
export async function uploadScreenshotFile(path) {
  const buf = readFileSync(path); // lancia ENOENT se il path è sbagliato
  if (buf.length > MAX_BYTES) {
    throw new Error(`${basename(path)} troppo grande (${(buf.length / 1048576).toFixed(1)} MB, max 4 MB)`);
  }
  return uploadImageBuffer(buf, mimeForPath(path));
}
