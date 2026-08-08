// finish-local.mjs — chiude un lavoro LOCALE e lo pubblica, una volta sola.
//
// PERCHÉ ESISTE (spec: ROUTINE-BRANCH-INTEGRITY.md §Sessioni locali)
//   Fino al 2026-08-07 una sessione locale pubblicava sul ramo principale a
//   OGNI modifica di file. Tre conseguenze, tutte reali:
//
//   1. Una versione viene costruita e distribuita agli utenti ogni 6 ore,
//      prendendo il ramo principale così com'è. Se la fotografia cadeva a metà
//      sessione, agli utenti arrivava un lavoro incompleto — un file rinominato
//      e chi lo usa ancora no.
//   2. Ogni pubblicazione sposta il ramo principale sotto i piedi delle routine
//      in corso: le loro spedizioni venivano rifiutate, e soprattutto il
//      cancello di sicurezza giudicava una fotografia diversa da quella che poi
//      veniva fusa.
//   3. Il ramo principale conteneva stati intermedi che non erano mai stati
//      pensati come "finiti".
//
//   La durabilità (salvare e spedire il proprio ramo a ogni modifica) resta:
//   è ciò che ha salvato il lavoro di questa stessa sessione dopo due
//   interruzioni. A cambiare è solo QUANDO si arriva al ramo principale: una
//   volta, quando il lavoro è finito, e dopo i controlli.
//
// USO:
//   node scripts/finish-local.mjs                 # controlli + fusione + push
//   node scripts/finish-local.mjs --check         # solo i controlli
//   node scripts/finish-local.mjs --no-verify     # salta i controlli (sconsigliato)

import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = process.env.FILO_MAIN_BRANCH || 'main';

function git(args, opts = {}) {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message };
  }
}

function run(cmd, args, label) {
  process.stdout.write(`\n▸ ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

/** Gli spec Playwright che toccano le aree modificate dal branch. Puro. */
export function specsForChangedFiles(changed) {
  const files = Array.isArray(changed) ? changed : [];
  const specs = new Set();
  for (const f of files) {
    // Uno spec che porta il nome della cosa toccata è il candidato ovvio;
    // meglio pochi mirati che l'intera suite (~25 minuti).
    const m = f.match(/^src\/pages\/([^/]+)\//);
    if (m) specs.add(`tests/${m[1]}`);
    const p = f.match(/^src\/(?:shared|content|renderer|main)\/([^/.]+)/);
    if (p) specs.add(`tests/${p[1].toLowerCase()}`);
    if (f.startsWith('tests/') && f.endsWith('.spec.mjs')) specs.add(f.replace(/\.spec\.mjs$/, ''));
  }
  return [...specs];
}

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const skipVerify = argv.includes('--no-verify');

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (!branch || branch === 'HEAD') { console.error('Stato del repo non chiaro: nessun ramo corrente.'); process.exit(1); }
  if (branch === MAIN) { console.error(`Sei già su ${MAIN}: non c'è niente da fondere.`); process.exit(1); }

  if (!git(['diff', '--quiet']).ok || !git(['diff', '--cached', '--quiet']).ok) {
    console.error('Ci sono modifiche non salvate: falle salvare (un Edit qualsiasi) prima di chiudere.');
    process.exit(1);
  }

  if (!skipVerify) {
    // 1. Logica pura — veloce, nessuna finestra che si apre.
    if (!run('npm', ['run', 'test:unit'], 'Controlli di logica')) {
      console.error('\n✗ Controlli di logica rossi: non pubblico. Sistema e rilancia.');
      process.exit(1);
    }
    // 2. Spec mirati alle aree toccate. La suite completa gira nel cancello di
    //    pubblicazione e nelle routine: qui serve il segnale rapido.
    const changed = git(['diff', '--name-only', `${MAIN}...HEAD`]).out.split('\n').filter(Boolean);
    const specs = specsForChangedFiles(changed).filter((s) => git(['ls-files', '--error-unmatch', `${s}.spec.mjs`]).ok);
    if (specs.length) {
      const args = ['playwright', 'test', ...specs.map((s) => `${s}.spec.mjs`)];
      if (!run('npx', args, `Spec delle aree toccate (${specs.length})`)) {
        console.error('\n✗ Spec rossi: non pubblico. Sistema e rilancia.');
        process.exit(1);
      }
    } else {
      console.log('\n(nessuno spec mirato per le aree toccate: il lavoro verrà comunque ricontrollato prima della pubblicazione agli utenti)');
    }
  }

  if (checkOnly) { console.log('\n✓ Controlli passati (--check: non fondo).'); return; }

  // Fusione: una volta, a lavoro finito.
  const cur = git(['rev-parse', 'HEAD']).out;
  if (!git(['fetch', 'origin', MAIN]).ok) { console.error(`Non riesco a leggere origin/${MAIN}.`); process.exit(1); }
  if (!git(['checkout', MAIN]).ok) { console.error(`Non riesco a passare su ${MAIN}.`); process.exit(1); }
  git(['pull', '--rebase', 'origin', MAIN]);
  const merged = git(['merge', '--no-edit', cur]);
  if (!merged.ok) {
    git(['merge', '--abort']);
    git(['checkout', branch]);
    console.error(`Fusione in conflitto:\n${merged.out.slice(0, 400)}\nRisolvi e rilancia.`);
    process.exit(1);
  }
  const pushed = git(['push', 'origin', MAIN]);
  if (!pushed.ok) {
    console.error(`Spedizione rifiutata (${MAIN} è avanzato): fai un pull --rebase e rilancia.\n${pushed.out.slice(0, 300)}`);
    process.exit(1);
  }
  git(['checkout', branch]);
  console.log(`\n✓ '${branch}' fuso su ${MAIN} e pubblicato. Sei di nuovo su '${branch}'.`);
}

const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMainModule) main();
