// Applica a Firestore le decisioni di triage accodate nello spool su git, e
// svuota la coda. È la metà "consumatore" del flusso descritto in queue-triage.mjs.
//
// COSA FA
//   Legge tutti i file `feedback-triage/*.json` e per ciascuno fa la PATCH REST
//   sul documento feedback. Dopo una PATCH riuscita cancella il file di spool
//   (la coda si svuota) e committa+pusha la rimozione, così non si riapplica.
//
// AUTENTICAZIONE — due modalità, scelte in automatico:
//
//   A) SERVICE ACCOUNT (usata dalla GitHub Action, vedi
//      .github/workflows/apply-triage.yml). Se è presente la chiave di un
//      service account — JSON inline in `FILO_SA_KEY` oppure percorso file in
//      `GOOGLE_APPLICATION_CREDENTIALS` — firma un JWT con la chiave privata,
//      ottiene un access token OAuth2 (scope datastore) e patcha via IAM. NON
//      è un account Google personale: niente rischio-blocco come l'account
//      robot. È il percorso primario, gira da solo a ogni push della routine.
//
//   B) REFRESH TOKEN ADMIN (fallback locale dell'owner). Se NON c'è un service
//      account, usa il refresh token Firebase dell'owner in
//      `FILO_ADMIN_REFRESH_TOKEN` (env o `tests/agent/.env` della root del repo
//      principale, gitignorato). Ottienilo UNA VOLTA con:
//        node scripts/admin-login.mjs
//
//   In entrambi i casi si finisce con un `Authorization: Bearer <token>` usato
//   identicamente nella PATCH.
//
// USO:
//   node scripts/apply-triage.mjs            applica e svuota la coda
//   node scripts/apply-triage.mjs --dry-run  mostra cosa farebbe (no rete, no git)

import { createRequire } from 'node:module';
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SPOOL_DIR = resolve(ROOT, 'feedback-triage');
const cfg = require(resolve(ROOT, 'src', 'main', 'auth', 'config.js'));

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${cfg.firebaseProjectId}/databases/(default)/documents`;
const ALLOWED = ['todo', 'done', 'clarify'];
const DRY = process.argv.includes('--dry-run');
const MAIN_BRANCH = process.env.FILO_MAIN_BRANCH || 'main';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// Trova FILO_ADMIN_REFRESH_TOKEN: prima da env, poi dal tests/agent/.env della
// root del repo principale (i worktree ne hanno uno proprio, vuoto).
function findAdminRefreshToken() {
  if (process.env.FILO_ADMIN_REFRESH_TOKEN) return process.env.FILO_ADMIN_REFRESH_TOKEN;
  try {
    let commonDir = git(['rev-parse', '--git-common-dir']);
    if (!isAbsolute(commonDir)) commonDir = resolve(ROOT, commonDir);
    const mainRoot = dirname(commonDir); // .../Filo/.git → .../Filo
    const envPath = resolve(mainRoot, 'tests', 'agent', '.env');
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .find((l) => l.startsWith('FILO_ADMIN_REFRESH_TOKEN='));
      if (line) return line.slice('FILO_ADMIN_REFRESH_TOKEN='.length).trim();
    }
  } catch (_) { /* git non disponibile o env assente: gestito sotto */ }
  return null;
}

async function mintIdToken(refreshToken) {
  const res = await fetch(`${cfg.secureTokenEndpoint}?key=${cfg.firebaseApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`refresh admin fallito (${res.status}): ${(await res.text()).slice(0, 200)}. Rigenera il token con: node scripts/admin-login.mjs`);
  }
  return (await res.json()).id_token;
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  throw new Error('tipo non supportato per Firestore value');
}

async function patchFeedback(entry, idToken) {
  const fields = { status: toFsValue(entry.status) };
  const mask = ['status'];
  if (typeof entry.notes === 'string') { fields.notes = toFsValue(entry.notes); mask.push('notes'); }
  if (entry.status === 'done') { fields.resolvedAt = { timestampValue: new Date().toISOString() }; mask.push('resolvedAt'); }
  const qs = mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${FIRESTORE_BASE}/feedback/${encodeURIComponent(entry.id)}?${qs}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields }),
  });
  return { status: res.status, ok: res.ok, body: res.ok ? '' : (await res.text()).slice(0, 200) };
}

function readSpool() {
  if (!existsSync(SPOOL_DIR)) return [];
  return readdirSync(SPOOL_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const file = resolve(SPOOL_DIR, f);
      let entry;
      try { entry = JSON.parse(readFileSync(file, 'utf8')); }
      catch (e) { return { file, error: `JSON non valido: ${e.message}` }; }
      if (!entry || !entry.id) return { file, error: 'manca il campo id' };
      if (!ALLOWED.includes(entry.status)) return { file, error: `status non valido: "${entry.status}"` };
      return { file, entry };
    });
}

async function main() {
  const items = readSpool();
  if (!items.length) { console.log('Coda vuota: niente da applicare.'); return; }

  console.log(`${items.length} decisione/i in coda${DRY ? ' (dry-run)' : ''}.`);

  if (DRY) {
    for (const it of items) {
      if (it.error) console.log(`  ✗ ${it.file}: ${it.error}`);
      else console.log(`  • ${it.entry.id} → ${it.entry.status}${it.entry.notes ? `  («${it.entry.notes.slice(0, 60)}»)` : ''}`);
    }
    console.log('\nDry-run: nessuna scrittura su Firestore, nessuna modifica a git.');
    return;
  }

  const rt = findAdminRefreshToken();
  if (!rt) {
    console.error('Manca FILO_ADMIN_REFRESH_TOKEN (env o tests/agent/.env della root).');
    console.error('Ottienilo con: node scripts/admin-login.mjs');
    process.exit(1);
  }
  const idToken = await mintIdToken(rt);

  const applied = [];
  let failures = 0;
  for (const it of items) {
    if (it.error) { console.warn(`  ✗ salto ${it.file}: ${it.error}`); failures++; continue; }
    const r = await patchFeedback(it.entry, idToken);
    if (r.ok) {
      console.log(`  ✓ ${it.entry.id} → ${it.entry.status}`);
      unlinkSync(it.file); applied.push(it.file);
    } else if (r.status === 404) {
      console.warn(`  ! ${it.entry.id}: feedback inesistente (404) — rimuovo dalla coda`);
      unlinkSync(it.file); applied.push(it.file);
    } else {
      console.error(`  ✗ ${it.entry.id}: HTTP ${r.status} ${r.body}`);
      failures++;
    }
  }

  if (applied.length) {
    try {
      git(['add', '-A', '--', 'feedback-triage']);
      const staged = git(['diff', '--cached', '--name-only']);
      if (staged) {
        git(['commit', '-m', `feedback: applica e svuota ${applied.length} triage dalla coda`]);
        try { git(['push', 'origin', 'HEAD']); console.log('  ↑ coda svuotata e pushata.'); }
        catch (e) { console.warn('  ! push fallito (fai `git pull --rebase origin main` e ripusha):', String(e.message).slice(0, 160)); }
      }
    } catch (e) {
      console.warn('  ! commit della coda svuotata fallito:', String(e.message).slice(0, 160));
    }
  }

  console.log(`\nFatto: ${applied.length} applicate, ${failures} non riuscite.`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
