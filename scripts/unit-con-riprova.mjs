// Gli unit test di un cancello su Windows (suite.yml, release.yml): tutti, poi i soli file rossi rifatti una volta, come
// la riprova sulla fusione (#1063). Un file che ripassa è un flaky: verde, ma detto. Il registro tiene i rossi rimasti.
// Sentinella: tests/unit/unitConRiprova.test.mjs.

import { spawn } from 'node:child_process';
import { createWriteStream, writeFileSync } from 'node:fs';
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

/**
 * Perché la prima corsa non ha detto tutto ('' se l'ha detto): un file appeso, un gruppo interrotto o rosso senza
 * colpevole, node non partito, un riepilogo mancante. Lì i rossi con un file non sono tutti i rossi, e rifare solo
 * quelli scagionerebbe test mai riportati (#1184). Le frasi sono quelle del lanciatore: la sentinella le prende da lui. PURA.
 */
export function corsaIncompleta(registro) {
  const testo = String(registro || '');
  // Solo nei messaggi del lanciatore: il titolo di un test che cita la frase toglieva la riprova a tutta la corsa
  // (#1457). Niente ancora a inizio riga: stdout e stderr arrivano mischiati, e un messaggio può cadere a metà riga.
  const dice = (frase) => new RegExp(`\\[test:unit\\] [^\\n]*${frase}`).test(testo);
  if (dice('la corsa è stata chiusa')) return 'un file non è andato avanti e la corsa è stata chiusa';
  if (dice('interrotto al gruppo')) return 'la corsa è stata interrotta a metà';
  if (dice('ross[oi] senza un test rosso registrato')) return 'un gruppo è uscito rosso senza un test rosso registrato';
  if (dice('non sono riuscito a lanciare node')) return 'node non è partito';
  const gruppi = testo.match(/^\[test:unit\] gruppo \d+ di \d+/gm)?.length || 1;
  const riepiloghi = testo.match(/^# fail \d+/gm)?.length || 0;
  return riepiloghi < gruppi ? 'manca il riepilogo di node: la corsa non è arrivata in fondo' : '';
}

/**
 * I rossi della prima corsa passati alla riprova. Una riprova rossa senza file riconoscibili (lancio fallito, tetto
 * di tempo) non scagiona nessuno. PURA.
 */
export function ripassati(rossi, { codice, rossiRiprova }) {
  if (codice !== 0 && !rossiRiprova.length) return [];
  const ancora = new Set(rossiRiprova);
  return rossi.filter((f) => !ancora.has(f));
}

/** Il lanciatore degli unit, con l'uscita sia qui sia nel registro. */
function corsa(argomenti, registro, lanciatore = LANCIATORE) {
  return new Promise((ok) => {
    const file = createWriteStream(registro);
    let testo = '';
    const c = spawn(process.execPath, [lanciatore, ...argomenti], { cwd: RADICE, stdio: ['ignore', 'pipe', 'pipe'] });
    const passa = (verso) => (pezzo) => { verso.write(pezzo); file.write(pezzo); testo += pezzo; };
    c.stdout.on('data', passa(process.stdout));
    c.stderr.on('data', passa(process.stderr));
    c.on('error', (e) => { testo += `\n${e.message}\n`; });
    c.on('close', (codice) => file.end(() => ok({ codice: codice ?? 1, testo })));
  });
}

/** `FILO_UNIT_LANCIATORE` esiste solo per la sentinella: un lanciatore finto al posto della suite intera. */
export async function unitConRiprova(registro, { lanciatore = process.env.FILO_UNIT_LANCIATORE || LANCIATORE } = {}) {
  const prima = await corsa([], registro, lanciatore);
  if (prima.codice === 0) return { codice: 0, rossi: [], flaky: [] };
  const rossi = fileRossi(prima.testo, RADICE);
  if (!rossi.length) return { codice: prima.codice, rossi: [], flaky: [] };
  const incompleta = corsaIncompleta(prima.testo);
  if (incompleta) {
    console.log(`\n[unit] nessuna riprova: ${incompleta}, quindi i file rossi non sono tutti i rossi.`);
    return { codice: prima.codice || 1, rossi, flaky: [] };
  }
  // La prima corsa resta accanto al registro; il registro, che l'allarme legge, tiene solo i rossi rimasti.
  writeFileSync(registro.replace(/(\.\w+)?$/, '-prima$1'), prima.testo);
  console.log(`\n[unit] riprova dei soli file rossi, una volta: ${rossi.join(', ')}`);
  const riprova = await corsa([SOLO, ...rossi], registro, lanciatore);
  const rossiRiprova = fileRossi(riprova.testo, RADICE);
  return { codice: riprova.codice, rossi: riprova.codice === 0 ? [] : rossiRiprova, flaky: ripassati(rossi, { codice: riprova.codice, rossiRiprova }) };
}

async function main() {
  const i = process.argv.indexOf('--registro');
  const registro = resolve(i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'unit.log');
  const esito = await unitConRiprova(registro);
  if (esito.flaky.length) {
    console.log(`::warning::unit test rossi alla prima corsa e verdi alla riprova (flaky su Windows): ${esito.flaky.join(', ')}`);
  }
  process.exitCode = esito.codice;
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();
