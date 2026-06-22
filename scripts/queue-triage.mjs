// Accoda una decisione di triage di un feedback nello "spool" su git.
//
// PERCHÉ ESISTE
//   Le routine cloud NON possono più scrivere su Firestore: l'account Google
//   robot usato per autenticarsi è stato bloccato. Invece di scrivere lo stato
//   direttamente, la routine deposita la decisione in una coda su git — un file
//   per feedback in `feedback-triage/<id>.json` — e questo script lo committa e
//   pusha su origin/main. In locale l'owner esegue `npm run feedback:apply`, che
//   applica le decisioni a Firestore con le sue credenziali ADMIN (non bloccate)
//   e svuota la coda.
//
//   Lo spool è una CODA di comandi, non un registro permanente: ogni file viene
//   cancellato appena applicato. Così non resta nessun elenco di ID che possa
//   diventare stantio quando un feedback viene riaperto (era il punto debole
//   dell'idea "file con la lista dei risolti").
//
// USO:
//   node scripts/queue-triage.mjs <id> <status:todo|done|clarify|review|blocked> "testo note"
//   node scripts/queue-triage.mjs <id> <status> "note" --branch worker/42  (stato review/blocked + branch)
//   node scripts/queue-triage.mjs <id> <status> "note" --no-git   (solo scrive il file)
//
//   Di default committa e pusha il file (così la decisione arriva su main anche
//   se nessun Edit/Write fa partire l'hook di auto-commit). Con `--no-git` scrive
//   soltanto il file e lascia il commit a te / all'hook.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// FILO_SPOOL_DIR: override per i test (scrivono in una dir temporanea senza
// toccare la coda vera, che l'hook di auto-commit pusherebbe su origin/main).
const SPOOL_DIR = process.env.FILO_SPOOL_DIR
  ? resolve(process.env.FILO_SPOOL_DIR)
  : resolve(ROOT, 'feedback-triage');
const ALLOWED = ['todo', 'done', 'clarify'];

// Scrive il file di spool (nessun effetto git). Ritorna il path assoluto.
export function queueTriage(id, status, notes, queuedBy) {
  if (!id) throw new Error('id mancante');
  if (!ALLOWED.includes(status)) {
    throw new Error(`status non valido: "${status}" (ammessi: ${ALLOWED.join(', ')})`);
  }
  // L'id diventa un nome file: rifiuta tutto ciò che non sia un id Firestore.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`id con caratteri non ammessi in un filename: "${id}"`);
  }
  mkdirSync(SPOOL_DIR, { recursive: true });
  const entry = {
    id,
    status,
    notes: typeof notes === 'string' ? notes : '',
    queuedAt: new Date().toISOString(),
    queuedBy: queuedBy || process.env.FILO_ROUTINE_SLUG || 'routine',
  };
  const file = resolve(SPOOL_DIR, `${id}.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return file;
}

function tryGit(args) {
  try { return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim() }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message }; }
}

// Committa il singolo file di spool e lo fa atterrare su origin/<main>.
// Best-effort: mai fatale. Rispecchia il push "single-worktree" dell'hook.
// Esportata perché la riusa anche queue-feedback.mjs (creazione sub-feedback).
export function commitAndPush(file) {
  const mainBranch = process.env.FILO_MAIN_BRANCH || 'main';
  const rel = relative(ROOT, file).split(sep).join('/');
  if (!tryGit(['add', '--', rel]).ok) { console.warn('  ! git add fallito'); return; }
  // `git diff --cached --quiet` esce 0 se NON c'è nulla in stage → niente da committare.
  if (tryGit(['diff', '--cached', '--quiet', '--', rel]).ok) {
    console.log('  (decisione identica già in coda: niente da committare)');
    return;
  }
  const commit = tryGit(['commit', '-q', '-m', `feedback: accoda triage ${new Date().toISOString()}`, '--', rel]);
  if (!commit.ok) { console.warn('  ! git commit fallito:', commit.out.slice(0, 160)); return; }
  const cur = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  tryGit(['push', 'origin', cur]); // traccia il branch corrente (best-effort)
  const land = tryGit(['push', 'origin', `HEAD:${mainBranch}`]); // ff-only
  if (land.ok) console.log(`  ↑ decisione su origin/${mainBranch}.`);
  else console.warn(`  ! push su origin/${mainBranch} rifiutato (main forse avanti). Il file è committato sul branch '${cur}'; fai 'git pull --rebase origin ${mainBranch}' e ripusha, oppure applicala in locale.`);
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const noGit = args.includes('--no-git');
  const [id, status, ...noteParts] = args.filter((a) => a !== '--no-git');
  if (!id || !status) {
    console.error('Uso: node scripts/queue-triage.mjs <id> <status:todo|done|clarify> "testo note" [--no-git]');
    process.exit(1);
  }
  try {
    const file = queueTriage(id, status, noteParts.length ? noteParts.join(' ') : '');
    console.log(`OK: triage accodato → ${file}`);
    if (noGit) console.log('   (--no-git: file scritto ma non committato)');
    else commitAndPush(file);
  } catch (e) {
    console.error('Errore:', e.message);
    process.exit(1);
  }
}
