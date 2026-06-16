// Applica a Firestore le decisioni di triage accodate nello spool su git, e
// svuota la coda. È la metà "consumatore" del flusso descritto in queue-triage.mjs.
//
// COSA FA
//   Legge tutti i file `feedback-triage/*.json` e per ciascuno:
//   - entry di triage (id + status): PATCH REST sul documento feedback;
//   - entry `op: "create"` (da queue-feedback.mjs): crea un NUOVO documento
//     feedback (sub-feedback di una spec spezzata, o top-level), assegnandogli
//     il numero progressivo (#23) o il numero del padre con suffisso (#22.1).
//   Dopo un'applicazione riuscita cancella il file di spool (la coda si
//   svuota) e committa+pusha la rimozione, così non si riapplica.
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

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// L'autenticazione (service account in CI, refresh token admin in locale) è
// condivisa con backfill-feedback-numbers.mjs: vive in lib/firestore-auth.mjs.
import { acquireBearer, FIRESTORE_BASE } from './lib/firestore-auth.mjs';
import { backfillNumbers } from './backfill-feedback-numbers.mjs';
// I claim (semaforo sui feedback per le routine) vivono in feedback-triage/claims/.
// Qui li "specchiamo" su Firestore così la dashboard può mostrare "in lavorazione".
import { liveClaims, expiredClaimFiles } from './claim-feedback.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// FILO_SPOOL_DIR: override per i test (vedi queue-triage.mjs).
const SPOOL_DIR = process.env.FILO_SPOOL_DIR
  ? resolve(process.env.FILO_SPOOL_DIR)
  : resolve(ROOT, 'feedback-triage');
const CLAIMS_DIR = resolve(SPOOL_DIR, 'claims');

const ALLOWED = ['todo', 'done', 'clarify'];
const DRY = process.argv.includes('--dry-run');
const MAIN_BRANCH = process.env.FILO_MAIN_BRANCH || 'main';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
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
      // Tipi di entry: `op: "create"` (nuovo feedback, da queue-feedback.mjs),
      // `op: "backfill"` (numerazione dei feedback storici), `op: "delete"`
      // (SOLO documenti di test, clientId "test:*"), e triage classico
      // (id + status, da queue-triage.mjs).
      if (entry && entry.op === 'backfill') return { file, entry };
      if (entry && entry.op === 'delete') {
        if (!entry.id) return { file, error: 'delete senza id' };
        return { file, entry };
      }
      if (entry && entry.op === 'create') {
        if (!String(entry.text || '').trim()) return { file, error: 'create senza testo' };
        if (!String(entry.name || '').trim()) return { file, error: 'create senza name (titolo)' };
        if (!['new', 'todo', 'clarify'].includes(entry.status)) return { file, error: `status non valido per create: "${entry.status}"` };
        return { file, entry };
      }
      if (!entry || !entry.id) return { file, error: 'manca il campo id' };
      if (!ALLOWED.includes(entry.status)) return { file, error: `status non valido: "${entry.status}"` };
      return { file, entry };
    });
}

// Specchia su Firestore lo stato dei claim (il semaforo vive su git; questi campi
// servono SOLO alla dashboard per mostrare "in lavorazione"). Per ogni claim vivo
// imposta claimedBy/claimedAt/claimExpiresAt; per ogni feedback che su Firestore
// risulta claimato ma non ha più un claim vivo (rilasciato o scaduto) li azzera.
// Inoltre rimuove dal disco i file di claim scaduti (verranno committati a valle).
// Best-effort: un errore qui non deve far fallire l'applicazione del triage.
async function reconcileClaims(bearer, resolvedIds = new Set()) {
  const live = liveClaims();
  const liveById = new Map(live.map((c) => [c.id, c]));

  // 1) Imposta i campi per i claim vivi.
  for (const c of live) {
    const r = await patchFields(c.id, {
      claimedBy: String(c.by || ''),
      claimedAt: String(c.claimedAt || ''),
      claimExpiresAt: String(c.expiresAt || ''),
      claimNum: String(c.num || ''),
    }, bearer);
    if (!r.ok && r.status !== 404) console.warn(`  ! sync claim ${c.id}: HTTP ${r.status}`);
  }

  // 2) Azzera i campi sui feedback che su Firestore risultano ancora claimati
  //    ma non hanno un claim vivo (rilasciati a fine lavoro o scaduti).
  //    L'orderBy su claimExpiresAt seleziona solo i doc che HANNO quel campo.
  let claimedDocs = [];
  try {
    claimedDocs = await runQuery({
      from: [{ collectionId: 'feedback' }],
      orderBy: [{ field: { fieldPath: 'claimExpiresAt' }, direction: 'DESCENDING' }],
      limit: 200,
    }, bearer);
  } catch (e) { console.warn('  ! query claim attivi fallita:', String(e.message).slice(0, 120)); }
  for (const d of claimedDocs) {
    const id = d.name?.split('/').pop() || '';
    const exp = d.fields?.claimExpiresAt?.stringValue || '';
    if (!id || !exp) continue;
    if (!liveById.has(id) || resolvedIds.has(id)) {
      const r = await patchFields(id, { claimedBy: '', claimedAt: '', claimExpiresAt: '', claimNum: '' }, bearer);
      if (r.ok) console.log(`  ✓ claim azzerato su ${id}`);
      else if (r.status !== 404) console.warn(`  ! azzeramento claim ${id}: HTTP ${r.status}`);
    }
  }

  // 3) Rimuovi dal disco i file di claim scaduti (il commit a valle li stage-a).
  for (const f of expiredClaimFiles()) {
    try { rmSync(f, { force: true }); } catch (_) {}
  }
}

async function main() {
  const items = readSpool();
  if (!items.length) console.log('Coda di triage vuota (controllo comunque i claim).');
  // Il backfill va applicato PRIMA delle creazioni: numera gli storici, così
  // i nuovi feedback della stessa run prendono numeri successivi e coerenti.
  const opRank = { backfill: 0, delete: 1, create: 2 };
  items.sort((a, b) => (opRank[a.entry?.op] ?? 3) - (opRank[b.entry?.op] ?? 3));

  console.log(`${items.length} decisione/i in coda${DRY ? ' (dry-run)' : ''}.`);

  if (DRY) {
    for (const it of items) {
      if (it.error) console.log(`  ✗ ${it.file}: ${it.error}`);
      else if (it.entry.op === 'create') console.log(`  • CREA «${it.entry.name}» → ${it.entry.status}${it.entry.parentId ? `  (sub di ${it.entry.parentId})` : ''}`);
      else if (it.entry.op === 'backfill') console.log('  • BACKFILL numerazione feedback storici');
      else if (it.entry.op === 'delete') console.log(`  • ELIMINA doc di test ${it.entry.id}`);
      else console.log(`  • ${it.entry.id} → ${it.entry.status}${it.entry.notes ? `  («${it.entry.notes.slice(0, 60)}»)` : ''}`);
    }
    const claims = liveClaims();
    if (claims.length) console.log(`  • ${claims.length} claim attivo/i da specchiare su Firestore`);
    console.log('\nDry-run: nessuna scrittura su Firestore, nessuna modifica a git.');
    return;
  }

  const bearer = await acquireBearer();
  const allocateNumber = makeNumberAllocator(bearer);

  const applied = [];
  // Feedback risolti in questa run (done/clarify/todo applicati): il loro claim,
  // se presente, va rilasciato — la riconciliazione azzera i campi su Firestore.
  const resolvedIds = new Set();
  let failures = 0;
  for (const it of items) {
    if (it.error) { console.warn(`  ✗ salto ${it.file}: ${it.error}`); failures++; continue; }
    if (it.entry.op === 'backfill') {
      try {
        const r = await backfillNumbers(bearer);
        if (r.failures) { console.error(`  ✗ backfill: ${r.failures} patch fallite (file lasciato in coda)`); failures++; }
        else {
          console.log(`  ✓ backfill: ${r.numbered} feedback numerati (${r.total} totali)`);
          unlinkSync(it.file); applied.push(it.file);
        }
      } catch (e) { console.error(`  ✗ backfill: ${e.message}`); failures++; }
      continue;
    }
    if (it.entry.op === 'delete') {
      try {
        const doc = await getDoc(it.entry.id, bearer);
        if (!doc) {
          console.warn(`  ! delete ${it.entry.id}: già inesistente — rimuovo dalla coda`);
          unlinkSync(it.file); applied.push(it.file);
        } else if (!String(doc.fields?.clientId?.stringValue || '').startsWith('test:')) {
          // Guardrail: la coda può eliminare SOLO documenti di test. Per i
          // feedback veri la cancellazione resta un'azione manuale dell'admin.
          console.error(`  ✗ delete ${it.entry.id}: non è un doc di test (clientId "${doc.fields?.clientId?.stringValue || ''}") — rifiutato`);
          failures++;
        } else {
          const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(it.entry.id)}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${bearer}` },
          });
          if (res.ok) {
            console.log(`  ✓ eliminato doc di test ${it.entry.id}`);
            unlinkSync(it.file); applied.push(it.file);
          } else { console.error(`  ✗ delete ${it.entry.id}: HTTP ${res.status}`); failures++; }
        }
      } catch (e) { console.error(`  ✗ delete ${it.entry.id}: ${e.message}`); failures++; }
      continue;
    }
    if (it.entry.op === 'create') {
      try {
        const num = await allocateNumber(it.entry);
        const r = await createFeedback(it.entry, num, bearer);
        if (r.ok) {
          console.log(`  ✓ creato #${num.subSeq ? `${num.seq}.${num.subSeq}` : num.seq} «${it.entry.name}» → ${it.entry.status} (${r.id})`);
          unlinkSync(it.file); applied.push(it.file);
        } else {
          console.error(`  ✗ creazione «${it.entry.name}»: HTTP ${r.status} ${r.body}`);
          failures++;
        }
      } catch (e) {
        console.error(`  ✗ creazione «${it.entry.name}»: ${e.message}`);
        failures++;
      }
      continue;
    }
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
