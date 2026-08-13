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
// feedbackThread è un IIFE su globalThis: importarlo lo registra come
// globalThis.SN_FEEDBACK_THREAD. Lo usiamo per FONDERE il report della routine
// con le note esistenti invece di sovrascriverle (vedi mergeModelReport).
import '../src/shared/feedbackThread.js';
const THREAD = globalThis.SN_FEEDBACK_THREAD;
// S1.F2.1: statusToPublic (mapping status fine→grossolano) + crypto per cifrare status.
// feedback.js e feedbackCrypto.js sono IIFE su globalThis: importarli li registra.
import '../src/shared/feedbackCrypto.js';
import '../src/shared/feedback.js';
// Macchina a stati (spec FEEDBACK-STATES.md): vocabolario + transizioni legali.
import '../src/shared/feedbackStatus.js';
const _statusToPublic = () => globalThis.SN_FEEDBACK?.statusToPublic;
const _crypto = () => globalThis.SN_FEEDBACK_CRYPTO;
const _fbStatus = () => globalThis.SN_FB_STATUS;
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

// Status canonici accettati dalla coda (stesso elenco di queue-triage.mjs).
const ALLOWED = ['todo', 'working', 'revision_capability', 'revision_security',
  'done', 'design', 'archived'];
// Nomi RITIRATI ancora accettati in ingresso (file accodati da recipe vecchie):
// rimappati al canonico. Rimuovere a migrazione completata.
const LEGACY_INPUT = {
  clarify: { status: 'design', reason: 'clarify' },
  review:  { status: 'revision_capability' },
  blocked: { status: 'design', reason: 'loop' },
};

// ─── Recupero delle lavorazioni interrotte (logica pura, unit-testata) ───────
// Un'istanza può morire a metà implementazione senza lasciare traccia (es.
// crediti/budget esauriti): il feedback resta `working` e nessuno lo riprende.
// Queste due funzioni decidono (a) quando il claim git sopravvive a un'entry
// applicata e (b) cosa fare di un `working` scaduto.

// Il claim sopravvive SOLO all'entry `working`: quella entry È la presa in
// carico — l'istanza sta ancora lavorando, il claim è il suo lock e la spia
// "in lavorazione" della dashboard. Rilasciarlo lì (com'era prima) spegneva il
// semaforo pochi secondi dopo l'acquisizione. Ogni altro status è una consegna:
// il lavoro su quel feedback è finito e il claim va rilasciato.
export function claimOutlivesEntry(status) {
  return status === 'working';
}

// Quante interruzioni consecutive (working scaduto → todo) tollerare prima di
// arrendersi e chiedere all'owner. Stessa soglia del loop verifier→fixer.
export const EXPIRY_RESET_LIMIT = 3;

// Esito di un `working` scaduto (TTL): le prime volte torna in coda con il
// contatore `workingResets` incrementato; alla EXPIRY_RESET_LIMIT-esima
// interruzione consecutiva si passa a `design` (statusReason `loop`) con una
// nota che spiega all'owner cosa è successo — altrimenti il ping-pong
// claim→morte→todo→claim brucerebbe crediti all'infinito senza che nessuno
// se ne accorga. Il contatore si azzera a ogni consegna reale (vedi
// patchFeedback) e all'escalation stessa.
export function expiryOutcome(prevResets) {
  const resets = (Number.isInteger(prevResets) && prevResets > 0 ? prevResets : 0) + 1;
  if (resets >= EXPIRY_RESET_LIMIT) {
    return {
      status: 'design',
      reason: 'loop',
      workingResets: 0,
      notes: `L'implementazione di questo feedback si è interrotta ${resets} volte di seguito senza consegnare nulla: l'istanza che l'aveva preso in carico è sparita ogni volta (causa tipica: crediti o budget esauriti). Sospendo i tentativi automatici per non sprecare altri crediti. Quando il problema è risolto, rimetti il feedback in coda e la lavorazione ripartirà.`,
    };
  }
  return { status: 'todo', workingResets: resets };
}

// DB3: la versione in cui un fix confluisce = quella corrente di package.json
// (è la release in costruzione, la "prossima" che uscirà). Stampata su
// `resolvedInVersion` al passaggio a `done`, serve alla dashboard `manage` per
// distinguere i fix "in produzione" (resolvedInVersion ≤ versione rilasciata)
// dai done-ma-non-ancora-spediti. Vedi src/shared/manageReview.js → isShipped.
function packageVersion() {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version || '';
  } catch (_) { return ''; }
}
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
    // images = URL pubblici già caricati su Storage da queue-feedback.mjs
    // (--image). Solo stringhe http(s), max 5: la dashboard li mostra come prova
    // visiva del feedback d'audit.
    images: toFsValue(
      (Array.isArray(entry.images) ? entry.images : [])
        .map((u) => String(u || '').trim())
        .filter((u) => /^https?:\/\//i.test(u))
        .slice(0, 5),
    ),
    files: toFsValue([]),
    status: toFsValue(entry.status),
    // S1.F2.1: statusPublic SEMPRE in chiaro (i feedback creati dalla coda non
    // vanno mai cifrati lato create — è la Action del service account che li crea).
    statusPublic: toFsValue((() => { const fn = _statusToPublic(); return fn ? fn(entry.status) : 'open'; })()),
    notes: toFsValue(String(entry.notes || '')),
    seq: toFsValue(num.seq),
    subSeq: toFsValue(num.subSeq),
    createdAt: { timestampValue: new Date().toISOString() },
  };
  // S1.priority: priority può essere un intero legacy (in chiaro) OPPURE una
  // stringa FENC1: (cifrata). toFsValue mappa string→stringValue e int→integerValue:
  // passare direttamente il valore (qualunque tipo) produce il tipo Firestore giusto.
  // Caso intero legacy: scriviamo solo se 1-3 (0 = nessuna priority, non scrivere).
  // Caso ciphertext: scriviamo sempre (il valore cifrato non possiamo decifrarlo qui).
  if (typeof entry.priority === 'string' && entry.priority.startsWith('FENC1:')) {
    // priority cifrata: scrivi come stringValue.
    fields.priority = toFsValue(entry.priority);
  } else {
    const prio = Number(entry.priority);
    if (Number.isInteger(prio) && prio >= 1 && prio <= 3) fields.priority = toFsValue(prio);
  }
  // Idempotenza: se l'entry porta una `uid` (le crea queue-feedback.mjs), la uso
  // come ID del documento via ?documentId=. Così se questa stessa entry viene
  // applicata due volte — tipicamente due run concorrenti della GitHub Action
  // che leggono lo spool prima che la prima lo svuoti — la seconda POST riceve
  // 409 ALREADY_EXISTS invece di creare un duplicato. La de-dup è imposta da
  // Firestore sull'id (atomica), non da un check-then-create soggetto a TOCTOU.
  const uid = typeof entry.uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(entry.uid) ? entry.uid : '';
  const url = uid
    ? `${FIRESTORE_BASE}/feedback?documentId=${encodeURIComponent(uid)}`
    : `${FIRESTORE_BASE}/feedback`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  });
  if (res.status === 409) {
    // Già creato da un'applicazione precedente/parallela della stessa entry:
    // non è un errore, l'entry è "applicata". Svuoto la coda senza duplicare.
    return { ok: true, status: 409, id: uid, deduped: true };
  }
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 200) };
  const json = await res.json();
  return { ok: true, status: res.status, id: json.name?.split('/').pop() || '' };
}

// Attore di una entry di coda, per la tabella delle transizioni (spec §3).
// La coda è il canale delle ROUTINE; le uniche eccezioni delegate dall'owner
// sono l'auto-archivio a punteggio (DC3) e le entry accodate esplicitamente
// come owner (sessioni locali che agiscono per suo conto).
function actorOf(entry) {
  const by = String(entry.queuedBy || '');
  if (/^owner\b/i.test(by) || by === 'routine:auto-archive') return 'owner';
  return 'routine';
}

// Valida la transizione status→status contro la macchina a stati. `doc` è il
// documento Firestore corrente (già scaricato). Regole di prudenza:
//   - doc assente/illeggibile o status cifrato non decifrabile → ok (non
//     possiamo validare; meglio applicare che perdere la decisione);
//   - from LEGACY (new/blocked/…) → ok (lo scioglimento esatto richiede i campi
//     grezzi; sparirà con la migrazione F5);
//   - from === to → ok (retry/aggiornamento note idempotente);
//   - altrimenti decide canTransition(from, to, actor).
async function checkTransition(entry, doc) {
  const FS = _fbStatus();
  if (!FS || !doc) return { ok: true };
  let from = doc.fields?.status?.stringValue || '';
  const C = _crypto();
  if (C && C.isEncrypted && C.isEncrypted(from)) {
    try {
      const { decryptFeedbackFields: dec } = await import('./lib/decrypt-feedback-fields.mjs');
      from = (await dec({ _id: entry.id, status: from })).status || '';
    } catch (_) { return { ok: true }; }
  }
  if (!FS.isCanonical(from)) return { ok: true, from };
  if (from === entry.status) return { ok: true, from };
  const actor = actorOf(entry);
  // canReach (non canTransition): la coda tiene UN file per feedback, quindi
  // passi consecutivi possono collassare (todo→working→revision_capability
  // arriva come todo→revision_capability). Vale la catena, non il passo.
  return { ok: FS.canReach(from, entry.status, actor), from, actor };
}

async function patchFeedback(entry, bearer) {
  // Un solo GET per entry: serve alla fusione delle note E alla validazione.
  const doc = await getDoc(entry.id, bearer).catch(() => null);

  // Macchina a stati: le transizioni non elencate vengono RIFIUTATE qui, alla
  // scrittura (spec §3 "il writer le rifiuta").
  const check = await checkTransition(entry, doc);
  if (!check.ok) {
    return { status: 0, ok: false, rejected: true, body: `transizione illegale ${check.from} → ${entry.status} (attore ${check.actor})` };
  }

  // S1.F2.1: cifra status fine se il gate è on; scrivi sempre statusPublic in chiaro.
  let fineStatus = entry.status;
  const C = _crypto();
  if (C && C.isEnabled && C.isEnabled()) {
    try { fineStatus = await C.encryptForOwner(String(entry.status)); } catch (_) { /* niente crash */ }
  }
  const statusToPublic = _statusToPublic();
  const publicStatus = statusToPublic ? statusToPublic(entry.status) : 'open';

  const fields = { status: toFsValue(fineStatus), statusPublic: toFsValue(publicStatus) };
  const mask = ['status', 'statusPublic'];
  // Lock di lavorazione (spec §6): entrare in `working` stampa il timestamp;
  // uscirne (qualsiasi altro status) lo azzera, così un `workingSince` presente
  // implica SEMPRE "sta lavorando" e la riconciliazione può fidarsi.
  fields.workingSince = toFsValue(entry.status === 'working' ? new Date().toISOString() : '');
  mask.push('workingSince');
  // Note: FONDI con lo storico invece di sovrascrivere (report precedenti e
  // annotazioni dell'utente vanno preservati). Una nota VUOTA non tocca le
  // note esistenti (le entry di solo cambio-status, es. `working`, non devono
  // cancellare la conversazione).
  if (typeof entry.notes === 'string' && String(entry.notes).trim()) {
    const existing = doc?.fields?.notes?.stringValue || '';
    const merged = THREAD ? THREAD.mergeModelReport(existing, entry.notes) : entry.notes;
    // Tetto alla conversazione: questo cammino gira anche con un service
    // account, che BYPASSA le Firestore rules — senza taglio potrebbe gonfiare
    // le note oltre il limite e rendere il feedback immobile per la dashboard
    // (che passa dalle regole). Vedi SN_FEEDBACK_THREAD.capNotes.
    const notes = THREAD && THREAD.capNotes ? THREAD.capNotes(merged) : merged;
    fields.notes = toFsValue(notes); mask.push('notes');
  }
  // `branch`: il nome del branch git su cui vive il fix (da revision_* in poi).
  // Scritto solo se la coda lo porta; '' lo azzera.
  if (typeof entry.branch === 'string') { fields.branch = toFsValue(entry.branch.slice(0, 200)); mask.push('branch'); }
  // `statusReason`: sottotesto dello status per la dashboard (es. 'loop' = 3
  // FAIL del verifier→fixer, 'clarify' = domande della routine). MAI usato per
  // la logica. `blockReason` è il nome vecchio: specchiato per lo storico non
  // ancora migrato, da togliere dopo F5.
  if (typeof entry.reason === 'string') {
    fields.statusReason = toFsValue(entry.reason.slice(0, 60)); mask.push('statusReason');
    fields.blockReason = toFsValue(entry.reason.slice(0, 60)); mask.push('blockReason');
  }
  // `starred` (DB2): flag ⭐ "preferito". Booleano; scritto solo se la coda lo
  // porta, così non si azzera per chi non lo tocca.
  if (typeof entry.starred === 'boolean') { fields.starred = toFsValue(entry.starred); mask.push('starred'); }
  // `workingResets` (recupero lavorazioni interrotte): una CONSEGNA reale
  // (l'istanza ha prodotto qualcosa: fix su branch, chiusura, domande) azzera
  // il contatore delle interruzioni. `working` e `todo` NON azzerano: sono i
  // due status del ciclo presa-in-carico/ripristino che il contatore misura
  // (il todo della riconciliazione arriva da qui, e azzerarlo qui vanificherebbe
  // l'incremento fatto subito dopo da reconcileClaims).
  if (!['working', 'todo'].includes(entry.status)) {
    fields.workingResets = toFsValue(0); mask.push('workingResets');
  }
  if (entry.status === 'done') {
    fields.resolvedAt = { timestampValue: new Date().toISOString() }; mask.push('resolvedAt');
    // DB3: registra la versione in cui il fix è confluito (= package.json
    // corrente), così la dashboard può sapere quando è davvero "in produzione".
    const ver = packageVersion();
    if (ver) { fields.resolvedInVersion = toFsValue(ver); mask.push('resolvedInVersion'); }
  }
  const qs = mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${FIRESTORE_BASE}/feedback/${encodeURIComponent(entry.id)}?${qs}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  });
  return { status: res.status, ok: res.ok, body: res.ok ? '' : (await res.text()).slice(0, 200) };
}

// ─── Registro dei worker (config/automation.workerLog) ───────────────────────

// Quante voci tenere: allineato a SN_CONST.AUTOMATION.WORKER_LOG_CAP e al cap
// di scripts/dispatch.mjs. Il registro vive come campo di un documento, quindi
// va cappato o il documento cresce senza fine.
const WORKER_LOG_CAP = (() => {
  const n = globalThis.SN_CONST?.AUTOMATION?.WORKER_LOG_CAP;
  return Number.isFinite(n) && n > 0 ? n : 200;
})();

/**
 * Fonde le voci accodate col registro già su Firestore, in ordine cronologico,
 * tenendo solo le `cap` più recenti. Pura (testata in
 * tests/unit/workerLogQueue.test.mjs).
 *
 * Le voci DUPLICATE (stesso ruolo e stesso istante) vengono scartate: la coda
 * ritenta le spedizioni non riuscite, quindi la stessa voce può arrivare due
 * volte, e un registro che conta due volte lo stesso worker mente su cosa hanno
 * fatto le routine.
 */
export function mergeWorkerLog(current, entries, cap = WORKER_LOG_CAP) {
  const norm = (e) => ({
    role: String(e?.role || ''),
    startedAt: String(e?.startedAt || ''),
    num: e?.num != null ? String(e.num) : '',
  });
  const list = (Array.isArray(current) ? current : []).filter((e) => e && e.role).map(norm);
  const seen = new Set(list.map((e) => `${e.role}|${e.startedAt}`));
  for (const raw of (Array.isArray(entries) ? entries : [])) {
    const e = norm(raw);
    if (!e.role) continue;
    const key = `${e.role}|${e.startedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(e);
  }
  list.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const n = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : WORKER_LOG_CAP;
  return list.length > n ? list.slice(list.length - n) : list;
}

/**
 * Applica in UN SOLO colpo tutte le voci del registro accodate: legge il campo
 * attuale, fonde, riscrive. Un solo giro di lettura/scrittura anche se le voci
 * arretrate sono venti (succede se la spedizione era rotta da giorni).
 */
async function applyWorkerLog(items, bearer) {
  const url = `${FIRESTORE_BASE}/config/automation`;
  const auth = { Authorization: `Bearer ${bearer}` };
  let current = [];
  const res = await fetch(url, { headers: auth });
  if (res.ok) {
    const json = await res.json();
    const arr = json?.fields?.workerLog?.arrayValue?.values;
    if (Array.isArray(arr)) {
      current = arr.map((v) => {
        const f = v?.mapValue?.fields || {};
        return {
          role: f.role?.stringValue || '',
          startedAt: f.startedAt?.stringValue || '',
          num: f.num?.stringValue || '',
        };
      });
    }
  } else if (res.status !== 404) {
    throw new Error(`lettura del registro fallita: HTTP ${res.status}`);
  }

  const next = mergeWorkerLog(current, items.map((it) => it.entry));
  const values = next.map((e) => ({ mapValue: { fields: {
    role: { stringValue: e.role },
    startedAt: { stringValue: e.startedAt },
    num: { stringValue: e.num },
  } } }));
  // updateMask sul solo `workerLog`: non tocca enabled/loopCap/autoApprove.
  const patch = await fetch(`${url}?updateMask.fieldPaths=workerLog`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ fields: { workerLog: { arrayValue: { values } } } }),
  });
  if (!patch.ok) throw new Error(`HTTP ${patch.status} ${(await patch.text()).slice(0, 200)}`);
  return next.length;
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
      // `worker-log`: una riga del registro dei worker (da scripts/dispatch.mjs).
      // Passa da qui perché le macchine delle routine non hanno nessuna
      // credenziale per scrivere su Firestore, e il registro nato dal percorso
      // diretto è rimasto vuoto per sempre senza che nessuno protestasse (#451).
      if (entry && entry.op === 'worker-log') {
        if (!String(entry.role || '').trim()) return { file, error: 'worker-log senza ruolo' };
        return { file, entry };
      }
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
      // Rimappa i nomi ritirati (file accodati prima del cambio di vocabolario).
      const legacy = LEGACY_INPUT[entry.status];
      if (legacy) {
        if (legacy.reason && !String(entry.reason || '').trim()) entry.reason = legacy.reason;
        entry.status = legacy.status;
      }
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

  // 4) `working` scaduti → todo (spec §6: TTL 60min = istanza morta). Ci si
  //    fida di `workingSince`: viene stampato entrando in working e azzerato
  //    uscendone (patchFeedback), quindi un valore presente = sta lavorando.
  //    L'orderBy seleziona solo i doc che HANNO il campo (come per i claim).
  const FS = _fbStatus();
  let workingDocs = [];
  try {
    workingDocs = await runQuery({
      from: [{ collectionId: 'feedback' }],
      orderBy: [{ field: { fieldPath: 'workingSince' }, direction: 'DESCENDING' }],
      limit: 200,
    }, bearer);
  } catch (e) { console.warn('  ! query working attivi fallita:', String(e.message).slice(0, 120)); }
  for (const d of workingDocs) {
    const id = d.name?.split('/').pop() || '';
    const ws = d.fields?.workingSince?.stringValue || '';
    if (!id || !ws) continue;
    if (!FS || !FS.isWorkingExpired({ status: 'working', workingSince: ws })) continue;
    // Contatore delle interruzioni consecutive: le prime volte il feedback
    // torna in coda; alla soglia si arrende → design/loop + nota all'owner
    // (vedi expiryOutcome). Senza soglia, un'istanza che muore sempre (es.
    // crediti finiti) farebbe ping-pong todo↔working all'infinito.
    const out = expiryOutcome(intField(d, 'workingResets'));
    const entry = { id, status: out.status, queuedBy: 'routine:reconcile' };
    if (out.reason) entry.reason = out.reason;
    if (out.notes) entry.notes = out.notes;
    const r = await patchFeedback(entry, bearer);
    if (r.ok) {
      const c = await patchFields(id, { workingResets: out.workingResets }, bearer);
      if (!c.ok && c.status !== 404) console.warn(`  ! contatore interruzioni ${id}: HTTP ${c.status}`);
      console.log(`  ✓ working scaduto su ${id} → ${out.status}${out.status === 'todo' ? ` (interruzione n.${out.workingResets})` : ' (soglia interruzioni raggiunta)'}`);
    } else if (r.status !== 404) console.warn(`  ! reset working ${id}: ${r.body || `HTTP ${r.status}`}`);
  }
}

async function main() {
  const items = readSpool();
  if (!items.length) console.log('Coda di triage vuota (controllo comunque i claim).');
  // Il backfill va applicato PRIMA delle creazioni: numera gli storici, così
  // i nuovi feedback della stessa run prendono numeri successivi e coerenti.
  // A parità di op, l'ordine è quello di ACCODAMENTO (queuedAt, poi nome file
  // come tie-break: contiene il timestamp ms): per i sub-feedback di una spec
  // l'ordine di accodamento È l'ordine delle dipendenze, e qui diventa l'ordine
  // dei numeri (#N.1, #N.2, …) e dei createdAt — quello che next-feedback.mjs
  // usa per servire la famiglia in sequenza. Non affidarsi all'ordine di
  // readdirSync (non garantito).
  const opRank = { backfill: 0, delete: 1, create: 2 };
  items.sort((a, b) =>
    ((opRank[a.entry?.op] ?? 3) - (opRank[b.entry?.op] ?? 3))
    || String(a.entry?.queuedAt || '').localeCompare(String(b.entry?.queuedAt || ''))
    || String(a.file || '').localeCompare(String(b.file || '')));

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
          if (r.deduped) console.log(`  ↺ «${it.entry.name}» già creato (uid ${r.id}) — entry duplicata, svuoto senza ricreare`);
          else console.log(`  ✓ creato #${num.subSeq ? `${num.seq}.${num.subSeq}` : num.seq} «${it.entry.name}» → ${it.entry.status} (${r.id})`);
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
      // Triage applicato → libera il claim di questo feedback (se esiste).
      // ECCETTO l'entry `working`: è la presa in carico, l'istanza sta ancora
      // lavorando e il claim (con il suo TTL) resta il lock e la spia live.
      if (!claimOutlivesEntry(it.entry.status)) {
        resolvedIds.add(it.entry.id);
        const cf = resolve(CLAIMS_DIR, `${it.entry.id}.json`);
        if (existsSync(cf)) { try { rmSync(cf, { force: true }); } catch (_) {} }
      }
    } else if (r.status === 404) {
      console.warn(`  ! ${it.entry.id}: feedback inesistente (404) — rimuovo dalla coda`);
      unlinkSync(it.file); applied.push(it.file);
    } else if (r.rejected) {
      // Transizione illegale (macchina a stati): la decisione viene SCARTATA
      // (file rimosso, feedback intatto) e resta visibile in questo log.
      console.error(`  ✗ ${it.entry.id}: ${r.body} — decisione scartata`);
      unlinkSync(it.file);
      failures++;
    } else {
      console.error(`  ✗ ${it.entry.id}: HTTP ${r.status} ${r.body}`);
      failures++;
    }
  }

  // Specchia su Firestore lo stato dei claim (per la dashboard) e pulisci i
  // file di claim scaduti/risolti. Non fatale: i feedback applicati sopra non
  // devono regredire se questo passo fallisce.
  try { await reconcileClaims(bearer, resolvedIds); }
  catch (e) { console.warn('  ! riconciliazione claim fallita:', String(e.message).slice(0, 160)); }

  // Committa le rimozioni (triage applicati + claim scaduti/risolti). Gira anche
  // quando la coda di triage era vuota ma un push di claim ha rimosso dei file.
  {
    try {
      git(['add', '-A', '--', 'feedback-triage']);
      const staged = git(['diff', '--cached', '--name-only']);
      if (staged) {
        // Identità inline: funziona anche in CI dove non c'è user.name globale.
        // `[skip ci]` evita che questo stesso push ri-triggeri la GitHub Action
        // (il path-filter su feedback-triage/ scatterebbe anche sulle rimozioni).
        git([
          '-c', 'user.email=filo-triage-bot@local', '-c', 'user.name=filo-triage-bot',
          'commit', '-m', `feedback: applica ${applied.length} triage + riconcilia claim [skip ci]`,
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

// Guardia da modulo principale (stesso pattern di claim-feedback.mjs): gli
// unit test importano le funzioni pure esportate senza far partire la run.
const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMainModule) main().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
