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
//   node scripts/queue-triage.mjs <id> <status> "testo note"
//     status ∈ todo|working|revision_capability|revision_security|done|design|archived
//     (macchina a stati: vedi FEEDBACK-STATES.md; i vecchi clarify/review/blocked
//     vengono rimappati con un avviso)
//   node scripts/queue-triage.mjs <id> <status> "note" --branch worker/42  (da revision_* in poi)
//   node scripts/queue-triage.mjs <id> <status> "note" --reason loop|clarify (sottotesto statusReason)
//   node scripts/queue-triage.mjs <id> <status> "note" --starred|--unstar   (flag ⭐ preferito, DB2)
//   node scripts/queue-triage.mjs <id> <status> "note" --no-git   (solo scrive il file)
//
//   Di default committa e pusha il file (così la decisione arriva su main anche
//   se nessun Edit/Write fa partire l'hook di auto-commit). Con `--no-git` scrive
//   soltanto il file e lascia il commit a te / all'hook.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardTransition, escalationNote, sealState, readBranchState, stateDir } from './lib/branch-integrity.mjs';
import { pushFileToMainWithRetry, repoPath } from './lib/isolated-push.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// FILO_REPO_ROOT: override per i test (come in dispatch.mjs), così il giro
// completo consegna → ripristino si può esercitare su un repo di prova.
const ROOT = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : resolve(__dirname, '..');
// FILO_SPOOL_DIR: override per i test (scrivono in una dir temporanea senza
// toccare la coda vera, che l'hook di auto-commit pusherebbe su origin/main).
const SPOOL_DIR = process.env.FILO_SPOOL_DIR
  ? resolve(process.env.FILO_SPOOL_DIR)
  : resolve(ROOT, 'feedback-triage');
// Macchina a stati (spec FEEDBACK-STATES.md): la coda accoda SOLO status
// canonici. Quelli dell'iter di lavorazione delle routine:
//   working              = presa in carico (lock, + workingSince scritto da apply)
//   revision_capability  = fix pronto su branch, aspetta la verifica comportamentale
//   revision_security    = verifica passata, aspetta secaudit + merge-gate
//   done                 = fuso su main; aspetta la verifica umana dell'owner
//   design               = serve una decisione dell'owner (domande → --reason
//                          clarify; 3 verifiche fallite → --reason loop)
//   todo                 = rimessa in coda (es. reset di un working scaduto)
// più `archived` (archiviazione delegata, es. auto-archivio a punteggio DC3).
const ALLOWED = ['todo', 'working', 'revision_capability', 'revision_security',
  'done', 'design', 'archived'];

// Nomi RITIRATI accettati in ingresso per cortesia (vecchi file-ruolo/istruzioni
// ancora in giro): rimappati al canonico con un avviso. Rimuovere quando tutte
// le recipe citano solo i canonici.
const LEGACY_INPUT = {
  clarify: { status: 'design', reason: 'clarify' },
  review:  { status: 'revision_capability' },
  blocked: { status: 'design', reason: 'loop' },
};

// Scrive il file di spool (nessun effetto git). Ritorna il path assoluto.
// `starred` (DB2, opzionale): se booleano, accoda anche il flag ⭐ "preferito"
// (parcheggiato per il futuro). undefined = non toccare il flag esistente.
// `reason` (opzionale, ultimo): motivo strutturato del blocco (es. 'loop' per i
// 3 FAIL del verifier→fixer). Accodato come slug breve; la dashboard `manage`
// lo usa per il colore del bordo (loop = nero). Stringa vuota/assente = non toccare.
export function queueTriage(id, status, notes, queuedBy, branch, starred, reason) {
  if (!id) throw new Error('id mancante');
  const legacy = LEGACY_INPUT[status];
  if (legacy) {
    console.warn(`  ! status legacy "${status}" rimappato a "${legacy.status}"${legacy.reason ? ` (reason: ${legacy.reason})` : ''} — aggiorna la recipe che lo usa`);
    if (legacy.reason && !(typeof reason === 'string' && reason.trim())) reason = legacy.reason;
    status = legacy.status;
  }
  if (!ALLOWED.includes(status)) {
    throw new Error(`status non valido: "${status}" (ammessi: ${ALLOWED.join(', ')})`);
  }
  // L'id diventa un nome file: rifiuta tutto ciò che non sia un id Firestore.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error(`id con caratteri non ammessi in un filename: "${id}"`);
  }
  const branchStr = typeof branch === 'string' ? branch.trim().slice(0, 200) : '';
  const reasonStr = typeof reason === 'string' ? reason.trim().slice(0, 60) : '';
  mkdirSync(SPOOL_DIR, { recursive: true });
  const entry = {
    id,
    status,
    notes: typeof notes === 'string' ? notes : '',
    queuedAt: new Date().toISOString(),
    queuedBy: queuedBy || process.env.FILO_ROUTINE_SLUG || 'routine',
  };
  if (branchStr) entry.branch = branchStr;
  if (typeof starred === 'boolean') entry.starred = starred;
  if (reasonStr) entry.reason = reasonStr;
  const file = resolve(SPOOL_DIR, `${id}.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  return file;
}

// S1.2 (Fase 1): le `notes` di triage NON vengono cifrate. Sono la spiegazione
// mostrata all'utente nel popup ricompense (C5), che gira sulla sua macchina
// senza chiave privata → cifrarle le renderebbe illeggibili. La loro cifratura
// (insieme a status/verdetti, con proiezione sanitizzata user-facing) è Fase 2.
// La funzione resta async e separata per non cambiare i call site quando la
// Fase 2 reintrodurrà la cifratura qui.
export async function queueTriageEncrypted(id, status, notes, queuedBy, branch, starred, reason) {
  return queueTriage(id, status, notes, queuedBy, branch, starred, reason);
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

  // Il fogliettino viene comunque registrato sul branch corrente, così resta
  // nella storia del lavoro anche se la spedizione fallisce.
  if (!tryGit(['add', '--', rel]).ok) { console.warn('  ! git add fallito'); return; }
  if (tryGit(['diff', '--cached', '--quiet', '--', rel]).ok) {
    console.log('  (decisione identica già in coda: niente da committare)');
    return;
  }
  const commit = tryGit(['commit', '-q', '-m', `feedback: accoda triage ${new Date().toISOString()}`, '--', rel]);
  if (!commit.ok) { console.warn('  ! git commit fallito:', commit.out.slice(0, 160)); return; }
  const cur = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  tryGit(['push', 'origin', cur]); // traccia il branch corrente (best-effort)

  // ⚠️ La spedizione al ramo principale porta SOLO questo file (spec §Via 2).
  // Il vecchio `push HEAD:main` spediva l'intera storia del branch: il
  // fogliettino era il biglietto, ma saliva tutto il treno — codice compreso,
  // saltando il cancello di sicurezza senza lasciare traccia distinguibile.
  const land = pushFileToMainWithRetry(ROOT, file, `feedback: accoda triage ${new Date().toISOString()}`);
  if (land.ok && land.skipped) console.log(`  (decisione già presente su origin/${mainBranch})`);
  else if (land.ok) console.log(`  ↑ decisione su origin/${mainBranch} (solo il file della decisione).`);
  else console.warn(`  ! spedizione su origin/${mainBranch} non riuscita (${land.reason}). Il file è committato sul branch '${cur}' e verrà riprovato; oppure applicala in locale.`);
}

// ─── C: una consegna ACCETTATA lascia un PUNTO FERMO ─────────────────────────
//
// La guardia qui sotto è solo METÀ della regola. L'altra metà — «ogni
// transizione accettata lascia un punto fermo» — viveva solo in dispatch.mjs
// (i verdetti), e questo è il punto in cui si registrano le CONSEGNE. Senza,
// dopo una consegna l'ultimo punto fermo restava quello della CREAZIONE del
// branch: il giro dopo vedeva i commit del lavoro come "istanza interrotta",
// riportava il branch a prima che il lavoro esistesse e riallineava anche
// origin. Chi doveva verificare trovava il vuoto (#460, incidente del 24 luglio
// in miniatura: il vuoto si legge come "lavoro mai fatto" e si riscrive tutto).
//
// Sigillare qui — non nel file-ruolo, non nella prosa — è ciò che rende la
// consegna un punto di non ritorno: da qui in poi il ripristino torna AL LAVORO.
// `prev` è lo stato che la guardia ha appena VALIDATO: si sigilla quello, non
// una rilettura — fra le due potrebbe essere cambiato, e sarebbe un punto fermo
// su qualcosa che nessuno ha verificato.
function sealDelivery(id, status, prev) {
  // Nessun branch assegnato (owner a mano, feedback fuori pipeline): non c'è
  // nessuna identità da fissare, esattamente come per la guardia.
  if (!prev || !prev.branch) return null;
  const sealed = sealState(ROOT, { ...prev, id }, `consegna:${status}`);
  persistStateToGit(id, `feedback: punto fermo consegna ${id}`);
  return sealed;
}

// Il punto fermo deve sopravvivere alla fine della sessione: lo scrive uno
// script lanciato via Bash, e l'hook di auto-commit scatta solo su Edit/Write.
// Non committato, il primo reset/rebase lo cancella — ed è di nuovo come non
// averlo mai registrato. Stesso trattamento dei verdetti (dispatch.mjs):
// commit path-limited sul branch corrente + spedizione ISOLATA del solo file di
// stato al ramo principale (mai `push HEAD:main`, che porterebbe su main tutto
// il lavoro non ancora esaminato). Best-effort: un guasto git non deve far
// fallire la consegna.
function persistStateToGit(id, message) {
  // Nei test lo stato è un file temporaneo fuori dal repo: niente git.
  if (process.env.FILO_DISPATCH_STATE_DIR) return;
  const abs = resolve(stateDir(ROOT), `${id}.json`);
  const rel = repoPath(ROOT, abs);
  if (!tryGit(['add', '--', rel]).ok) return;
  if (tryGit(['diff', '--cached', '--quiet', '--', rel]).ok) return;
  if (!tryGit(['commit', '-q', '-m', message, '--', rel]).ok) return;
  pushFileToMainWithRetry(ROOT, abs, message);
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const noGit = args.includes('--no-git');
  // --branch <nome>: estrai il valore e rimuovi entrambi i token dagli args.
  let branch = '';
  const bi = args.indexOf('--branch');
  if (bi !== -1) branch = args[bi + 1] || '';
  // --reason <slug>: motivo strutturato del blocco (es. loop). Stesso pattern di --branch.
  let reason = '';
  const ri = args.indexOf('--reason');
  if (ri !== -1) reason = args[ri + 1] || '';
  // --starred / --unstar: alza/abbassa il flag ⭐ "preferito" (DB2).
  let starred;
  if (args.includes('--starred')) starred = true;
  else if (args.includes('--unstar')) starred = false;
  const positional = args.filter((a, i) =>
    a !== '--no-git' && a !== '--branch' && a !== '--reason' && a !== '--starred' && a !== '--unstar'
    && !(bi !== -1 && i === bi + 1)
    && !(ri !== -1 && i === ri + 1));
  const [id, status, ...noteParts] = positional;
  if (!id || !status) {
    console.error('Uso: node scripts/queue-triage.mjs <id> <status:todo|working|revision_capability|revision_security|done|design|archived> "testo note" [--branch <nome>] [--reason <slug>] [--starred|--unstar] [--no-git]');
    process.exit(1);
  }
  // ── C: le CONSEGNE verificano l'identità come i verdetti ──────────────────
  //
  // Spec ROUTINE-BRANCH-INTEGRITY.md §C: non solo i verdetti, ogni transizione.
  // Se una consegna può essere registrata con la directory sul branch sbagliato,
  // il PUNTO FERMO che quella consegna registra è fasullo — e il ripristino (D)
  // riporterebbe a uno stato che contiene il lavoro di un altro feedback. Questo
  // controllo è il prerequisito di D, non un extra.
  //
  // Guardate SOLO le consegne (`revision_*`): `done` lo scrive il secaudit dopo
  // che il merge-gate ha già spostato la directory sul ramo principale, e
  // `todo`/`working`/`design`/`archived` sono scritture di servizio del
  // dispatcher e dell'owner. E scatta solo se per quel feedback esiste un branch
  // assegnato: senza, non c'è niente da confrontare (owner che lancia a mano,
  // feedback fuori dalla pipeline).
  if (status === 'revision_capability' || status === 'revision_security') {
    const g = guardTransition(ROOT, id, {
      escalate: (count) => {
        execFileSync('node', [resolve(ROOT, 'scripts', 'queue-triage.mjs'), id, 'design',
          escalationNote(count), '--reason', 'loop'], { cwd: ROOT, encoding: 'utf8', stdio: 'ignore' });
      },
    });
    if (!g.ok) {
      console.error(`[queue-triage] CONSEGNA RIFIUTATA — ${g.message}`);
      console.error('[queue-triage] Il lavoro NON è stato registrato: la directory non è sul branch assegnato a questo feedback.');
      process.exit(3);
    }
    // Accettata ⇒ punto fermo. Prima della coda: se la spedizione del
    // fogliettino fallisce il lavoro resta comunque protetto dal ripristino,
    // mentre un punto fermo mancante non è recuperabile dal giro dopo.
    try { sealDelivery(id, status); } catch (e) {
      console.warn(`  ! punto fermo non registrato: ${e.message}`);
    }
  }

  try {
    // S1.2: usa la versione cifrata per proteggere la history git pubblica.
    const file = await queueTriageEncrypted(id, status, noteParts.length ? noteParts.join(' ') : '', undefined, branch, starred, reason);
    console.log(`OK: triage accodato → ${file}`);
    if (noGit) console.log('   (--no-git: file scritto ma non committato)');
    else commitAndPush(file);
  } catch (e) {
    console.error('Errore:', e.message);
    process.exit(1);
  }
}
