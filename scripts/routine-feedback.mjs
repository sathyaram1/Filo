// Triage feedback dal ruolo limitato `routines` (per le routine cloud).
//
// COSA FA
//   Legge il refresh token Firebase dell'account robot dalla variabile
//   d'ambiente `FILO_ROUTINE_REFRESH_TOKEN`, lo scambia per un ID token Firebase
//   di breve durata (endpoint securetoken, solo API key pubblica), e fa la PATCH
//   REST sul documento feedback con `Authorization: Bearer <idToken>`.
//
//   Sotto le Firestore rules il ruolo `routines` può SOLO spostare lo status tra
//   `todo`/`done`/`clarify` e scrivere `notes` (+ `resolvedAt` quando chiude in
//   `done`). Niente priority, niente verified/ignored, niente delete: se provi
//   altro, Firestore risponde 403. È il contenimento voluto del ruolo.
//
// USO (CLI):
//   node scripts/routine-feedback.mjs <id> <status:todo|done|clarify> [noteText]
//   - se chiudi in `done`, resolvedAt viene impostato a "ora" automaticamente.
//
// USO (modulo):
//   import { updateFeedback } from './scripts/routine-feedback.mjs';
//   await updateFeedback(id, { status: 'done', notes: '...' });

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = require(resolve(__dirname, '..', 'src', 'main', 'auth', 'config.js'));

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${cfg.firebaseProjectId}/databases/(default)/documents`;
const COLLECTION = 'feedback';
const ALLOWED_STATUS = ['todo', 'done', 'clarify'];

// Refresh token Firebase → ID token (breve durata). Solo API key pubblica.
async function mintIdToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('Manca FILO_ROUTINE_REFRESH_TOKEN: esegui prima `node scripts/routine-login.mjs` con l\'account robot.');
  }
  const res = await fetch(`${cfg.secureTokenEndpoint}?key=${cfg.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`refresh sessione routine fallito (${res.status}): ${(await res.text()).slice(0, 300)}. Il refresh token potrebbe essere revocato: rigeneralo con routine-login.mjs.`);
  }
  const j = await res.json();
  return j.id_token;
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  throw new Error('tipo non supportato per Firestore value');
}

// Aggiorna un feedback come ruolo routine. payload: { status, notes }.
export async function updateFeedback(id, payload, opts = {}) {
  if (!id) throw new Error('id mancante');
  const status = payload.status;
  if (!ALLOWED_STATUS.includes(status)) {
    throw new Error(`status non consentito al ruolo routine: "${status}" (ammessi: ${ALLOWED_STATUS.join(', ')})`);
  }

  const idToken = opts.idToken || await mintIdToken(process.env.FILO_ROUTINE_REFRESH_TOKEN);

  const fields = { status: toFsValue(status) };
  const mask = ['status'];
  if (typeof payload.notes === 'string') { fields.notes = toFsValue(payload.notes); mask.push('notes'); }
  if (status === 'done') { fields.resolvedAt = toFsValue(new Date().toISOString()); mask.push('resolvedAt'); }

  const qs = mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?${qs}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`feedback_update (routine) fallito (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

// CLI
const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [, , id, status, ...noteParts] = process.argv;
  if (!id || !status) {
    console.error('Uso: node scripts/routine-feedback.mjs <id> <status:todo|done|clarify> [noteText]');
    process.exit(1);
  }
  const notes = noteParts.length ? noteParts.join(' ') : undefined;
  updateFeedback(id, { status, notes })
    .then(() => console.log(`OK: feedback ${id} → ${status}`))
    .catch((e) => { console.error('Errore:', e.message); process.exit(1); });
}
