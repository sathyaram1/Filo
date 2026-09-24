// Lanciatore degli unit test — deterministico, indipendente da shell e Node.
//
// PERCHÉ ESISTE
//   Prima `npm run test:unit` era `node --test "tests/unit/**/*.test.mjs"`.
//   Quella riga funziona SOLO se qualcuno espande il glob: su questa macchina
//   (Node 22) lo espande Node; sul runner della pubblicazione (Node 20, bash
//   su Windows) non lo espande nessuno, e Node cerca un file che si chiama
//   letteralmente `tests\unit\**\*.test.mjs`, non lo trova ed esce con errore.
//
//   Risultato reale, dal 18/08/2026: il cancello prima della pubblicazione era
//   rosso a ogni giro — non perché un test fallisse, ma perché i test non
//   partivano — e nessuna versione arrivava più agli utenti. Un difetto
//   invisibile da qui, perché in locale funzionava.
//
//   Qui i file si trovano camminando la cartella e si passano UNO PER UNO a
//   `node --test`. Non c'è niente da espandere: nessuna shell, nessun glob,
//   nessuna versione di Node che si comporta diversamente dall'altra.
//
// COSA GARANTISCE IN PIÙ
//   · funziona da QUALUNQUE cartella (i percorsi si calcolano da questo file,
//     non da dove è stato lanciato, e i test girano con la root del repo come
//     cartella corrente, esattamente come prima);
//   · se non trova NESSUN test si ferma con errore invece di uscire verde:
//     "zero test eseguiti" non deve mai somigliare a "tutto a posto" — è
//     precisamente il modo in cui un cancello smette di essere un cancello.
//
// USO
//   node scripts/run-unit-tests.mjs                  tutti gli unit test
//   node scripts/run-unit-tests.mjs --list           stampa i file e basta
//   node scripts/run-unit-tests.mjs <flag di node>   i flag passano a node --test
//     (es. --test-name-pattern=…, --test-reporter=…)

import { readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** La root del repo: da QUESTO file, mai da dove è stato lanciato il comando. */
export const REPO_ROOT = resolve(__dirname, '..');

/**
 * Dove vivono gli unit test. `FILO_UNIT_DIR` esiste SOLO per i test di questo
 * lanciatore (cartelle usa-e-getta), come `FILO_REPO_ROOT` per gli script delle
 * routine: non è un'opzione d'uso.
 */
export const UNIT_DIR = process.env.FILO_UNIT_DIR
  ? resolve(process.env.FILO_UNIT_DIR)
  : resolve(REPO_ROOT, 'tests', 'unit');

/** Un file di test è un `*.test.mjs`. PURA. */
export function isTestFile(name) {
  return /\.test\.mjs$/.test(String(name || ''));
}

/**
 * Tutti i file di test sotto `dir`, ricorsivamente, in ordine stabile.
 *
 * Ricorsiva anche se oggi la cartella è piatta: il giorno in cui qualcuno
 * raggruppa i test in sottocartelle, il lanciatore non deve smettere in
 * silenzio di eseguirne una parte — che è esattamente il guasto che questo
 * file esiste per non ripetere.
 *
 * Percorsi ASSOLUTI: è ciò che rende il lancio indipendente dalla cartella
 * corrente.
 */
export function collectTestFiles(dir = UNIT_DIR) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return []; // cartella assente: lo dice il chiamante, non un'eccezione qui
  }
  const out = [];
  for (const e of entries) {
    // Niente cartelle nascoste né dipendenze: lì dentro non ci sono i nostri
    // test, e `node_modules` costerebbe una camminata lunghissima.
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectTestFiles(full));
    else if (e.isFile() && isTestFile(e.name)) out.push(full);
  }
  // Ordine stabile e indipendente dal filesystem: due macchine devono eseguire
  // gli stessi test nello stesso ordine.
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ─── Il binario di Filo, che qui non serve ma può fermare tutto ──────────────
//
// Gli unit test sono logica pura: nessuno apre Filo. Alcuni però caricano i
// SORGENTI dell'app per provarli (le scorciatoie, l'aggiornamento, il menu), e
// un sorgente dell'app comincia chiedendo `require('electron')`. Quel modulo non
// è l'app: è tre righe che restituiscono il PERCORSO del binario scaricato
// durante l'installazione. Se il binario non c'è, non risponde «non c'è»:
// SOLLEVA un errore, e il test muore per un motivo che col test non c'entra.
//
// Succede più spesso di quanto sembri: chi installa saltando lo scaricamento
// (il lavoro automatico su Windows lo fa apposta, quei 263 MB non li apre
// nessuno), chi ha avuto lo scaricamento fallito, chi ha una copia appena presa.
// In tutti quei casi `npm run test:unit` usciva rosso su due test sani, senza
// che niente fosse rotto.
//
// La cura: se il binario non c'è, si dice a quel modulo DOVE sarebbe stato.
// Torna un percorso, come sempre, e i test che volevano solo leggere il
// sorgente girano. Il percorso punta a una cartella che non esiste: nessuno può
// farci partire l'app per sbaglio, e chi ci provasse leggerebbe quel percorso
// nell'errore.

/**
 * Vero se `require('electron')` risponde. Si CHIEDE, invece di cercare il file
 * col percorso: la cosa che conta non è quale file c'è sul disco, è se il
 * modulo risponde o solleva, che è precisamente ciò che fa morire i test.
 */
export function binarioScaricato() {
  try {
    createRequire(import.meta.url)('electron');
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * L'ambiente con cui far girare gli unit test. PURA.
 * Tocca una cosa sola, e solo quando serve: se il binario manca e nessuno ha già
 * detto dove cercarlo, lo dichiara. Con il binario installato l'ambiente esce
 * identico a com'è entrato.
 */
/**
 * Il modulo caricato PRIMA di ogni unit test: fa arrivare i file del repo coi
 * fini riga del repo, qualunque cosa abbia scritto sul disco la macchina che
 * ha clonato. È qui e non nei singoli test perché una regola che ogni test deve
 * ricordarsi di seguire prima o poi non la segue qualcuno, e il rosso arriva
 * sulla sola macchina che pubblica (#565, #569).
 */
export const PRELOAD_FINI_RIGA = resolve(REPO_ROOT, 'tests', 'helpers', 'finiRigaDelRepo.cjs');

export function ambienteDeiTest(env = process.env, { scaricato = true, root = REPO_ROOT } = {}) {
  const fuori = { ...env };
  if (!scaricato && !fuori.ELECTRON_OVERRIDE_DIST_PATH) {
    fuori.ELECTRON_OVERRIDE_DIST_PATH = join(root, 'node_modules', 'electron', 'dist');
  }
  return fuori;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes('--list');
  const flags = argv.filter((a) => a !== '--list');

  const files = collectTestFiles();
  if (!files.length) {
    console.error(`[test:unit] nessun file *.test.mjs sotto ${UNIT_DIR}: mi fermo.`);
    console.error('[test:unit] zero test eseguiti non è un successo — controlla la cartella.');
    process.exit(1);
  }

  if (listOnly) {
    for (const f of files) console.log(f);
    // `exitCode` e non `exit()`: su Windows lo stdout verso una pipe è
    // asincrono, e uscire di colpo troncherebbe l'elenco.
    process.exitCode = 0;
    return;
  }

  const scaricato = binarioScaricato();
  if (!scaricato) {
    // Detto, non taciuto: chi legge il registro deve capire perché l'ambiente
    // non è quello di sempre.
    console.error('[test:unit] il binario di Filo non è installato: gli unit test girano lo stesso (nessuno lo apre).');
  }

  const r = spawnSync(process.execPath, ['--require', PRELOAD_FINI_RIGA, '--test', ...flags, ...files], {
    stdio: 'inherit',
    // I test si aspettano la root del repo come cartella corrente, come quando
    // li lanciava npm. Così `npm run test:unit` e un lancio da fuori danno lo
    // stesso risultato.
    cwd: REPO_ROOT,
    env: ambienteDeiTest(process.env, { scaricato }),
  });
  if (r.error) {
    console.error(`[test:unit] non sono riuscito a lanciare node: ${r.error.message}`);
    process.exit(1);
  }
  // Ucciso da un segnale: non è un successo, e `status` in quel caso è null.
  process.exit(r.status === null ? 1 : r.status);
}

// Esegui solo se invocato come script (non quando importato dai test).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
