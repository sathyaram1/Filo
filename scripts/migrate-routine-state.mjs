// migrate-routine-state.mjs — travasa sul server lo stato dei rami in corso.
//
// PERCHÉ ESISTE (spec ROUTINE-AUTH-SPEC.md §8.5)
//   Lo stato del giro — chi ha verificato cosa, quante volte una correzione ha
//   fallito, se il controllo di sicurezza è passato — viveva nei file dentro
//   `feedback-triage/state/`. Smontando la coda su git quei file spariscono: se
//   non si travasa prima, i rami già in volo ripartono da capo come se nessuno
//   li avesse mai verificati, e il contatore delle bocciature si azzera (una
//   correzione che aveva già fallito due volte ricomincia da zero).
//
//   Gira UNA VOLTA, con le credenziali dell'owner. Poi si può cancellare
//   insieme al resto.
//
// USO
//   node scripts/migrate-routine-state.mjs            # mostra cosa farebbe
//   node scripts/migrate-routine-state.mjs --applica  # travasa

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findAdminRefreshToken, mintIdToken } from './lib/firestore-auth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = resolve(ROOT, 'feedback-triage', 'state');
const BASE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

const APPLICA = process.argv.includes('--applica');

/** Gli stati sul disco, quelli leggibili. PURA rispetto al contenuto. */
export function leggiStati(dir = STATE_DIR) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const nome of readdirSync(dir)) {
    if (!nome.endsWith('.json')) continue;
    try {
      const o = JSON.parse(readFileSync(resolve(dir, nome), 'utf8'));
      if (o && typeof o === 'object' && o.id) out.push(o);
    } catch (_) { /* un file illeggibile non ferma il travaso degli altri */ }
  }
  return out;
}

/**
 * Vale la pena travasarlo? PURA.
 *
 * Uno stato senza verdetti e senza bocciature non dice niente che il server non
 * sappia già ricavare dallo status del feedback: travasarlo aggiungerebbe righe
 * senza aggiungere informazione.
 */
export function daTravasare(s) {
  if (!s) return false;
  return !!(s.verifierVerdict || s.secauditDone || (Number(s.loopCount) || 0) > 0 || s.verifierCritique);
}

const stati = leggiStati();
const utili = stati.filter(daTravasare);
console.log(`Stati sul disco: ${stati.length} — con qualcosa da salvare: ${utili.length}`);
for (const s of stati) {
  const marca = daTravasare(s) ? '→' : ' ·';
  console.log(`  ${marca} ${s.id}  verifica=${s.verifierVerdict || '—'} bocciature=${s.loopCount || 0} sicurezza=${s.secauditDone ? (s.secauditVerdict || 'fatta') : '—'}`);
}

if (!APPLICA) {
  console.log('\n(prova a vuoto: rilancia con --applica per travasare)');
  process.exit(0);
}

const idToken = await mintIdToken(findAdminRefreshToken());
let fatti = 0;
for (const s of utili) {
  const res = await fetch(`${BASE}/routineStateAdmin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: { op: 'put', feedbackId: s.id, state: s } }),
  });
  if (res.ok) { fatti++; console.log(`  ok ${s.id}`); }
  else console.error(`  ERRORE ${s.id}: ${res.status} ${(await res.text()).slice(0, 160)}`);
}
console.log(`\nTravasati ${fatti}/${utili.length}.`);
process.exit(fatti === utili.length ? 0 : 1);
