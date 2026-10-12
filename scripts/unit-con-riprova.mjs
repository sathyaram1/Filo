// Gli unit test di un cancello su Windows (suite.yml, release.yml): tutti, poi i soli file rossi rifatti una volta, come
// la riprova sulla fusione (#1063). Un file che ripassa è un flaky: verde, ma detto. Il registro tiene i rossi rimasti.
// Sentinella: tests/unit/unitConRiprova.test.mjs.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chiaviDelRegistroUnit } from './build-alarm.mjs';
import { SOLO } from './run-unit-tests.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LANCIATORE = resolve(RADICE, 'scripts', 'run-unit-tests.mjs');

/** I file di test rossi di un registro TAP, relativi a `radice`; [] se nessuno è riconoscibile. PURA. */
export function fileRossi(registro, radice) {
  return chiaviDelRegistroUnit(registro, radice).filter((k) => k.startsWith('unit:')).map((k) => k.slice(5));
}

/** Rossi della prima corsa che nella riprova sono passati. PURA. */
export function ripassati(primaCorsa, riprova) {
  const ancora = new Set(riprova);
  return primaCorsa.filter((f) => !ancora.has(f));
}

/** Lancia il lanciatore degli unit, con l'uscita sia qui sia nel registro; torna codice e testo. */
function corsa(argomenti, registro) {
  return new Promise((ok) => {
    const file = createWriteStream(registro);
    let testo = '';
    const c = spawn(process.execPath, [LANCIATORE, ...argomenti], { cwd: RADICE, stdio: ['ignore', 'pipe', 'pipe'] });
    const passa = (verso) => (pezzo) => { verso.write(pezzo); file.write(pezzo); testo += pezzo; };
    c.stdout.on('data', passa(process.stdout));
    c.stderr.on('data', passa(process.stderr));
    c.on('error', (e) => { testo += `\n${e.message}\n`; });
    c.on('close', (codice) => file.end(() => ok({ codice: codice ?? 1, testo })));
  });
}

async function main() {
  const i = process.argv.indexOf('--registro');
  const registro = resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'unit.log');
  const prima = await corsa([], registro.replace(/(\.\w+)?$/, '-prima$1'));
  if (prima.codice === 0) {
    await corsa([SOLO, '--list', ...[]], registro).catch(() => {});
    return;
  }
  const rossi = fileRossi(prima.testo, RADICE);
  if (!rossi.length) {
    // Rosso senza un file da rifare (un lancio fallito, un tetto di tempo): niente riprova, il registro è la corsa intera.
    createWriteStream(registro).end(prima.testo);
    process.exitCode = 1;
    return;
  }
  console.log(`\n[unit] riprova dei soli file rossi, una volta: ${rossi.join(', ')}`);
  const riprova = await corsa([SOLO, ...rossi], registro);
  const flaky = ripassati(rossi, riprova.codice === 0 ? [] : fileRossi(riprova.testo, RADICE));
  if (flaky.length) console.log(`::warning::unit test rossi alla prima corsa e verdi alla riprova (flaky su Windows): ${flaky.join(', ')}`);
  process.exitCode = riprova.codice;
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();
