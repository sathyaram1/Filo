// Lanciatore degli unit test: trova da sé i *.test.mjs (un glob sul runner Node 20 non lo espande nessuno) e li passa a
// `node --test` relativi alla root e a gruppi, perché la riga di Windows ha un tetto (#765). Zero file = uscita rossa.
// Uso: `--list` stampa i file; ogni altro argomento è un flag di `node --test`. Sentinella: tests/unit/unitRunner.test.mjs.

import { readdirSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { lottiPerRigaDiComando, costoArgomentoWindows } from './lib/riga-di-comando.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Da QUESTO file, mai da dove è stato lanciato il comando. */
export const REPO_ROOT = resolve(__dirname, '..');

/** `FILO_UNIT_DIR` e `FILO_UNIT_TETTO_RIGA` esistono solo per i test di questo lanciatore, non sono opzioni d'uso. */
export const UNIT_DIR = process.env.FILO_UNIT_DIR
  ? resolve(process.env.FILO_UNIT_DIR)
  : resolve(REPO_ROOT, 'tests', 'unit');

// CreateProcess regge 32.767 caratteri; il resto è margine per un flag strano.
export const TETTO_RIGA = Number(process.env.FILO_UNIT_TETTO_RIGA) || 30000;

/** PURA. */
export function isTestFile(name) {
  return /\.test\.mjs$/.test(String(name || ''));
}

/**
 * Ricorsiva anche se oggi la cartella è piatta: raggruppare i test in sottocartelle non deve farne saltare una parte.
 * Percorsi assoluti e ordine stabile: due macchine eseguono gli stessi test nello stesso ordine.
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
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectTestFiles(full));
    else if (e.isFile() && isTestFile(e.name)) out.push(full);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Relativo alla root, così la riga non cresce col nome della cartella di lavoro; barre normali perché Node 22 legge
 * gli argomenti di `--test` come glob. Un file fuori dalla root resta assoluto. PURA.
 */
export function perLaRiga(file, root = REPO_ROOT) {
  const r = relative(root, file);
  if (!r || r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) return file;
  return r.split(sep).join('/');
}

/** I file di ogni `node --test`, a gruppi la cui riga intera (eseguibile e flag compresi) sta in `tetto`. PURA. */
export function gruppiDiLancio(files, { root = REPO_ROOT, flags = [], execPath = process.execPath, tetto = TETTO_RIGA } = {}) {
  const fisso = [execPath, '--test', ...flags].reduce((n, a) => n + costoArgomentoWindows(a), 0);
  return lottiPerRigaDiComando(files.map((f) => perLaRiga(f, root)), tetto, { fisso, costo: costoArgomentoWindows });
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
    process.exitCode = 1;
    return;
  }

  if (listOnly) {
    for (const f of files) console.log(f);
    // `exitCode` e non `exit()`: su Windows lo stdout verso una pipe è asincrono, e uscire di colpo troncherebbe l'elenco.
    process.exitCode = 0;
    return;
  }

  const gruppi = gruppiDiLancio(files, { flags });
  const tanti = gruppi.length > 1;
  const rossi = [];
  let esito = 0, interrotto = false;
  if (tanti) console.log(`[test:unit] ${files.length} file in ${gruppi.length} gruppi: tutti insieme non stanno in una riga di comando di Windows.`);
  for (const [i, gruppo] of gruppi.entries()) {
    if (tanti) console.log(`\n[test:unit] gruppo ${i + 1} di ${gruppi.length} (${gruppo.length} file)`);
    // I test si aspettano la root come cartella corrente, come quando li lanciava npm.
    const r = spawnSync(process.execPath, ['--test', ...flags, ...gruppo], { stdio: 'inherit', cwd: REPO_ROOT });
    if (r.error) {
      console.error(`[test:unit] non sono riuscito a lanciare node${tanti ? ` per il gruppo ${i + 1}` : ''}: ${r.error.message}`);
      rossi.push(i + 1); esito = esito || 1;
      continue;
    }
    // Ucciso da un segnale (Ctrl+C, timeout): non è un successo, e i gruppi dopo non partono.
    if (r.status === null) { esito = 1; rossi.push(i + 1); interrotto = i + 1 < gruppi.length; break; }
    if (r.status !== 0) { rossi.push(i + 1); esito = esito || r.status; }
  }
  if (tanti) {
    console.log(rossi.length
      ? `\n[test:unit] ROSSO: ${rossi.length > 1 ? 'gruppi' : 'gruppo'} ${rossi.join(', ')} di ${gruppi.length}${interrotto ? ' (interrotto: i gruppi dopo non sono partiti)' : ''}. I test falliti sono nel riepilogo di ciascun gruppo, sopra.`
      : `\n[test:unit] verde: ${gruppi.length} gruppi, ${files.length} file.`);
  }
  // `exitCode` e non `exit()`, come sopra: l'ultima riga non deve perdersi.
  process.exitCode = esito;
}

// Solo se invocato come script, non quando importato dai test.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
