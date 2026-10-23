// Lanciatore degli unit test: trova da sé i *.test.mjs (un glob sul runner Node 20 non lo espande nessuno) e li passa a
// `node --test` relativi alla root e, se la riga supera il tetto di Windows, a gruppi con un riepilogo unico (#765).
// Zero file = uscita rossa. `--list` stampa i file, `--solo` fa girare solo i file dati; ogni altro argomento è un flag di `node --test` o un file in più. Sentinella: tests/unit/unitRunner.test.mjs.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path, { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { lottiPerRigaDiComando, costoArgomentoWindows } from './lib/riga-di-comando.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Da QUESTO file, mai da dove è stato lanciato il comando. */
export const REPO_ROOT = resolve(__dirname, '..');

/** `FILO_UNIT_DIR`, `FILO_UNIT_TETTO_RIGA` e `FILO_UNIT_TETTO_FERMO_MS` esistono solo per i test di questo lanciatore. */
export const UNIT_DIR = process.env.FILO_UNIT_DIR
  ? resolve(process.env.FILO_UNIT_DIR)
  : resolve(REPO_ROOT, 'tests', 'unit');

// CreateProcess rifiuta righe oltre 32.767 caratteri (ENAMETOOLONG); il costo per argomento è già stimato per eccesso.
export const TETTO_WINDOWS = 32767;
export const TETTO_RIGA = Number(process.env.FILO_UNIT_TETTO_RIGA) || 30000;

// Relativi alla root, che è la cartella corrente del lancio: un percorso assoluto qui allungherebbe la riga.
const REPORTER_RIEPILOGO = './scripts/lib/riepilogo-unit.mjs';
const REPORTER_AVANZAMENTO = './scripts/lib/avanzamento-unit.mjs';

/** Solo i file dati, con la stessa guardia della corsa intera: la riprova dei rossi sulla fusione (#1063). */
export const SOLO = '--solo';

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
 * gli argomenti di `--test` come glob. Un file fuori dalla root resta assoluto. `p`: i percorsi del sistema, o
 * quelli dell'altra piattaforma scelti da una prova. PURA.
 */
export function perLaRiga(file, root = REPO_ROOT, p = path) {
  const r = p.relative(root, file);
  if (!r || r === '..' || r.startsWith(`..${p.sep}`) || p.isAbsolute(r)) return file;
  return r.split(p.sep).join('/');
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
export function gruppiDiLancio(files, { root = REPO_ROOT, flags = [], execPath = process.execPath, tetto = TETTO_RIGA, modelli = NODE_LEGGE_MODELLI, extra = [] } = {}) {
  const fisso = [execPath, '--test', ...flags].reduce((n, a) => n + costoArgomentoWindows(a), 0);
  return lottiPerRigaDiComando([...fileArgs(files, root, { modelli }), ...extra], tetto, { fisso, costo: costoArgomentoWindows });
}

// Le opzioni di node che prendono il valore nell'argomento dopo: quel valore non è un file di prova.
const CON_VALORE = new Set([
  '--test-reporter', '--test-reporter-destination', '--test-name-pattern', '--test-skip-pattern', '--test-concurrency',
  '--test-timeout', '--test-shard', '--test-coverage-include', '--test-coverage-exclude', '--test-coverage-lines',
  '--test-coverage-branches', '--test-coverage-functions', '--test-global-setup', '--test-isolation',
  '--experimental-test-isolation', '--import', '--require', '-r', '--loader', '--experimental-loader', '--watch-path',
  '--conditions', '-C', '--env-file', '--env-file-if-exists', '--input-type', '--disable-warning',
]);

/**
 * Le opzioni da una parte, i file o modelli dati a mano dall'altra: a gruppi un file fra le opzioni girerebbe in ogni
 * gruppo, e node smette di leggere le opzioni che lo seguono. PURA.
 */
export function separaArgomenti(args) {
  const opzioni = [];
  const posizionali = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (!a.startsWith('-')) { posizionali.push(a); continue; }
    opzioni.push(a);
    if (CON_VALORE.has(a) && i + 1 < args.length) opzioni.push(args[++i]);
  }
  return { opzioni, posizionali };
}

const REPORTER = '--test-reporter';
const DESTINAZIONE = '--test-reporter-destination';
// Un documento intero: a gruppi, su stdout ne uscirebbe uno per gruppo e il tutto non si leggerebbe più.
const DOCUMENTI = new Set(['junit', 'lcov']);

/**
 * Le destinazioni da riunire sostituite da `copia(k)`: i file, che ogni `node --test` riscriverebbe da capo lasciando
 * solo l'ultimo gruppo, e i documenti su stdout. `rapporti` sono le destinazioni chieste, nell'ordine. `accodati` quelle
 * di un formato che non si sa riunire: ci finisce un rapporto per gruppo, e il riepilogo lo deve dire. PURA.
 */
export function rapportiDaRiunire(flags, copia) {
  const reporter = [];
  const destinazioni = [];
  const resto = [];
  for (let i = 0; i < flags.length; i++) {
    const a = flags[i];
    const lista = a === REPORTER || a.startsWith(`${REPORTER}=`) ? reporter
      : a === DESTINAZIONE || a.startsWith(`${DESTINAZIONE}=`) ? destinazioni : null;
    const nome = lista === reporter ? REPORTER : DESTINAZIONE;
    if (!lista || (a === nome && i + 1 >= flags.length)) { resto.push(a); continue; }
    lista.push(a === nome ? flags[++i] : a.slice(nome.length + 1));
  }
  // Come node: un reporter senza destinazione va su stdout; con numeri diversi è node a rifiutare, e i flag restano.
  if (!destinazioni.length && reporter.length === 1) destinazioni.push('stdout');
  if (destinazioni.length !== reporter.length) return { flags, rapporti: [], accodati: [] };
  const rapporti = [];
  const accodati = [];
  const coppie = reporter.flatMap((r, k) => {
    const d = destinazioni[k];
    const daRiunire = d === 'stdout' ? DOCUMENTI.has(r) : d !== 'stderr';
    if (daRiunire) rapporti.push(d);
    if (!DOCUMENTI.has(r)) accodati.push(d);
    return [`${REPORTER}=${r}`, `${DESTINAZIONE}=${daRiunire ? copia(rapporti.length - 1) : d}`];
  });
  return { flags: [...resto, ...coppie], rapporti, accodati };
}

/** Dove sta un rapporto, detto in una frase. PURA. */
export function doveRapporto(d) {
  return d === 'stdout' ? "sull'uscita standard" : d === 'stderr' ? "sull'uscita degli errori" : `in ${d}`;
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
 * I flag con un reporter nostro aggiunto su file, senza togliere a stdout quello che ci sarebbe andato: dichiarare un
 * reporter spegne quello predefinito (spec al terminale, tap altrove). `null` se nei flag dati reporter e
 * destinazioni sono in numero diverso: lì non si sa a chi tocchi stdout. PURA.
 */
export function flagsConReporter(flags, nostro, destinazione, { tty = false } = {}) {
  const conta = (nome) => flags.filter((a) => a === nome || a.startsWith(`${nome}=`)).length;
  const reporter = conta('--test-reporter');
  const destinazioni = conta('--test-reporter-destination');
  if (destinazioni && destinazioni !== reporter) return null;
  const visibili = reporter
    ? [...flags, ...Array(reporter - destinazioni).fill('--test-reporter-destination=stdout')]
    : [`--test-reporter=${tty ? 'spec' : 'tap'}`, '--test-reporter-destination=stdout', ...flags];
  return [...visibili, `--test-reporter=${nostro}`, `--test-reporter-destination=${destinazione}`];
}

/** I flag di un gruppo col riepilogo che somma i gruppi. PURA. */
export function flagsConRiepilogo(flags, destinazione, opzioni) {
  return flagsConReporter(flags, REPORTER_RIEPILOGO, destinazione, opzioni);
}

/** I flag col reporter che dice al lanciatore se la corsa va avanti. PURA. */
export function flagsConAvanzamento(flags, destinazione, opzioni) {
  return flagsConReporter(flags, REPORTER_AVANZAMENTO, destinazione, opzioni);
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
export function testoRiepilogo({ somma, gruppi, file, esiti, interrotto = false, root = REPO_ROOT, rapporti = [], accodati = [], rapportiPersi = [], copertura = false }) {
  // somma null: coi flag dati il reporter del riepilogo non si poteva aggiungere, restano i verdetti dei gruppi.
  const n = esiti.length;
  const rossiGruppi = esiti.map((e, i) => (e === 0 ? 0 : i + 1)).filter(Boolean);
  const conta = (v, uno, tanti) => `${v} ${v === 1 ? uno : tanti}`;
  const extra = !somma ? '' : [['annullato', 'annullati', somma.annullati], ['saltato', 'saltati', somma.saltati], ['da fare', 'da fare', somma.todo]]
    .filter(([, , v]) => v).map(([uno, tanti, v]) => `, ${conta(v, uno, tanti)}`).join('');
  const out = ['', somma
    ? `[test:unit] riepilogo di ${gruppi} gruppi, ${file} file: ${somma.test} test, ${conta(somma.pass, 'passato', 'passati')}, ${conta(somma.fail, 'fallito', 'falliti')}${extra}.`
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
  const scritti = rapporti.filter((d) => !rapportiPersi.includes(d));
  const dove = scritti.length ? `sopra o nel rapporto ${scritti.map(doveRapporto).join(', ')}` : 'sopra';
  if (somma && muti.length) {
    out.push(muti.length > 1
      ? `[test:unit] i gruppi ${muti.join(', ')} sono usciti rossi senza un test rosso registrato: la causa è nella loro uscita, ${dove}.`
      : `[test:unit] il gruppo ${muti[0]} è uscito rosso senza un test rosso registrato: la causa è nella sua uscita, ${dove}.`);
  }
  const riuniti = scritti.filter((d) => !accodati.includes(d));
  if (riuniti.length) out.push(`[test:unit] i rapporti di tutti i gruppi sono riuniti ${riuniti.map(doveRapporto).join(', ')}.`);
  for (const d of accodati.filter((x) => !rapportiPersi.includes(x))) {
    out.push(`[test:unit] ${doveRapporto(d)} c'è un rapporto per gruppo, uno dopo l'altro: i conti di tutta la suite sono in questo riepilogo.`);
  }
  for (const d of rapportiPersi) out.push(`[test:unit] il rapporto chiesto ${doveRapporto(d)} non è stato scritto: il motivo è sopra.`);
  if (copertura) out.push(`[test:unit] la copertura è per gruppo: ${gruppi} conti, ciascuno sui soli file del suo gruppo, nessuno sulla suite intera.`);
  if (interrotto) out.push(`[test:unit] interrotto al gruppo ${n} di ${gruppi}: i gruppi dopo non sono partiti.`);
  const perche = [
    rossiGruppi.length && `${rossiGruppi.length > 1 ? 'gruppi' : 'gruppo'} ${rossiGruppi.join(', ')} di ${gruppi}`,
    !rossiGruppi.length && interrotto && `interrotto al gruppo ${n} di ${gruppi}`,
    rapportiPersi.length && `${rapportiPersi.length > 1 ? 'rapporti non scritti' : 'rapporto non scritto'}`,
  ].filter(Boolean);
  out.push(perche.length ? `[test:unit] ROSSO: ${perche.join('; ')}.` : `[test:unit] verde: ${gruppi} gruppi, ${file} file.`);
  return out.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

// Il testo nostro aspetta di essere scritto prima che parta il figlio: con stdout asincrono (TTY su Windows) i
// titoli dei gruppi finirebbero sotto l'uscita del gruppo stesso.
let canale = process.stdout;
const scrivi = (s) => new Promise((ok) => canale.write(`${s}\n`, ok));

function leggiTesto(file) {
  try { return readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

function righeJson(testo) {
  return testo.split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch (_) { return []; }
  });
}

function leggiRighe(file) {
  try { return righeJson(readFileSync(file, 'utf8')); } catch (_) { return []; }
}

// Il codice provato scrive nella temporanea anche senza chiederla ai test (#717): ogni corsa gliene dà una sua, che se ne
// va con la corsa, e i resti delle corse uccise li toglie chi la crea. Le regole stanno col modulo che le crea, importato
// qui e non in testa perché la copia di questo lanciatore che vive fuori dal repo non ha i test.
// Sentinella: tests/unit/cartelleTemporaneeSiTolgono.test.mjs.
async function temporaneaDellaCorsa() {
  const modulo = join(REPO_ROOT, 'tests', 'helpers', 'percorsi.mjs');
  return existsSync(modulo) ? (await import(pathToFileURL(modulo).href)).temporaneaDellaCorsa() : null;
}

// Un file appeso (col disco pieno, #717; un pacchetto mancante, #1231) è un rosso col suo nome: si chiude lui e la corsa
// va avanti. Il tetto conta il tempo in cui il file non va avanti, non la sua durata: sotto carico un file sano è lento
// ma avanza (#1063).
export const TETTO_FERMO_MS = Number(process.env.FILO_UNIT_TETTO_FERMO_MS) || 20 * 60 * 1000;
const controlloPer = (tetto) => Math.min(5000, Math.max(100, Math.floor(tetto / 20)));

/** Il tetto di node, che conta la durata del file: solo dove il lanciatore non può guardare l'avanzamento. PURA. */
export function conTettoDiTempo(opzioni) {
  return opzioni.some((a) => a === '--test-timeout' || String(a).startsWith('--test-timeout='))
    ? opzioni : [`--test-timeout=${TETTO_FERMO_MS}`, ...opzioni];
}

/**
 * Un worker in parallelo (#1157) prende la sua parte di CPU: N `node --test` a tutte le CPU insieme fanno rossi i test
 * sensibili ai tempi. `n` = file insieme (0 = decide node); chi lancia con un `--test-concurrency` suo decide lui. PURA.
 */
export function conConcorrenza(opzioni, n = 0) {
  if (opzioni.some((a) => a === '--test-concurrency' || String(a).startsWith('--test-concurrency='))) return opzioni;
  return n > 0 ? [`--test-concurrency=${n}`, ...opzioni] : opzioni;
}

// Importato qui e non in testa per la stessa ragione di temporaneaDellaCorsa: le copie di questo lanciatore che
// portano con sé solo i suoi file (le prove di unit-sulla-fusione) non hanno il modulo, e lì vale node.
async function concorrenzaDelWorker() {
  const modulo = join(__dirname, 'lib', 'dati-worker.mjs');
  if (!existsSync(modulo)) return 0;
  const { datiWorker, concorrenzaUnit } = await import(pathToFileURL(modulo).href);
  const w = datiWorker({ root: REPO_ROOT });
  return w ? concorrenzaUnit(w.paralleli) : 0;
}

/**
 * I file partiti e non finiti, nell'ordine di partenza. Node scrive l'esito dei file in quell'ordine: il primo è quello
 * che tiene ferma l'uscita, gli altri aspettano lui. PURA.
 */
export function fileInCorso(righe) {
  const finiti = new Set(righe.filter((r) => r.fine).map((r) => r.fine));
  return righe.filter((r) => r.via && !finiti.has(r.via)).map((r) => r.via);
}

/**
 * Dice, a ogni sguardo sul file dell'avanzamento, se la corsa è ferma da oltre il tetto. Il tempo parte dal primo
 * evento: prima node sta ancora partendo, e su una macchina carica partire è lento ma non è un file appeso. PURA.
 */
export function guardiaFermo(tetto = TETTO_FERMO_MS) {
  let visto = 0;
  let dal = null;
  return (dimensione, ora) => {
    if (dimensione !== visto) { visto = dimensione; dal = ora; return false; }
    return dal !== null && ora - dal >= tetto;
  };
}

/**
 * Il tetto per file. Node lascia passare in diretta solo i passi del primo file partito e non finito (degli altri dice
 * solo quando partono e finiscono): l'avanzamento che si vede è il suo. Riceve le righe nuove del reporter
 * dell'avanzamento e dice `{ file }`, i file da chiudere, o `{ tutto: true }`, la corsa da chiudere. PURA.
 * - Il primo si chiude dopo un tetto senza un suo passo.
 * - Se nello stesso tetto non è finito nessun file, con lui si chiudono i partiti da almeno un tetto: in fila dietro
 *   di lui costerebbero un tetto ciascuno (#1231).
 * - Se dopo una chiusura non finisce più nessun file per un altro tetto, è ferma la corsa (il disco pieno, #717), o
 *   chiudere non è servito: ma solo se il fermo è un chiuso o è partito qualcosa dopo. Altrimenti la corsa sta finendo
 *   e il fermo è un altro appeso di prima, che si chiude da solo: chiusa la corsa, gli esiti dietro di lui sparivano (#1235).
 * - `.sospetti()`: i chiusi dopo i quali nessun file è finito da sé. Chiusa la corsa senza file in corso, sono loro
 *   che la tenevano ferma, e l'avviso li nomina (#1573).
 */
export function guardiaPerFile(tetto = TETTO_FERMO_MS) {
  const partenza = new Map();
  const finiti = new Set();
  const chiusi = new Set();
  let primo = null;
  let dal = null;
  let ultimaFine = null;
  let chiusiSenzaFine = false;
  let partitiAllaChiusura = 0;
  let sospetti = [];
  const giudica = (righe, ora) => {
    for (const r of righe) {
      if (r.via) { if (!partenza.has(r.via)) partenza.set(r.via, ora); }
      else if (r.fine) {
        finiti.add(r.fine);
        if (!chiusi.has(r.fine)) { ultimaFine = ora; chiusiSenzaFine = false; }
      } else dal = ora;
    }
    const inCorso = [...partenza.keys()].filter((f) => !finiti.has(f));
    const adesso = inCorso[0] ?? null;
    if (adesso !== primo) { primo = adesso; dal = ora; }
    if (primo === null || ora - dal < tetto) return null;
    dal = ora;
    if (chiusiSenzaFine && (chiusi.has(primo) || partenza.size > partitiAllaChiusura)) return { tutto: true };
    const muta = ultimaFine === null || ora - ultimaFine >= tetto;
    const file = muta ? inCorso.filter((f) => f === primo || ora - partenza.get(f) >= tetto) : [primo];
    for (const f of file) chiusi.add(f);
    sospetti = chiusiSenzaFine ? [...sospetti, ...file] : file;
    chiusiSenzaFine = true;
    partitiAllaChiusura = partenza.size;
    return { file };
  };
  giudica.sospetti = () => (chiusiSenzaFine ? [...sospetti] : []);
  return giudica;
}

/** Un lavoro fisso per il processore: quanto ci mette dice quanto la macchina è carica adesso. */
export function misuraLavoro() {
  const t = performance.now();
  let x = 0;
  for (let i = 0; i < 2e6; i++) x += Math.sqrt(i);
  return performance.now() - t + (x < 0 ? 1 : 0);
}

/**
 * Un orologio che va alla velocità della macchina: il tempo passato si divide per quanto il lavoro fisso è più lento
 * del più veloce visto. Sulla macchina carica un file sano rallenta con lei, uno appeso no (#1063). PURA salvo `misura`.
 */
export function orologioMacchina({ misura = misuraLavoro, ora = () => performance.now() } = {}) {
  let migliore = Infinity;
  let prima = null;
  let tempo = 0;
  return () => {
    const d = Math.max(misura(), 1e-3);
    migliore = Math.min(migliore, d);
    const adesso = ora();
    if (prima !== null) tempo += (adesso - prima) / (d / migliore);
    prima = adesso;
    return tempo;
  };
}

/** PURA. */
function durataDetta(ms) {
  const minuti = Math.round(ms / 60000);
  return minuti >= 1 ? `${minuti} minut${minuti === 1 ? 'o' : 'i'}` : `${Math.round(ms / 1000)} secondi`;
}

/** PURA. */
export function testoFermo(inCorso, fermoMs, root = REPO_ROOT) {
  const tempo = durataDetta(fermoMs);
  if (!inCorso.length) return `[test:unit] ROSSO: per ${tempo} non è andato avanti niente, e la corsa è stata chiusa.`;
  const [fermo, ...altri] = inCorso.map((f) => perLaRiga(f, root));
  const righe = [`[test:unit] ROSSO: ${fermo} non è andato avanti per ${tempo}, e la corsa è stata chiusa.`];
  if (altri.length) righe.push(`[test:unit] chiusi insieme, senza esito: ${altri.join(', ')}.`);
  return righe.join('\n');
}

/** I file chiusi dal tetto per file, uno per riga; la corsa intanto è andata avanti. PURA. */
export function testoFileChiusi(chiusi, fermoMs, root = REPO_ROOT) {
  const tempo = durataDetta(fermoMs);
  return chiusi.map((f) => `[test:unit] ROSSO: ${perLaRiga(f, root)} non è andato avanti per ${tempo} ed è stato chiuso; gli altri file sono andati avanti.`).join('\n');
}

function chiudiAlbero(c) {
  // Chiuso da solo, il genitore di node --test lascerebbe vivi i figli appesi: va tolto l'albero intero.
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    // node --test chiude i suoi figli al SIGTERM; il SIGKILL resta per un genitore che non risponde più.
    c.kill('SIGTERM');
    setTimeout(() => { try { c.kill('SIGKILL'); } catch (_) { /* già uscito */ } }, 30_000).unref();
  }
}

/** Le righe «pid ppid riga di comando» dell'elenco dei processi, in { pid, ppid, riga }. PURA. */
export function leggiProcessi(testo) {
  return String(testo || '').split(/\r?\n/).flatMap((l) => {
    const m = l.match(/^\s*(\d+)\s+(\d+)(?:\s(.*))?$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), riga: m[3] || '' }] : [];
  });
}

/**
 * I processi da chiudere per fermare `file`: il figlio di `padre` (il `node --test`) che lo esegue, riconosciuto dal
 * percorso intero sulla sua riga di comando, e i suoi discendenti. Coi percorsi di Windows barre e maiuscole non
 * contano. PURA.
 */
export function processiDelFile(lista, padre, file, { root = REPO_ROOT, p = path } = {}) {
  const win = p.sep === '\\';
  const norma = (s) => (win ? String(s).replace(/\\/g, '/').toLowerCase() : String(s));
  const nomi = [...new Set([file, perLaRiga(file, root, p)])].map(norma);
  const nomina = (riga) => {
    const r = norma(riga);
    return nomi.some((n) => {
      for (let i = r.indexOf(n); i !== -1; i = r.indexOf(n, i + 1)) {
        const fine = i + n.length;
        if ((i === 0 || ' "\'/'.includes(r[i - 1])) && (fine === r.length || ' "\''.includes(r[fine]))) return true;
      }
      return false;
    });
  };
  const out = [];
  const coda = lista.filter((x) => x.ppid === padre && nomina(x.riga)).map((x) => x.pid);
  while (coda.length) {
    const pid = coda.shift();
    if (out.includes(pid)) continue;
    out.push(pid);
    for (const x of lista) if (x.ppid === pid) coda.push(x.pid);
  }
  return out;
}

/** Chiude il solo processo che esegue `file`, coi suoi figli: node lo dà rosso e va avanti. false se non l'ha chiuso. */
function chiudiFile(c, file) {
  if (process.platform === 'win32') {
    // Solo i figli diretti del node --test: i loro discendenti li chiude /T.
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8; '
      + `Get-CimInstance Win32_Process -Filter 'ParentProcessId=${c.pid}' | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }`],
    { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const figli = r.status === 0 ? processiDelFile(leggiProcessi(r.stdout), c.pid, file) : [];
    return figli.filter((pid) => spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).status === 0).length > 0;
  }
  // -ww: righe di comando intere, anche quando l'uscita non va a un terminale.
  const r = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 60_000 });
  const pids = r.status === 0 ? processiDelFile(leggiProcessi(r.stdout), c.pid, file) : [];
  return pids.filter((pid) => { try { process.kill(pid, 'SIGKILL'); return true; } catch (_) { return false; } }).length > 0;
}

/**
 * Chi è la sessione che lancia i test: non arriva ai test. In una routine li faceva misurare il consumo vero, che finiva
 * nei corpi confrontati e nelle cartelle di prova: rossi anche su main, solo lì (#949.1). Chi serve un test lo mette lui.
 */
export const IDENTITA_SESSIONE = Object.freeze(['FILO_ROUTINE', 'FILO_ROUTINE_TICKET', 'FILO_ROUTINE_ROLE', 'FILO_TRANSCRIPT', 'FILO_SESSION_ID']);

/** L'ambiente dei test. PURA. */
export function ambientePerITest(base, temp = '') {
  // Le manopole di questo lanciatore non arrivano ai test: la sua sentinella guarda i valori veri.
  const { FILO_UNIT_DIR: _d, FILO_UNIT_TETTO_RIGA: _t, FILO_UNIT_TETTO_FERMO_MS: _f, ...env } = base || {};
  for (const k of IDENTITA_SESSIONE) delete env[k];
  // Senza variabili la sessione si trova lo stesso: col biglietto in cartella vale il transcript più recente nella
  // cartella di Claude (#730.6). I test ne hanno una loro, vuota, che se ne va con la corsa.
  if (temp) Object.assign(env, { TMPDIR: temp, TEMP: temp, TMP: temp, CLAUDE_CONFIG_DIR: join(temp, 'claude-dei-test') });
  return env;
}

/**
 * Con `avanzamento` (il file del suo reporter) un file fermo per `tetto` si chiude da solo, e la corsa prosegue; se
 * chiuderlo non riesce, o non va avanti niente, si chiude la corsa e `fermo` dice chi era fermo. Ci passa anche una
 * prova che fa girare altri file (#1214). `raccogli`: l'uscita torna nell'esito invece che al terminale.
 */
export const lanciaSorvegliato = (args, { env, avanzamento = null, tetto = TETTO_FERMO_MS, raccogli = false } = {}) => new Promise((ok) => {
  // I test si aspettano la root come cartella corrente, come quando li lanciava npm.
  const c = spawn(process.execPath, args, { stdio: raccogli ? 'pipe' : 'inherit', cwd: REPO_ROOT, env });
  const uscita = { stdout: [], stderr: [] };
  if (raccogli) for (const k of Object.keys(uscita)) c[k].on('data', (d) => uscita[k].push(d));
  const raccolto = () => (raccogli ? { stdout: Buffer.concat(uscita.stdout).toString('utf8'), stderr: Buffer.concat(uscita.stderr).toString('utf8') } : {});
  let fermo = null;
  const chiusi = [];
  let eFermo = guardiaFermo(tetto);
  const fileFermo = guardiaPerFile(tetto);
  const tempo = avanzamento && orologioMacchina();
  let letti = 0;
  const guardia = avanzamento && setInterval(() => {
    let testo = '';
    try { testo = readFileSync(avanzamento, 'utf8'); } catch (_) { /* il reporter non ha ancora scritto niente */ }
    const intere = testo.lastIndexOf('\n') + 1;
    const nuove = intere > letti ? righeJson(testo.slice(letti, intere)) : [];
    letti = Math.max(letti, intere);
    const ora = tempo();
    const giudizio = fileFermo(nuove, ora);
    const tutto = eFermo(testo.length, ora);
    const daChiudere = giudizio?.file?.filter((f) => !chiusi.includes(f)) || [];
    if (daChiudere.length) {
      // Tutti provati, anche dopo un no: chi è chiuso è un rosso col suo nome comunque vada.
      const riusciti = daChiudere.filter((f) => chiudiFile(c, f));
      chiusi.push(...riusciti);
      if (riusciti.length === daChiudere.length) {
        // Node scrive l'esito dei file chiusi fra un attimo: fino ad allora la corsa non è ferma.
        eFermo = guardiaFermo(tetto);
        return;
      }
    }
    if (!giudizio && !tutto) return;
    clearInterval(guardia);
    const inCorso = fileInCorso(leggiRighe(avanzamento));
    fermo = inCorso.length ? inCorso : fileFermo.sospetti();
    chiudiAlbero(c);
  }, controlloPer(tetto));
  const fine = (esito) => { if (guardia) clearInterval(guardia); ok({ ...esito, chiusi: chiusi.filter((f) => !(fermo || []).includes(f)), ...raccolto() }); };
  c.on('error', (error) => fine({ error }));
  c.on('close', (status, signal) => fine({ status, signal, fermo }));
});

const lancia = (args, temp, avanzamento = null) => lanciaSorvegliato(args, { env: ambientePerITest(process.env, temp), avanzamento });

async function main() {
  const argv = process.argv.slice(2);
  const listOnly = argv.includes('--list');
  const solo = argv.includes(SOLO);
  const flags = argv.filter((a) => a !== '--list' && a !== SOLO);

  const files = solo ? separaArgomenti(flags).posizionali.map((p) => resolve(REPO_ROOT, p)) : collectTestFiles();
  if (!files.length) {
    console.error(solo ? `[test:unit] ${SOLO} senza file da lanciare: mi fermo.` : `[test:unit] nessun file *.test.mjs sotto ${UNIT_DIR}: mi fermo.`);
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

  if (NODE_LEGGE_MODELLI) {
    const persi = files.filter((f) => nomeNonLanciabile(perLaRiga(f)));
    if (persi.length) {
      console.error('[test:unit] questi file hanno nel nome graffe che node --test espande come un modello, e non girerebbero:');
      for (const f of persi) console.error(`  ${perLaRiga(f)}`);
      console.error('[test:unit] togli la virgola o i due punti fra le graffe dal nome: mi fermo.');
      process.exitCode = 1;
      return;
    }
  }

  // Una libreria nuova del lock arriva prima delle prove che la usano (#1572); le prove del lanciatore stesso no.
  if (!process.env.FILO_UNIT_DIR) {
    try {
      const { allineaPerLeProve } = await import('./lib/pacchetti.mjs');
      allineaPerLeProve(REPO_ROOT, { prefisso: '[test:unit]' });
    } catch (e) {
      console.log(`[test:unit] controllo dei pacchetti saltato: ${e && e.message ? e.message : e}`);
    }
  }

  const temp = await temporaneaDellaCorsa();

  // Dentro la temporanea della corsa: interrotta, il suo nome è l'unico che la pulizia del giorno dopo riconosce.
  const cartella = mkdtempSync(join(temp || tmpdir(), 'filo-unit-'));
  // I gruppi si contano coi flag del riepilogo già dentro: sono i più lunghi che la riga potrà portare.
  const destinazione = (i) => join(cartella, `gruppo-${String(i + 1).padStart(4, '0')}.jsonl`);
  const copia = (i) => (k) => join(cartella, `rapporto-${k + 1}-gruppo-${String(i + 1).padStart(4, '0')}`);
  const avanzamento = (i) => join(cartella, `avanzamento-${String(i + 1).padStart(4, '0')}.jsonl`);
  const { opzioni: dateDaChiLancia, posizionali } = separaArgomenti(flags);
  const date = conConcorrenza(dateDaChiLancia, await concorrenzaDelWorker());
  const tty = !!process.stdout.isTTY;
  // Un file dato a mano che è già fra i trovati girerebbe due volte.
  const trovati = new Set(files.map((f) => resolve(f)));
  const extra = posizionali.filter((p) => !trovati.has(resolve(REPO_ROOT, p)));
  const utente = (i) => rapportiDaRiunire(date, copia(i));
  const flagsGruppo = (i) => flagsConRiepilogo(utente(i).flags, destinazione(i), { tty });
  // Con --watch la corsa sta ferma apposta; coi reporter che non si sanno appaiare, o in una copia del lanciatore senza
  // il suo reporter, resta il tetto di node.
  const guarda = !chiedeWatch(flags) && existsSync(join(REPO_ROOT, REPORTER_AVANZAMENTO));
  const lancioDi = (i, base) => {
    const conGuardia = guarda && flagsConAvanzamento(base, avanzamento(i), { tty });
    return conGuardia ? { flags: conGuardia, avanzamento: avanzamento(i) } : { flags: conTettoDiTempo(base), avanzamento: null };
  };
  const flagsDi = (i) => lancioDi(i, flagsGruppo(i) || utente(i).flags);
  const gruppi = gruppiDiLancio(files, { flags: flagsDi(0).flags, extra });
  const tanti = gruppi.length > 1;
  const rapporti = utente(0).rapporti;
  // Con un documento su stdout, stdout porta solo quello: le nostre righe vanno su stderr.
  if (tanti && rapporti.includes('stdout')) canale = process.stderr;

  try {
    if (!tanti) {
      // Un gruppo solo: l'uscita è quella di un `node --test` qualunque, riepilogo compreso.
      const l = lancioDi(0, date);
      const r = await lancia(['--test', ...l.flags, ...gruppi[0]], temp, l.avanzamento);
      if (r.chiusi.length) await scrivi(`\n${testoFileChiusi(r.chiusi, TETTO_FERMO_MS)}`);
      if (r.fermo) {
        await scrivi(testoFermo(r.fermo, TETTO_FERMO_MS));
        process.exitCode = 1;
        return;
      }
      if (r.error) console.error(`[test:unit] non sono riuscito a lanciare node: ${r.error.message}`);
      // Ucciso da un segnale: non è un successo, e `status` in quel caso è null.
      process.exitCode = r.error || r.status === null ? 1 : r.status || (r.chiusi.length ? 1 : 0);
      return;
    }

    if (chiedeWatch(flags)) {
      console.error(`[test:unit] ${files.length} file vanno in ${gruppi.length} gruppi, e --watch non finisce mai il primo: gli altri non partirebbero.`);
      console.error('[test:unit] per guardare dei test mentre li cambi, lancia node --test --watch sui loro file.');
      process.exitCode = 1;
      return;
    }
    await scrivi(`[test:unit] ${files.length} file in ${gruppi.length} gruppi: tutti insieme non stanno in una riga di comando di Windows.`);
    const esiti = [];
    let interrotto = false;
    for (const [i, gruppo] of gruppi.entries()) {
      await scrivi(`\n[test:unit] gruppo ${i + 1} di ${gruppi.length} (${gruppo.length} file)`);
      const l = flagsDi(i);
      const r = await lancia(['--test', ...l.flags, ...gruppo], temp, l.avanzamento);
      if (r.chiusi.length) await scrivi(`\n${testoFileChiusi(r.chiusi, TETTO_FERMO_MS)}`);
      // Un file fermo è un rosso del suo gruppo, non un'interruzione: i gruppi dopo partono.
      if (r.fermo) { await scrivi(testoFermo(r.fermo, TETTO_FERMO_MS)); esiti.push(1); continue; }
      if (r.error) {
        console.error(`[test:unit] non sono riuscito a lanciare node per il gruppo ${i + 1}: ${r.error.message}`);
        esiti.push(1);
        continue;
      }
      // Ucciso da un segnale (Ctrl+C, timeout): non è un successo, e i gruppi dopo non partono.
      if (r.status === null) { esiti.push(1); interrotto = i + 1 < gruppi.length; break; }
      esiti.push(r.status || (r.chiusi.length ? 1 : 0));
    }
    // Relative alla root come per node, che gira lì.
    const rapportiPersi = [];
    for (const [k, dest] of rapporti.entries()) {
      const testo = unisciRapporti(esiti.map((_, i) => leggiTesto(copia(i)(k))));
      if (dest === 'stdout') { await new Promise((ok) => process.stdout.write(testo, ok)); continue; }
      try {
        writeFileSync(resolve(REPO_ROOT, dest), testo);
      } catch (e) {
        console.error(`[test:unit] non sono riuscito a scrivere il rapporto in ${dest}: ${e.message}`);
        rapportiPersi.push(dest);
      }
    }
    const somma = flagsGruppo(0) ? sommaRiepiloghi(esiti.map((_, i) => leggiRighe(destinazione(i)))) : null;
    await scrivi(testoRiepilogo({
      somma, gruppi: gruppi.length, file: files.length, esiti, interrotto, rapporti, accodati: utente(0).accodati, rapportiPersi,
      copertura: chiedeCopertura(flags),
    }));
    // `exitCode` e non `exit()`, come sopra: l'ultima riga non deve perdersi.
    process.exitCode = esiti.find((e) => e !== 0) ?? (rapportiPersi.length ? 1 : 0);
  } finally {
    // Su Windows un figlio appena uscito tiene ancora la cartella dei rapporti: resta nella temporanea della corsa, che
    // se ne va con lei, e l'esito della suite non cambia (#1063).
    try { rmSync(cartella, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (_) { /* vedi sopra */ }
  }
}

// Solo se invocato come script, non quando importato dai test.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
