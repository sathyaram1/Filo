// Semaforo (lock) cooperativo sui feedback per le routine cloud.
//
// PERCHÉ ESISTE
//   Più routine schedulate su claude.ai possono partire a poca distanza l'una
//   dall'altra. Tutte LEGGONO la stessa lista di feedback `todo` da Firestore
//   (la lettura è pubblica) e scelgono "priorità più alta, poi più recente":
//   senza un lock due routine prenderebbero in carico LO STESSO feedback e
//   farebbero lavoro doppio (o si pesterebbero i piedi su main).
//
//   Le routine NON possono scrivere su Firestore (l'account robot è bloccato —
//   vedi queue-triage.mjs), quindi il lock NON può vivere su Firestore. Vive
//   invece come file su git in `feedback-triage/claims/<id>.json`, pushato su
//   `origin/main` con un push ff-only: una routine che fa `acquire` lo rende
//   visibile alle altre in pochi secondi (non i ~1-2 min della GitHub Action).
//   La GitHub Action poi "specchia" il claim su Firestore (campi claimedBy/
//   claimExpiresAt) così la dashboard può mostrare "🔧 in lavorazione" — ma quel
//   passo serve solo alla UI: il mutuo-esclusione vero è il file su git.
//
//   A differenza della coda di triage (consumata e svuotata dall'applier), i
//   file di claim sono PERSISTENTI per tutta la durata del lavoro: si rimuovono
//   con `release` (a fine feedback) o quando scadono (TTL, default 60 min, così
//   una routine morta non blocca un feedback per sempre).
//
// USO:
//   node scripts/claim-feedback.mjs acquire <id> [--num "#22.1"]
//   node scripts/claim-feedback.mjs release <id>
//   node scripts/claim-feedback.mjs list            # claim attivi (non scaduti)
//   node scripts/claim-feedback.mjs prune           # rimuove i claim scaduti
//
//   `acquire` esce 0 se il claim è tuo (lavora pure), 10 se è di un'altra routine
//   ancora attiva (passa a un altro feedback), 1 su errore.

import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// FILO_SPOOL_DIR: override per i test (vedi queue-triage.mjs). I claim vivono in
// una sottocartella `claims/` così non si confondono con i file di triage.
const SPOOL_DIR = process.env.FILO_SPOOL_DIR
  ? resolve(process.env.FILO_SPOOL_DIR)
  : resolve(ROOT, 'feedback-triage');
const CLAIMS_DIR = resolve(SPOOL_DIR, 'claims');
const MAIN_BRANCH = process.env.FILO_MAIN_BRANCH || 'main';

// TTL del claim: oltre questo è considerato scaduto e il feedback torna libero.
// Generoso di proposito (un feedback può richiedere parecchi minuti) ma finito,
// così una routine che crasha non blocca il feedback per sempre.
const TTL_MIN = (() => {
  const n = Number(process.env.FILO_CLAIM_TTL_MIN);
  return Number.isFinite(n) && n > 0 ? n : 60;
})();

// ─── Logica pura (esportata, testata in tests/unit/claimFeedback.test.mjs) ───

// Identità della routine corrente: lo slug della routine se presente, altrimenti
// host+pid (basta a distinguere due istanze che girano insieme).
export function claimIdentity() {
  return process.env.FILO_ROUTINE_SLUG || `${hostname()}-${process.pid}`;
}

export function isValidId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
}

export function parseClaim(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return null;
    if (!o.id || !o.by || !o.expiresAt) return null;
    return o;
  } catch (_) { return null; }
}

// Un claim è "vivo" se non è ancora scaduto.
export function isClaimLive(claim, nowMs = Date.now()) {
  if (!claim || !claim.expiresAt) return false;
  const exp = Date.parse(claim.expiresAt);
  return Number.isFinite(exp) && exp > nowMs;
}

// Decide cosa fare a fronte di un claim esistente quando "me" vuole acquisire:
//   'free'  → nessun claim vivo: posso prenderlo
//   'mine'  → claim vivo ed è già mio: rinnovo la scadenza
//   'taken' → claim vivo di un'altra routine: passo oltre
export function decideAcquire(existing, me, nowMs = Date.now()) {
  if (!isClaimLive(existing, nowMs)) return 'free';
  return existing.by === me ? 'mine' : 'taken';
}

export function buildClaim(id, me, { num } = {}, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const exp = new Date(nowMs + TTL_MIN * 60 * 1000);
  return {
    id,
    by: me,
    claimedAt: now.toISOString(),
    expiresAt: exp.toISOString(),
    num: typeof num === 'string' ? num : '',
  };
}

// ─── git (mirror del pattern di queue-triage.mjs) ───────────────────────────

function tryGit(args) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}

function gitPullRebase() {
  return tryGit(['pull', '--rebase', 'origin', MAIN_BRANCH]);
}

function relPath(file) {
  return relative(ROOT, file).split(sep).join('/');
}

function claimFile(id) {
  return resolve(CLAIMS_DIR, `${id}.json`);
}

// Legge il claim dal working tree (dopo un pull rispecchia origin/main).
function readClaimDisk(id) {
  const f = claimFile(id);
  if (!existsSync(f)) return null;
  return parseClaim(readFileSync(f, 'utf8'));
}

function commitFile(file, message) {
  const rel = relPath(file);
  if (!tryGit(['add', '--', rel]).ok) return { ok: false, out: 'git add fallito' };
  if (tryGit(['diff', '--cached', '--quiet', '--', rel]).ok) return { ok: true, noop: true };
  return tryGit(['commit', '-q', '-m', message, '--', rel]);
}

// Push ff-only su origin/main. ok=true se è atterrato.
function pushMain() {
  return tryGit(['push', 'origin', `HEAD:${MAIN_BRANCH}`]);
}

// ─── comandi ────────────────────────────────────────────────────────────────

// Prova ad acquisire il claim. Ritorna { status: 'acquired'|'taken'|'error', ... }.
export function acquire(id, opts = {}) {
  if (!isValidId(id)) return { status: 'error', message: `id non valido: "${id}"` };
  const me = claimIdentity();
  mkdirSync(CLAIMS_DIR, { recursive: true });

  for (let attempt = 0; attempt < 4; attempt++) {
    gitPullRebase(); // best-effort: porta i claim delle altre routine
    const existing = readClaimDisk(id);
    const decision = decideAcquire(existing, me);
    if (decision === 'taken') {
      return { status: 'taken', by: existing.by, expiresAt: existing.expiresAt, num: existing.num || '' };
    }
    // 'free' o 'mine' → (ri)scrivo il claim con scadenza fresca e provo a landarlo.
    const claim = buildClaim(id, me, opts);
    writeFileSync(claimFile(id), JSON.stringify(claim, null, 2) + '\n', 'utf8');
    const committed = commitFile(claimFile(id), `feedback: claim ${id} (${me})`);
    if (committed.noop) return { status: 'acquired', claim, renewed: decision === 'mine' };
    if (!committed.ok) return { status: 'error', message: `commit fallito: ${committed.out.slice(0, 160)}` };

    if (pushMain().ok) return { status: 'acquired', claim, renewed: decision === 'mine' };

    // Push rifiutato: un'altra routine ha avanzato main. Riconcilio.
    const reb = gitPullRebase();
    if (!reb.ok) {
      // Conflitto sullo stesso file di claim = un'altra routine ha claimato lo
      // stesso feedback nello stesso istante. Annullo il mio commit e riparto:
      // al giro dopo leggo il claim del vincitore e mi tiro indietro.
      tryGit(['rebase', '--abort']);
      tryGit(['reset', '--hard', 'HEAD~1']);
      // (il loop riparte: pull → leggo il claim remoto → 'taken' o ritento)
    }
  }
  // Non sono riuscito a confermare il claim: meglio NON lavorarlo (evita il
  // doppio lavoro che il lock dovrebbe prevenire).
  return { status: 'taken', by: '(indeterminato)', expiresAt: '', num: '' };
}

export function release(id) {
  if (!isValidId(id)) return { status: 'error', message: `id non valido: "${id}"` };
  const f = claimFile(id);
  gitPullRebase();
  if (!existsSync(f)) return { status: 'noop' };
  rmSync(f, { force: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const rel = relPath(f);
    tryGit(['add', '--', rel]);
    if (tryGit(['diff', '--cached', '--quiet', '--', rel]).ok) return { status: 'released' };
    const c = tryGit(['commit', '-q', '-m', `feedback: release ${id}`, '--', rel]);
    if (!c.ok) return { status: 'error', message: c.out.slice(0, 160) };
    if (pushMain().ok) return { status: 'released' };
    gitPullRebase();
  }
  return { status: 'released' }; // committato in locale, l'hook/altro push lo porterà su
}

// Claim vivi (per `list` e per la riconciliazione in apply-triage).
export function liveClaims(nowMs = Date.now()) {
  if (!existsSync(CLAIMS_DIR)) return [];
  const out = [];
  for (const name of readdirSync(CLAIMS_DIR)) {
    if (!name.endsWith('.json')) continue;
    const claim = parseClaim(readFileSync(resolve(CLAIMS_DIR, name), 'utf8'));
    if (isClaimLive(claim, nowMs)) out.push(claim);
  }
  return out;
}

// File di claim scaduti (da rimuovere). Ritorna i path assoluti.
export function expiredClaimFiles(nowMs = Date.now()) {
  if (!existsSync(CLAIMS_DIR)) return [];
  const out = [];
  for (const name of readdirSync(CLAIMS_DIR)) {
    if (!name.endsWith('.json')) continue;
    const file = resolve(CLAIMS_DIR, name);
    const claim = parseClaim(readFileSync(file, 'utf8'));
    if (!isClaimLive(claim, nowMs)) out.push(file);
  }
  return out;
}

function prune() {
  const expired = expiredClaimFiles();
  if (!expired.length) { console.log('Nessun claim scaduto.'); return; }
  for (const f of expired) { rmSync(f, { force: true }); tryGit(['add', '--', relPath(f)]); }
  const c = tryGit(['commit', '-q', '-m', `feedback: rimuove ${expired.length} claim scaduti`]);
  if (c.ok) { pushMain(); console.log(`Rimossi ${expired.length} claim scaduti.`); }
  else console.warn('Commit prune fallito:', c.out.slice(0, 160));
}

const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const [cmd, id, ...rest] = process.argv.slice(2);
  const numIdx = rest.indexOf('--num');
  const num = numIdx >= 0 ? rest[numIdx + 1] : '';
  try {
    if (cmd === 'acquire') {
      const r = acquire(id, { num });
      if (r.status === 'acquired') {
        console.log(`OK: claim acquisito su ${id}${r.renewed ? ' (rinnovato)' : ''} — scade ${r.claim.expiresAt}`);
        process.exit(0);
      }
      if (r.status === 'taken') {
        console.log(`OCCUPATO: ${id} è già in lavorazione da "${r.by}"${r.expiresAt ? ` (fino a ${r.expiresAt})` : ''}. Passa a un altro feedback.`);
        process.exit(10);
      }
      console.error('Errore:', r.message); process.exit(1);
    } else if (cmd === 'release') {
      const r = release(id);
      if (r.status === 'error') { console.error('Errore:', r.message); process.exit(1); }
      console.log(r.status === 'noop' ? `Nessun claim da rilasciare su ${id}.` : `OK: claim rilasciato su ${id}.`);
    } else if (cmd === 'list') {
      const claims = liveClaims();
      if (!claims.length) { console.log('Nessun feedback in lavorazione.'); }
      else { console.log(`${claims.length} feedback in lavorazione:`); for (const c of claims) console.log(`  • ${c.num ? c.num + ' ' : ''}${c.id} — ${c.by} (scade ${c.expiresAt})`); }
    } else if (cmd === 'prune') {
      prune();
    } else {
      console.error('Uso: node scripts/claim-feedback.mjs <acquire|release|list|prune> [<id>] [--num "#22.1"]');
      process.exit(1);
    }
  } catch (e) {
    console.error('Errore:', e.message); process.exit(1);
  }
}
