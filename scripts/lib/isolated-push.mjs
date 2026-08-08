// isolated-push.mjs — far atterrare UN file sul ramo principale, e SOLO quello.
//
// PERCHÉ ESISTE (spec: ROUTINE-BRANCH-INTEGRITY.md §Via 2)
//   Le routine non possono scrivere nel database dei feedback: depositano la
//   decisione in un fogliettino su git e lo spediscono al ramo principale. Il
//   comando usato finora diceva «prendi il punto in cui mi trovo e mettilo sul
//   ramo principale» — ma "il punto in cui mi trovo" non è il fogliettino: è
//   TUTTA la storia accumulata sul ramo, fogliettino e codice insieme. Se il
//   ramo principale non si era mosso, quella spedizione era un avanzamento
//   regolare e veniva accettata in blocco: il codice atterrava sugli utenti
//   senza passare dal cancello di sicurezza, e nella storia non si distingueva
//   da una fusione legittima.
//
//   Un cancello che si può saltare a seconda del tempismo non è un cancello:
//   non puoi più guardare il risultato e dire "questo è stato esaminato".
//
// COME
//   Il commit viene COSTRUITO sopra `origin/main` così com'è adesso, in un
//   indice temporaneo che contiene solo quel file, e si spedisce l'oggetto
//   commit direttamente. Non c'è nessuna storia locale attaccata, quindi non
//   c'è niente che possa salire insieme: la garanzia è per costruzione, non
//   per disciplina.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, sep } from 'node:path';

function git(root, args, extraEnv = {}) {
  try {
    const out = execFileSync('git', args, {
      cwd: root, encoding: 'utf8', env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: String(out).trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message };
  }
}

/** Percorso relativo al repo, con le barre in avanti (git non ne vuole altre). */
export function repoPath(root, file) {
  return relative(root, file).split(sep).join('/');
}

/**
 * Spedisce UN SOLO file al ramo principale, costruendo il commit sopra lo stato
 * remoto attuale. Niente della storia locale sale con lui.
 *
 * @returns {{ok:boolean, reason?:string, sha?:string, skipped?:boolean, out?:string}}
 *   `skipped` quando il file è già identico sul ramo remoto (niente da fare).
 */
export function pushFileToMain(root, file, message, mainBranch = process.env.FILO_MAIN_BRANCH || 'main') {
  const rel = repoPath(root, file);

  const fetched = git(root, ['fetch', 'origin', mainBranch]);
  if (!fetched.ok) return { ok: false, reason: 'fetch', out: fetched.out };

  const base = git(root, ['rev-parse', `origin/${mainBranch}`]);
  if (!base.ok) return { ok: false, reason: 'base-irraggiungibile', out: base.out };

  // Il contenuto del file diventa un oggetto nel deposito, senza toccare
  // l'indice vero (che appartiene al lavoro in corso dell'istanza).
  let content;
  try { content = readFileSync(file); } catch (e) { return { ok: false, reason: 'file-illeggibile', out: e.message }; }
  const written = (() => {
    try {
      const out = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: root, input: content, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { ok: true, out: String(out).trim() };
    } catch (e) { return { ok: false, out: `${e.stderr || e.message}` }; }
  })();
  if (!written.ok) return { ok: false, reason: 'blob', out: written.out };

  // Indice TEMPORANEO: parte dall'albero remoto e riceve solo questo file. Non
  // tocchiamo `.git/index`, quindi il lavoro in corso dell'istanza resta intatto.
  const tmp = mkdtempSync(resolve(tmpdir(), 'filo-iso-'));
  const idx = resolve(tmp, 'index');
  try {
    const env = { GIT_INDEX_FILE: idx };
    const read = git(root, ['read-tree', `origin/${mainBranch}`], env);
    if (!read.ok) return { ok: false, reason: 'read-tree', out: read.out };

    const add = git(root, ['update-index', '--add', '--cacheinfo', `100644,${written.out},${rel}`], env);
    if (!add.ok) return { ok: false, reason: 'update-index', out: add.out };

    const tree = git(root, ['write-tree'], env);
    if (!tree.ok) return { ok: false, reason: 'write-tree', out: tree.out };

    const baseTree = git(root, ['rev-parse', `origin/${mainBranch}^{tree}`]);
    if (baseTree.ok && baseTree.out === tree.out) {
      return { ok: true, skipped: true, sha: base.out };
    }

    const commit = git(root, [
      'commit-tree', tree.out, '-p', base.out, '-m', message,
    ], { GIT_AUTHOR_NAME: 'claude-routine', GIT_AUTHOR_EMAIL: 'claude@routine',
         GIT_COMMITTER_NAME: 'claude-routine', GIT_COMMITTER_EMAIL: 'claude@routine' });
    if (!commit.ok) return { ok: false, reason: 'commit-tree', out: commit.out };

    // Spedizione dell'OGGETTO commit: non del ramo su cui ci troviamo. Se nel
    // frattempo il ramo remoto si è mosso viene rifiutata, e il chiamante
    // riprova ricostruendo sopra il nuovo stato — non forziamo mai.
    const push = git(root, ['push', 'origin', `${commit.out}:refs/heads/${mainBranch}`]);
    if (!push.ok) return { ok: false, reason: 'push-rifiutato', out: push.out, sha: commit.out };

    return { ok: true, sha: commit.out };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

/**
 * Gemella di `pushFileToMain` per la RIMOZIONE di un file (il rilascio di un
 * semaforo di lavorazione). Stessa garanzia: il commit nasce sopra lo stato
 * remoto attuale e contiene solo quella rimozione.
 */
export function removeFileOnMain(root, relPathInRepo, message, mainBranch = process.env.FILO_MAIN_BRANCH || 'main') {
  const rel = String(relPathInRepo).split(sep).join('/');

  const fetched = git(root, ['fetch', 'origin', mainBranch]);
  if (!fetched.ok) return { ok: false, reason: 'fetch', out: fetched.out };
  const base = git(root, ['rev-parse', `origin/${mainBranch}`]);
  if (!base.ok) return { ok: false, reason: 'base-irraggiungibile', out: base.out };

  const tmp = mkdtempSync(resolve(tmpdir(), 'filo-iso-'));
  const idx = resolve(tmp, 'index');
  try {
    const env = { GIT_INDEX_FILE: idx };
    const read = git(root, ['read-tree', `origin/${mainBranch}`], env);
    if (!read.ok) return { ok: false, reason: 'read-tree', out: read.out };

    const rm = git(root, ['update-index', '--force-remove', rel], env);
    if (!rm.ok) return { ok: false, reason: 'update-index', out: rm.out };

    const tree = git(root, ['write-tree'], env);
    if (!tree.ok) return { ok: false, reason: 'write-tree', out: tree.out };

    const baseTree = git(root, ['rev-parse', `origin/${mainBranch}^{tree}`]);
    if (baseTree.ok && baseTree.out === tree.out) return { ok: true, skipped: true, sha: base.out };

    const commit = git(root, ['commit-tree', tree.out, '-p', base.out, '-m', message],
      { GIT_AUTHOR_NAME: 'claude-routine', GIT_AUTHOR_EMAIL: 'claude@routine',
        GIT_COMMITTER_NAME: 'claude-routine', GIT_COMMITTER_EMAIL: 'claude@routine' });
    if (!commit.ok) return { ok: false, reason: 'commit-tree', out: commit.out };

    const push = git(root, ['push', 'origin', `${commit.out}:refs/heads/${mainBranch}`]);
    if (!push.ok) return { ok: false, reason: 'push-rifiutato', out: push.out, sha: commit.out };
    return { ok: true, sha: commit.out };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

/**
 * Come sopra, con i tentativi che servono quando due routine spediscono nello
 * stesso istante: ogni tentativo ricostruisce il commit sopra lo stato remoto
 * appena riletto, quindi non c'è nessuna forzatura e nessuna perdita.
 */
export function pushFileToMainWithRetry(root, file, message, attempts = 4, mainBranch = undefined) {
  return withRetry(() => pushFileToMain(root, file, message, mainBranch), attempts);
}

export function removeFileOnMainWithRetry(root, relPathInRepo, message, attempts = 4, mainBranch = undefined) {
  return withRetry(() => removeFileOnMain(root, relPathInRepo, message, mainBranch), attempts);
}

function withRetry(fn, attempts) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = fn();
    if (last.ok) return last;
    // Solo il rifiuto per concorrenza si ritenta: gli altri guasti non
    // migliorano riprovando, e insistere sprecherebbe il giro.
    if (last.reason !== 'push-rifiutato') return last;
  }
  return last;
}
