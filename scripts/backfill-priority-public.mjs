// Backfill del mirror in chiaro `priorityPublic` sui feedback esistenti.
//
// PERCHÉ ESISTE
//   Dal cutover cifratura (S1.priority, 2026-06-25) il campo `priority` dei
//   feedback su Firestore è un ciphertext FENC1. La macchina UTENTE non ha la
//   chiave privata, quindi il popup ricompense (C5) non può leggere la fascia
//   di priorità e il premio alla risoluzione cade SEMPRE al minimo (50 crediti).
//   Il fix scrive un mirror in chiaro `priorityPublic` accanto alla priority
//   cifrata in tutti i percorsi di scrittura NUOVI (updateStatus, queue-feedback,
//   apply-triage) — ma i documenti scritti PRIMA del fix restano senza mirror.
//
//   Questo script colma il gap: legge tutti i feedback, decifra la priority
//   (serve FILO_FEEDBACK_PRIVKEY, come per dispatch.mjs) e per ogni doc con
//   priority cifrata 1-3 senza mirror accoda un'entry `op: "priority-public"`
//   nello spool git. La GitHub Action (apply-triage.mjs) la applica col service
//   account. La fascia di premio NON è un segreto (l'utente la vede comunque
//   nel popup ricompense), quindi il mirror in chiaro non indebolisce la
//   cifratura del contenuto.
//
// USO:
//   FILO_FEEDBACK_PRIVKEY=<base64> node scripts/backfill-priority-public.mjs [--dry-run] [--no-git]
//
//   --dry-run  mostra cosa accoderebbe, senza scrivere file né toccare git
//   --no-git   scrive i file di spool ma non committa (lascia il commit all'hook)

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { decryptFeedbackFields } from './lib/decrypt-feedback-fields.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const SPOOL_DIR = process.env.FILO_SPOOL_DIR
  ? resolve(process.env.FILO_SPOOL_DIR)
  : resolve(ROOT, 'feedback-triage');

const DRY = process.argv.includes('--dry-run');
const NO_GIT = process.argv.includes('--no-git');

// SN_FEEDBACK (IIFE su globalThis): list() legge la collezione via REST pubblica.
require(resolve(ROOT, 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

function tryGit(args) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}

async function main() {
  const all = await FB.list({ pageSize: 300 });
  console.log(`${all.length} feedback letti da Firestore.`);

  const queued = [];
  let skippedHasMirror = 0;
  let skippedPlain = 0;
  let skippedUnreadable = 0;
  for (const f of all) {
    const id = f._id;
    if (!id) continue;
    // Mirror già presente (numero): niente da fare.
    if (f.priorityPublic !== undefined && f.priorityPublic !== null
        && Number.isFinite(Number(f.priorityPublic))) { skippedHasMirror++; continue; }
    // Priority in chiaro (storico pre-cutover) o assente: il lettore C5 la
    // legge già direttamente, il mirror non serve.
    if (typeof f.priority !== 'string' || !f.priority.startsWith('FENC1:')) { skippedPlain++; continue; }
    // Priority cifrata senza mirror: decifra (serve FILO_FEEDBACK_PRIVKEY).
    let prio;
    try {
      const plain = await decryptFeedbackFields({ _id: id, priority: f.priority });
      prio = Number(plain.priority);
    } catch (e) {
      console.warn(`  ! ${id}: decifratura fallita (${e?.message || e})`);
      skippedUnreadable++; continue;
    }
    if (!Number.isInteger(prio) || prio < 1 || prio > 3) {
      // 0/illeggibile: il premio minimo è comunque corretto, nessun mirror.
      skippedUnreadable += Number.isInteger(prio) ? 0 : 1;
      if (Number.isInteger(prio)) skippedPlain++;
      continue;
    }
    queued.push({ id, priorityPublic: prio, num: FB.formatNum ? FB.formatNum(f.seq, f.subSeq) : '' });
  }

  console.log(`Da specchiare: ${queued.length}  (mirror già presente: ${skippedHasMirror}, `
    + `in chiaro/senza priorità: ${skippedPlain}, illeggibili: ${skippedUnreadable})`);

  if (DRY) {
    for (const q of queued) console.log(`  • ${q.num ? `#${q.num} ` : ''}${q.id} → priorityPublic=${q.priorityPublic}`);
    console.log('\nDry-run: nessun file scritto.');
    return;
  }
  if (!queued.length) { console.log('Niente da accodare.'); return; }

  mkdirSync(SPOOL_DIR, { recursive: true });
  const files = [];
  for (const q of queued) {
    const entry = {
      op: 'priority-public',
      id: q.id,
      priorityPublic: q.priorityPublic,
      queuedAt: new Date().toISOString(),
      queuedBy: process.env.FILO_ROUTINE_SLUG || 'routine:backfill-priority-public',
    };
    // Prefisso "priopub-" per non collidere con i file di triage (<id>.json):
    // la coda tiene UN file di triage per feedback, questo è un canale separato.
    const file = resolve(SPOOL_DIR, `priopub-${q.id}.json`);
    writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    files.push(file);
    console.log(`  ✓ accodato ${q.num ? `#${q.num} ` : ''}${q.id} → priorityPublic=${q.priorityPublic}`);
  }

  if (NO_GIT) { console.log('(--no-git: file scritti ma non committati)'); return; }

  // Commit + push best-effort (stesso pattern di queue-triage.commitAndPush,
  // ma in un commit unico per tutto il backfill).
  const rels = files.map((f) => relative(ROOT, f).split(sep).join('/'));
  if (!tryGit(['add', '--', ...rels]).ok) { console.warn('  ! git add fallito'); return; }
  if (tryGit(['diff', '--cached', '--quiet', '--', ...rels]).ok) {
    console.log('  (entry identiche già in coda: niente da committare)');
    return;
  }
  const commit = tryGit(['commit', '-q', '-m', `feedback: accoda backfill priorityPublic (${files.length} doc)`, '--', ...rels]);
  if (!commit.ok) { console.warn('  ! git commit fallito:', commit.out.slice(0, 160)); return; }
  const mainBranch = process.env.FILO_MAIN_BRANCH || 'main';
  const cur = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  tryGit(['push', 'origin', cur]);
  const land = tryGit(['push', 'origin', `HEAD:${mainBranch}`]);
  if (land.ok) console.log(`  ↑ backfill su origin/${mainBranch}.`);
  else console.warn(`  ! push su origin/${mainBranch} rifiutato: fai 'git pull --rebase origin ${mainBranch}' e ripusha.`);
}

main().catch((e) => { console.error('Errore:', e.message); process.exit(1); });
