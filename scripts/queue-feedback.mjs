// Accoda la CREAZIONE di un nuovo feedback nello "spool" su git.
//
// PERCHÉ ESISTE
//   Quando una routine cloud riceve un feedback-spec troppo grosso per una
//   sessione, lo spezza in sub-feedback autoconsistenti che le routine
//   successive lavoreranno per priorità. Le routine non possono scrivere su
//   Firestore (vedi queue-triage.mjs): la creazione viene accodata come file
//   `feedback-triage/new-<ts>-<rand>.json` e applicata dalla GitHub Action
//   (scripts/apply-triage.mjs) col service account.
//
//   Numerazione: ogni feedback ha un numero leggibile (#22). I sub-feedback
//   ereditano il numero del padre con un suffisso (#22.1, #22.2…): il numero
//   concreto viene calcolato dall'applier al momento della creazione, qui si
//   indica solo il padre (--parent <idFirestore>). Senza --parent il feedback
//   creato è top-level e riceve il prossimo numero progressivo libero.
//
// USO:
//   node scripts/queue-feedback.mjs --name "titolo breve" \
//     [--parent <idFeedbackPadre>] [--priority 0-3] [--status todo|clarify] \
//     [--notes "note iniziali"] [--no-git] "testo del feedback"
//
//   Di default committa e pusha il file (come queue-triage.mjs). Con --no-git
//   scrive soltanto il file e lascia il commit all'hook di auto-commit.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAndPush } from './queue-triage.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// FILO_SPOOL_DIR: override per i test (vedi queue-triage.mjs).
const SPOOL_DIR = process.env.FILO_SPOOL_DIR
  ? resolve(process.env.FILO_SPOOL_DIR)
  : resolve(ROOT, 'feedback-triage');
const ALLOWED_STATUS = ['todo', 'clarify'];

// Valida i parametri e costruisce l'oggetto-entry per lo spool (logica pura,
// testata in tests/unit). Lancia su input non valido.
export function buildCreateEntry({ text, name, parentId, priority, status, notes, queuedBy }) {
  const t = String(text || '').trim();
  if (!t) throw new Error('testo mancante');
  if (t.length > 10000) throw new Error('testo troppo lungo (max 10000)');
  const n = String(name || '').trim();
  if (!n) throw new Error('--name mancante (titolo breve del feedback)');
  if (n.length > 200) throw new Error('--name troppo lungo (max 200)');
  const st = status || 'todo';
  if (!ALLOWED_STATUS.includes(st)) {
    throw new Error(`status non valido: "${st}" (ammessi: ${ALLOWED_STATUS.join(', ')})`);
  }
  if (parentId && !/^[A-Za-z0-9_-]+$/.test(parentId)) {
    throw new Error(`--parent con caratteri non ammessi: "${parentId}"`);
  }
  let prio = 0;
  if (priority !== undefined && priority !== null && priority !== '') {
    prio = Number(priority);
    if (!Number.isInteger(prio) || prio < 0 || prio > 3) {
      throw new Error(`--priority non valida: "${priority}" (intero 0-3)`);
    }
  }
  return {
    op: 'create',
    text: t,
    name: n,
    parentId: parentId || '',
    status: st,
    priority: prio,
    notes: typeof notes === 'string' ? notes : '',
    queuedAt: new Date().toISOString(),
    queuedBy: queuedBy || process.env.FILO_ROUTINE_SLUG || 'routine',
  };
}

// Scrive il file di spool (nessun effetto git). Ritorna il path assoluto.
export function queueFeedbackCreate(opts) {
  const entry = buildCreateEntry(opts);
  mkdirSync(SPOOL_DIR, { recursive: true });
  // Il nome file inizia con "new-": è ciò che distingue le creazioni dalle
  // decisioni di triage (<idFeedback>.json) dentro la stessa coda.
  const rand = Math.random().toString(36).slice(2, 8);
  const file = resolve(SPOOL_DIR, `new-${Date.now()}-${rand}.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return file;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-git') out.noGit = true;
    else if (a === '--parent') out.parentId = argv[++i];
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--priority') out.priority = argv[++i];
    else if (a === '--status') out.status = argv[++i];
    else if (a === '--notes') out.notes = argv[++i];
    else out._.push(a);
  }
  return out;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const file = queueFeedbackCreate({
      text: args._.join(' '),
      name: args.name,
      parentId: args.parentId,
      priority: args.priority,
      status: args.status,
      notes: args.notes,
    });
    console.log(`OK: creazione feedback accodata → ${file}`);
    if (args.noGit) console.log('   (--no-git: file scritto ma non committato)');
    else commitAndPush(file);
  } catch (e) {
    console.error('Errore:', e.message);
    console.error('Uso: node scripts/queue-feedback.mjs --name "titolo" [--parent <id>] [--priority 0-3] [--status todo|clarify] [--notes "..."] "testo"');
    process.exit(1);
  }
}
