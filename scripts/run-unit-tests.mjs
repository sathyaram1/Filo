// Lanciatore degli unit test: trova da sé i *.test.mjs (un glob sul runner Node 20 non lo espande nessuno) e li passa a
// `node --test` relativi alla root e, se la riga supera il tetto di Windows, a gruppi con un riepilogo unico (#765).
// Zero file = uscita rossa. `--list` stampa i file; ogni altro argomento è un flag di `node --test`. Sentinella: tests/unit/unitRunner.test.mjs.

import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { lottiPerRigaDiComando, costoArgomentoWindows } from './lib/riga-di-comando.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Da QUESTO file, mai da dove è stato lanciato il comando. */
export const REPO_ROOT = resolve(__dirname, '..');

/** `FILO_UNIT_DIR` e `FILO_UNIT_TETTO_RIGA` esistono solo per i test di questo lanciatore, non sono opzioni d'uso. */
export const UNIT_DIR = process.env.FILO_UNIT_DIR
  ? resolve(process.env.FILO_UNIT_DIR)
  : resolve(REPO_ROOT, 'tests', 'unit');

// CreateProcess rifiuta righe oltre 32.767 caratteri (ENAMETOOLONG); il costo per argomento è già stimato per eccesso.
export const TETTO_WINDOWS = 32767;
export const TETTO_RIGA = Number(process.env.FILO_UNIT_TETTO_RIGA) || 30000;

// Relativo alla root, che è la cartella corrente del lancio: un percorso assoluto qui allungherebbe la riga.
const REPORTER_RIEPILOGO = './scripts/lib/riepilogo-unit.mjs';

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

// Da Node 21 `node --test` legge ogni argomento come un modello: un file con quadre o tonde nel nome non girava,
// e l'esito restava verde. Node 20 (il runner della pubblicazione) li prende alla lettera.
export const NODE_LEGGE_MODELLI = Number(process.versions.node.split('.')[0]) >= 21;

/** Il nome preso alla lettera dal modello: ogni carattere speciale chiuso fra quadre. PURA. */
export function allaLettera(arg) {
  return String(arg).replace(/[[\]()*?]/g, (c) => `[${c}]`);
}

/** Le graffe con virgola o `..` si espandono prima di tutto e non c'è modo di chiuderle: quel nome va cambiato. PURA. */
export function nomeNonLanciabile(arg) {
  return /\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(String(arg));
}

/** PURA. */
export function fileArgs(files, root = REPO_ROOT, { modelli = NODE_LEGGE_MODELLI } = {}) {
  return files.map((f) => (modelli ? allaLettera(perLaRiga(f, root)) : perLaRiga(f, root)));
}

/** I file di ogni `node --test`, a gruppi la cui riga intera (eseguibile e flag compresi) sta in `tetto`. PURA. */
export function gruppiDiLancio(files, { root = REPO_ROOT, flags = [], execPath = process.execPath, tetto = TETTO_RIGA, modelli = NODE_LEGGE_MODELLI } = {}) {
  const fisso = [execPath, '--test', ...flags].reduce((n, a) => n + costoArgomentoWindows(a), 0);
  return lottiPerRigaDiComando(fileArgs(files, root, { modelli }), tetto, { fisso, costo: costoArgomentoWindows });
}

const DESTINAZIONE = '--test-reporter-destination';

/**
 * Ogni destinazione su file dei flag dati sostituita da `copia(k)`: a gruppi ogni `node --test` riscriverebbe da capo
 * lo stesso file e resterebbe solo l'ultimo gruppo. `file` sono le destinazioni chieste, nell'ordine. PURA.
 */
export function destinazioniSuFile(flags, copia) {
  const out = [];
  const file = [];
  for (let i = 0; i < flags.length; i++) {
    const a = flags[i];
    const unito = a.startsWith(`${DESTINAZIONE}=`);
    if (!unito && !(a === DESTINAZIONE && i + 1 < flags.length)) { out.push(a); continue; }
    const valore = unito ? a.slice(DESTINAZIONE.length + 1) : flags[++i];
    if (valore === 'stdout' || valore === 'stderr') { out.push(`${DESTINAZIONE}=${valore}`); continue; }
    out.push(`${DESTINAZIONE}=${copia(file.length)}`);
    file.push(valore);
  }
  return { flags: out, file };
}

/** I rapporti dei gruppi in uno: dei junit resta un documento solo, gli altri formati si accodano. PURA. */
export function unisciRapporti(testi) {
  const junit = /^\s*(<\?xml[^>]*\?>)\s*<testsuites>([\s\S]*)<\/testsuites>\s*$/;
  const parti = testi.map((t) => String(t).match(junit));
  if (parti.length && parti.every(Boolean)) {
    return `${parti[0][1]}\n<testsuites>${parti.map((p) => p[2]).join('')}</testsuites>\n`;
  }
  return testi.join('');
}

/** `--watch` (anche `--watch-path`): il primo gruppo non finirebbe mai e gli altri non partirebbero. PURA. */
export function chiedeWatch(flags) {
  return flags.some((a) => a === '--watch' || a.startsWith('--watch=') || a.startsWith('--watch-path'));
}

/** La copertura si calcola per processo: a gruppi ne esce una per gruppo. PURA. */
export function chiedeCopertura(flags) {
  return flags.some((a) => a === '--experimental-test-coverage' || a.startsWith('--test-coverage'));
}

/**
 * I flag di un gruppo col reporter del riepilogo aggiunto su file, senza togliere a stdout quello che ci sarebbe
 * andato: dichiarare un reporter spegne quello predefinito (spec al terminale, tap altrove). `null` se nei flag
 * dati reporter e destinazioni sono in numero diverso: lì non si sa a chi tocchi stdout. PURA.
 */
export function flagsConRiepilogo(flags, destinazione, { tty = false } = {}) {
  const conta = (nome) => flags.filter((a) => a === nome || a.startsWith(`${nome}=`)).length;
  const reporter = conta('--test-reporter');
  const destinazioni = conta('--test-reporter-destination');
  if (destinazioni && destinazioni !== reporter) return null;
  const visibili = reporter
    ? [...flags, ...Array(reporter - destinazioni).fill('--test-reporter-destination=stdout')]
    : [`--test-reporter=${tty ? 'spec' : 'tap'}`, '--test-reporter-destination=stdout', ...flags];
  return [...visibili, `--test-reporter=${REPORTER_RIEPILOGO}`, `--test-reporter-destination=${destinazione}`];
}

/**
 * Somma le righe del reporter del riepilogo di tutti i gruppi, contando come il riepilogo di `node --test`. PURA.
 * Fra i rossi elencati: i test falliti e le suite cadute da sé (hook, corpo); non chi è rosso solo per un figlio.
 */
export function sommaRiepiloghi(gruppi) {
  const t = { test: 0, pass: 0, fail: 0, annullati: 0, saltati: 0, todo: 0, rossi: [] };
  gruppi.forEach((righe, i) => {
    for (const r of righe) {
      const rosso = { gruppo: i + 1, nome: r.nome, file: r.file, riga: r.riga };
      if (r.suite) {
        if (r.esito === 'fail' && r.causa !== 'subtestsFailed') t.rossi.push(rosso);
        continue;
      }
      t.test++;
      if (r.todo) t.todo++;
      else if (r.esito === 'pass') { if (r.skip) t.saltati++; else t.pass++; }
      else if (r.causa === 'cancelledByParent') t.annullati++;
      else { t.fail++; if (r.causa !== 'subtestsFailed') t.rossi.push(rosso); }
    }
  });
  return t;
}

/** Le righe finali di una suite a gruppi: conti di tutti i gruppi, rossi uno per riga, verdetto. PURA. */
export function testoRiepilogo({ somma, gruppi, file, esiti, interrotto = false, root = REPO_ROOT, rapporti = [], copertura = false }) {
  // somma null: coi flag dati il reporter del riepilogo non si poteva aggiungere, restano i verdetti dei gruppi.
  const n = esiti.length;
  const rossiGruppi = esiti.map((e, i) => (e === 0 ? 0 : i + 1)).filter(Boolean);
  const extra = !somma ? '' : [['annullati', somma.annullati], ['saltati', somma.saltati], ['da fare', somma.todo]]
    .filter(([, v]) => v).map(([k, v]) => `, ${v} ${k}`).join('');
  const out = ['', somma
    ? `[test:unit] riepilogo di ${gruppi} gruppi, ${file} file: ${somma.test} test, ${somma.pass} passati, ${somma.fail} falliti${extra}.`
    : `[test:unit] ${gruppi} gruppi, ${file} file: i conti e i test rossi sono nel riepilogo di ciascun gruppo, sopra.`];
  if (somma && somma.rossi.length) {
    out.push(`[test:unit] test rossi (${somma.rossi.length}):`);
    for (const r of somma.rossi) {
      const dove = r.file ? `${perLaRiga(r.file, root)}${r.riga ? `:${r.riga}` : ''}` : '?';
      // Un file che non si carica è un test col nome del file: ripeterlo non dice niente.
      const soloFile = r.file && resolve(root, String(r.nome)) === resolve(r.file);
      out.push(`  ✖ ${dove}${soloFile ? '' : `  ${r.nome}`}  (gruppo ${r.gruppo})`);
    }
  }
  const muti = rossiGruppi.filter((g) => !somma || !somma.rossi.some((r) => r.gruppo === g));
  const dove = rapporti.length ? `sopra o nel rapporto in ${rapporti.join(', ')}` : 'sopra';
  if (somma && muti.length) {
    out.push(muti.length > 1
      ? `[test:unit] i gruppi ${muti.join(', ')} sono usciti rossi senza un test rosso registrato: la causa è nella loro uscita, ${dove}.`
      : `[test:unit] il gruppo ${muti[0]} è uscito rosso senza un test rosso registrato: la causa è nella sua uscita, ${dove}.`);
  }
  if (rapporti.length) out.push(`[test:unit] i rapporti dei ${gruppi} gruppi sono riuniti in ${rapporti.join(', ')}.`);
  if (copertura) out.push(`[test:unit] la copertura qui sopra è per gruppo: ${gruppi} conti, ciascuno sui soli file del suo gruppo, nessuno sulla suite intera.`);
  if (interrotto) out.push(`[test:unit] interrotto al gruppo ${n} di ${gruppi}: i gruppi dopo non sono partiti.`);
  out.push(rossiGruppi.length || interrotto
    ? `[test:unit] ROSSO: ${rossiGruppi.length > 1 ? 'gruppi' : 'gruppo'} ${rossiGruppi.join(', ')} di ${gruppi}.`
    : `[test:unit] verde: ${gruppi} gruppi, ${file} file.`);
  return out.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

// Il testo nostro aspetta di essere scritto prima che parta il figlio: con stdout asincrono (TTY su Windows) i
// titoli dei gruppi finirebbero sotto l'uscita del gruppo stesso.
const scrivi = (s) => new Promise((ok) => process.stdout.write(`${s}\n`, ok));
const lancia = (args) => new Promise((ok) => {
  // I test si aspettano la root come cartella corrente, come quando li lanciava npm.
  // Le manopole di questo lanciatore non arrivano ai test: la sua sentinella guarda i valori veri.
  const { FILO_UNIT_DIR: _d, FILO_UNIT_TETTO_RIGA: _t, ...env } = process.env;
  const c = spawn(process.execPath, args, { stdio: 'inherit', cwd: REPO_ROOT, env });
  c.on('error', (error) => ok({ error }));
  c.on('close', (status, signal) => ok({ status, signal }));
});

function leggiRighe(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)]; } catch (_) { return []; }
    });
  } catch (_) { return []; }
}

async function main() {
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

  // I gruppi si contano coi flag del riepilogo già dentro: sono i più lunghi che la riga potrà portare.
  const cartella = mkdtempSync(join(tmpdir(), 'filo-unit-'));
  const destinazione = (i) => join(cartella, `gruppo-${String(i + 1).padStart(4, '0')}.jsonl`);
  const flagsGruppo = (i) => flagsConRiepilogo(flags, destinazione(i), { tty: !!process.stdout.isTTY });
  const gruppi = gruppiDiLancio(files, { flags: flagsGruppo(0) || flags });
  const tanti = gruppi.length > 1;

  try {
    if (!tanti) {
      // Un gruppo solo: l'uscita è quella di un `node --test` qualunque, riepilogo compreso.
      const r = await lancia(['--test', ...flags, ...gruppi[0]]);
      if (r.error) console.error(`[test:unit] non sono riuscito a lanciare node: ${r.error.message}`);
      // Ucciso da un segnale: non è un successo, e `status` in quel caso è null.
      process.exitCode = r.error || r.status === null ? 1 : r.status;
      return;
    }

    await scrivi(`[test:unit] ${files.length} file in ${gruppi.length} gruppi: tutti insieme non stanno in una riga di comando di Windows.`);
    const esiti = [];
    let interrotto = false;
    for (const [i, gruppo] of gruppi.entries()) {
      await scrivi(`\n[test:unit] gruppo ${i + 1} di ${gruppi.length} (${gruppo.length} file)`);
      const r = await lancia(['--test', ...(flagsGruppo(i) || flags), ...gruppo]);
      if (r.error) {
        console.error(`[test:unit] non sono riuscito a lanciare node per il gruppo ${i + 1}: ${r.error.message}`);
        esiti.push(1);
        continue;
      }
      // Ucciso da un segnale (Ctrl+C, timeout): non è un successo, e i gruppi dopo non partono.
      if (r.status === null) { esiti.push(1); interrotto = i + 1 < gruppi.length; break; }
      esiti.push(r.status);
    }
    const somma = flagsGruppo(0) ? sommaRiepiloghi(esiti.map((_, i) => leggiRighe(destinazione(i)))) : null;
    await scrivi(testoRiepilogo({ somma, gruppi: gruppi.length, file: files.length, esiti, interrotto }));
    // `exitCode` e non `exit()`, come sopra: l'ultima riga non deve perdersi.
    process.exitCode = esiti.find((e) => e !== 0) ?? 0;
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}

// Solo se invocato come script, non quando importato dai test.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
