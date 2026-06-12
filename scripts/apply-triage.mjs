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
// FILO_SPOOL_DIR: override per i test (vedi queue-triage.mjs).
const SPOOL_DIR = process.env.FILO_SPOOL_DIR
  ? resolve(process.env.FILO_SPOOL_DIR)
  : resolve(ROOT, 'feedback-triage');
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

// --- Modalità service account (CI) -----------------------------------------

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

// Carica la chiave del service account: JSON inline in FILO_SA_KEY (GitHub
// Secret) oppure percorso a file in GOOGLE_APPLICATION_CREDENTIALS. Null se
// nessuna delle due è presente → si userà il fallback admin.
function loadServiceAccount() {
  const inline = process.env.FILO_SA_KEY;
  if (inline && inline.trim()) {
    try { return JSON.parse(inline); }
    catch (e) { throw new Error(`FILO_SA_KEY non è JSON valido: ${e.message}`); }
  }
  const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (p && existsSync(p)) {
    try { return JSON.parse(readFileSync(p, 'utf8')); }
    catch (e) { throw new Error(`GOOGLE_APPLICATION_CREDENTIALS (${p}) non è JSON valido: ${e.message}`); }
  }
  return null;
}

// Firma un JWT con la chiave privata del service account e lo scambia con un
// access token OAuth2 (scope datastore). Con questo bearer le PATCH passano per
// l'IAM e bypassano le security rules — non serve essere nei doc `admins`.
async function mintAccessTokenFromSA(sa) {
  if (!sa.client_email || !sa.private_key) {
    throw new Error('chiave service account incompleta (mancano client_email/private_key)');
  }
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = b64url(createSign('RSA-SHA256').update(signingInput).sign(sa.private_key));
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`token service account fallito (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()).access_token;
}

// Ritorna il bearer token da usare nelle PATCH, scegliendo la modalità:
// service account se disponibile, altrimenti refresh token admin.
async function acquireBearer() {
  const sa = loadServiceAccount();
  if (sa) {
    console.log(`Auth: service account (${sa.client_email}).`);
    return mintAccessTokenFromSA(sa);
  }
  const rt = findAdminRefreshToken();
  if (!rt) {
    console.error('Nessuna credenziale per scrivere su Firestore. Servono UNA delle due:');
    console.error('  • service account: FILO_SA_KEY (JSON) o GOOGLE_APPLICATION_CREDENTIALS (percorso file)');
    console.error('  • owner: FILO_ADMIN_REFRESH_TOKEN (env o tests/agent/.env della root) — node scripts/admin-login.mjs');
    process.exit(1);
  }
  console.log('Auth: refresh token admin (owner).');
  return mintIdToken(rt);
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  throw new Error('tipo non supportato per Firestore value');
}

// Legge un campo intero da un documento Firestore REST (0 se assente).
function intField(doc, name) {
  const v = doc?.fields?.[name];
  const n = v && 'integerValue' in v ? Number(v.integerValue) : NaN;
  return Number.isInteger(n) ? n : 0;
}

async function getDoc(id, bearer) {
  const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore get fallito (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function runQuery(structuredQuery, bearer) {
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`firestore query fallita (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const arr = await res.json();
  return arr.filter((r) => r.document).map((r) => r.document);
}

// ─── Numerazione (#22, #22.1) per i feedback creati dalla coda ──────────────
// Allocatore con cache di run: se nella stessa run ci sono più creazioni
// (es. una spec spezzata in 5 sub-feedback) i numeri escono consecutivi senza
// rileggere Firestore a ogni giro.
function makeNumberAllocator(bearer) {
  let nextTop = null; // prossimo seq top-level libero
  const nextSub = new Map(); // seq padre → prossimo subSeq libero

  async function allocTop() {
    if (nextTop === null) {
      const docs = await runQuery({
        from: [{ collectionId: 'feedback' }],
        orderBy: [{ field: { fieldPath: 'seq' }, direction: 'DESCENDING' }],
        limit: 1,
      }, bearer);
      nextTop = (docs.length ? intField(docs[0], 'seq') : 0) + 1;
    }
    return { seq: nextTop++, subSeq: 0 };
  }

  async function allocSub(parentSeq) {
    if (!nextSub.has(parentSeq)) {
      // Solo filtro di uguaglianza (niente orderBy su un secondo campo: non
      // richiede indici compositi); il max si calcola qui.
      const docs = await runQuery({
        from: [{ collectionId: 'feedback' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'seq' },
            op: 'EQUAL',
            value: { integerValue: String(parentSeq) },
          },
        },
        limit: 300,
      }, bearer);
      const maxSub = docs.reduce((m, d) => Math.max(m, intField(d, 'subSeq')), 0);
      nextSub.set(parentSeq, maxSub + 1);
    }
    const sub = nextSub.get(parentSeq);
    nextSub.set(parentSeq, sub + 1);
    return { seq: parentSeq, subSeq: sub };
  }

  // Per un'entry `create`: con parentId numera sotto il padre (#22.1), senza
  // è un top-level nuovo (#23). Se il padre esiste ma non ha ancora un numero
  // (feedback storico), gliene assegna uno al volo via PATCH così i sub hanno
  // un prefisso sensato.
  return async function allocate(entry) {
    if (!entry.parentId) return allocTop();
    const parent = await getDoc(entry.parentId, bearer);
    if (!parent) {
      console.warn(`  ! padre ${entry.parentId} inesistente: creo top-level`);
      return allocTop();
    }
    let pSeq = intField(parent, 'seq');
    if (!pSeq) {
      ({ seq: pSeq } = await allocTop());
      const r = await patchFields(entry.parentId, { seq: pSeq, subSeq: 0 }, bearer);
      if (!r.ok) console.warn(`  ! numerazione del padre fallita (HTTP ${r.status}); i sub usano comunque #${pSeq}`);
    }
    return allocSub(pSeq);
  };
}

// PATCH generica di pochi campi su un feedback esistente.
async function patchFields(id, obj, bearer) {
  const fields = {};
  const qs = Object.keys(obj).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  for (const [k, v] of Object.entries(obj)) fields[k] = toFsValue(v);
  const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?${qs}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  });
  return { status: res.status, ok: res.ok, body: res.ok ? '' : (await res.text()).slice(0, 200) };
}

// Crea il documento feedback per un'entry `create` della coda.
async function createFeedback(entry, num, bearer) {
  const fields = {
    text: toFsValue(String(entry.text || '')),
    name: toFsValue(String(entry.name || '').slice(0, 200)),
    url: toFsValue(''),
    title: toFsValue(''),
    userAgent: toFsValue('routine'),
    clientId: toFsValue(`routine:${String(entry.queuedBy || 'routine').slice(0, 80)}`),
    images: toFsValue([]),
    files: toFsValue([]),
    status: toFsValue(entry.status),
    notes: toFsValue(String(entry.notes || '')),
    seq: toFsValue(num.seq),
    subSeq: toFsValue(num.subSeq),
    createdAt: { timestampValue: new Date().toISOString() },
  };
  const prio = Number(entry.priority);
  if (Number.isInteger(prio) && prio >= 1 && prio <= 3) fields.priority = toFsValue(prio);
  const res = await fetch(`${FIRESTORE_BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 200) };
  const json = await res.json();
  return { ok: true, status: res.status, id: json.name?.split('/').pop() || '' };
}

async function patchFeedback(entry, bearer) {
  const fields = { status: toFsValue(entry.status) };
  const mask = ['status'];
  if (typeof entry.notes === 'string') { fields.notes = toFsValue(entry.notes); mask.push('notes'); }
  if (entry.status === 'done') { fields.resolvedAt = { timestampValue: new Date().toISOString() }; mask.push('resolvedAt'); }
  const qs = mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${FIRESTORE_BASE}/feedback/${encodeURIComponent(entry.id)}?${qs}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
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
      // Due tipi di entry: `op: "create"` (nuovo feedback, da queue-feedback.mjs)
      // e triage classico (id + status, da queue-triage.mjs).
      if (entry && entry.op === 'create') {
        if (!String(entry.text || '').trim()) return { file, error: 'create senza testo' };
        if (!String(entry.name || '').trim()) return { file, error: 'create senza name (titolo)' };
        if (!['todo', 'clarify'].includes(entry.status)) return { file, error: `status non valido per create: "${entry.status}"` };
        return { file, entry };
      }
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

  const bearer = await acquireBearer();

  const applied = [];
  let failures = 0;
  for (const it of items) {
    if (it.error) { console.warn(`  ✗ salto ${it.file}: ${it.error}`); failures++; continue; }
    const r = await patchFeedback(it.entry, bearer);
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
        // Identità inline: funziona anche in CI dove non c'è user.name globale.
        // `[skip ci]` evita che questo stesso push ri-triggeri la GitHub Action
        // (il path-filter su feedback-triage/ scatterebbe anche sulle rimozioni).
        git([
          '-c', 'user.email=filo-triage-bot@local', '-c', 'user.name=filo-triage-bot',
          'commit', '-m', `feedback: applica e svuota ${applied.length} triage dalla coda [skip ci]`,
        ]);
        // Push best-effort con un paio di retry: se una routine ha pushato nel
        // frattempo, rebase e ripeti (come fa il workflow di release).
        let pushed = false;
        for (let i = 0; i < 3 && !pushed; i++) {
          try { git(['push', 'origin', `HEAD:${MAIN_BRANCH}`]); pushed = true; }
          catch (e) {
            if (i === 2) { console.warn('  ! push fallito dopo i retry:', String(e.message).slice(0, 160)); break; }
            try { git(['pull', '--rebase', 'origin', MAIN_BRANCH]); }
            catch (e2) { console.warn('  ! rebase fallito, lascio il commit locale:', String(e2.message).slice(0, 160)); break; }
          }
        }
        if (pushed) console.log('  ↑ coda svuotata e pushata.');
      }
    } catch (e) {
      console.warn('  ! commit della coda svuotata fallito:', String(e.message).slice(0, 160));
    }
  }

  console.log(`\nFatto: ${applied.length} applicate, ${failures} non riuscite.`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
