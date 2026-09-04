#!/usr/bin/env node
// suite-reds.mjs — legge il verbale della suite completa e separa i rossi VERI
// dai rossi NOTI.
//
// PERCHÉ ESISTE
//   La suite completa (Electron sotto Playwright) ha una manciata di spec che
//   sono rosse anche quando non è rotto niente: chiedono allo schermo cose che
//   in un ambiente senza schermo vero non si possono avere (schermo intero,
//   cattura dello schermo, finestra visibile) o si appoggiano a un sito
//   esterno. Finché il verdetto lo dava un modello, quella lista viveva a
//   memoria nel prompt del verificatore — cioè in nessun posto: bastava un
//   giro perché "è un rosso noto" diventasse un'opinione.
//
//   Qui la lista è un FILE (`.github/workflows/rossi-noti.json`) e il confronto
//   è aritmetica: rossi del verbale meno rossi elencati = rossi veri. Se ne
//   resta anche uno, la suite è rossa e l'elenco esatto degli spec rotti finisce
//   nel riassunto — è quello che torna a chi corregge, che rilancia quelli e non
//   tutto.
//
// CONTARE I FALLIMENTI NON BASTA, E QUESTA È LA CICATRICE
//   Un verdetto che guarda solo i test FALLITI non si accorge mai dei test che
//   non sono stati eseguiti — e "non eseguito" esce verde. Provato: basta uno
//   spec che non compila (un import sbagliato, una parentesi in più) perché
//   Playwright abbandoni la fetta INTERA, scriva l'errore fuori dall'elenco dei
//   test e consegni un verbale con zero fallimenti. Nove fette sane più quella
//   persa davano «Suite completa verde: 1305 test eseguiti»: centoquarantacinque
//   test mai partiti, e nessuno avvisato.
//
//   Quattro strade portano lì, e si chiudono con tre regole sole:
//     · uno spec che non compila            → un errore fuori dai test CHE NOMINA
//                                             uno spec è rosso
//     · una fetta che esegue zero test      → il conto "zero" è per FETTA, non
//                                             sulla somma (una fetta viva
//                                             coprirebbe una morta)
//     · uno spec cancellato o rinominato    → il numero di test eseguiti si
//     · un filtro dei test più stretto        confronta con quello ATTESO, tenuto
//                                             nel repo accanto ai rossi noti
//
// DOV'È LA LISTA, E PERCHÉ LÌ
//   In `.github/workflows/`, accanto al workflow che la usa, perché quella
//   cartella è **area protetta** per il controllo di sicurezza del server: un
//   ramo che la tocca non viene fuso, apre una richiesta che l'owner approva a
//   mano. Una lista di rossi da ignorare è esattamente il file che un ramo
//   catturato vorrebbe allungare per far tacere una regressione: deve stare
//   dove allungarla si vede.
//
// USO
//   node scripts/suite-reds.mjs [verbale.json | cartella …] [--noti <file>]
//                               [--json-out <file>] [--ambiente actions|cloud|locale]
//                               [--fette <n>] [--attesi <file>] [--proponi]
//
//   `--fette <n>` pretende esattamente n verbali: una fetta che non consegna
//   renderebbe verde una suite eseguita per cinque sesti.
//
//   `--attesi <file>` è il numero di test che la suite DEVE eseguire in questo
//   ambiente (default `.github/workflows/suite-attesi.json`). Il confronto si fa
//   solo insieme a `--fette`, cioè solo quando la corsa si dichiara completa: un
//   ruolo che si rilancia due spec non sta pretendendo di aver eseguito la
//   suite. Se l'ambiente non ha un numero, il confronto non si fa.
//
//   `--proponi` stampa le voci pronte da incollare nella lista dei rossi noti:
//   è così che la lista si aggiorna dopo aver GUARDATO una corsa, invece di
//   ricopiare a mano titoli di test.
//
//   Si possono passare più verbali, o la cartella che li contiene: la suite su
//   Actions è divisa in fette parallele e ognuna consegna il suo.
//
//   Exit code:
//     0  nessun rosso fuori dalla lista (la suite è verde ai fini del cancello)
//     1  ci sono rossi veri — oppure il verbale manca/è illeggibile/è vuoto
//
//   Un verbale assente o senza nemmeno un test NON è un successo: "zero test
//   eseguiti" è precisamente il modo in cui un cancello smette di essere un
//   cancello (stessa cicatrice di `run-unit-tests.mjs`).

import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinnedRepoRoot } from './lib/tools-pin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Come in suite-verdict.mjs: nelle routine questo script gira dalla copia
// fissata degli strumenti, e i percorsi di default devono comunque puntare al
// progetto vero (è lì che stanno il verbale e la lista dei rossi noti).
export const REPO_ROOT = process.env.FILO_REPO_ROOT
  ? resolve(process.env.FILO_REPO_ROOT)
  : (pinnedRepoRoot() || resolve(__dirname, '..'));

export const VERBALE_DEFAULT = resolve(REPO_ROOT, 'tests', '.report', 'report.json');
export const NOTI_DEFAULT = resolve(REPO_ROOT, '.github', 'workflows', 'rossi-noti.json');
// Sta accanto ai rossi noti, e per la stessa ragione: abbassare il numero di
// test attesi è l'altro modo di far tacere una regressione, e `.github/workflows`
// è area protetta dal controllo di sicurezza del server.
export const ATTESI_DEFAULT = resolve(REPO_ROOT, '.github', 'workflows', 'suite-attesi.json');

// ─── logica pura (nessun file, nessuna rete: è tutta qui la parte testabile) ──

/**
 * Percorso di uno spec in forma canonica. PURA.
 *
 * Separatori `/`, niente `./`, e niente `tests/` davanti: il verbale di
 * Playwright scrive i percorsi rispetto alla cartella dei test
 * (`capture-composite.spec.mjs`), mentre un umano che compila la lista dei
 * rossi noti scrive quello che vede nel terminale (`tests/capture-…`). Le due
 * forme devono incontrarsi, o una voce scritta a mano non scusa niente e
 * nessuno capisce perché.
 */
export function normalizzaFile(file) {
  return String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^tests\//, '')
    .trim();
}

/**
 * Il titolo di un test in forma canonica. PURA.
 *
 * Stessa cura del percorso, e per lo stesso motivo: una voce scritta a mano con
 * uno spazio davanti al titolo non scusava niente e sembrava a posto. Gli spazi
 * interni multipli si stringono perché è così che un titolo sopravvive a un
 * copia-incolla dal terminale.
 */
export function normalizzaTitolo(titolo) {
  return String(titolo == null ? '' : titolo).replace(/\s+/g, ' ').trim();
}

/**
 * Il messaggio d'errore, ridotto a una riga leggibile. PURA.
 *
 * Playwright ci mette dentro i colori del terminale e venti righe di contesto:
 * qui serve la prima riga che dice qualcosa, perché il riassunto lo legge una
 * persona che deve capire in un secondo PERCHÉ quello spec è rosso, senza
 * aprire i log della corsa.
 */
export function primaRiga(messaggio, max = 200) {
  const pulito = String(messaggio || '')
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, '')
    .split('\n')
    .map((r) => r.trim())
    .find((r) => r.length > 0) || '';
  return pulito.length > max ? `${pulito.slice(0, max - 1)}…` : pulito;
}

/** L'errore dell'ultimo tentativo di un test andato male. PURA. */
function messaggioDelTest(test) {
  const risultati = Array.isArray(test && test.results) ? test.results : [];
  for (let i = risultati.length - 1; i >= 0; i -= 1) {
    const r = risultati[i];
    if (!r) continue;
    if (r.error && r.error.message) return primaRiga(r.error.message);
    const primo = Array.isArray(r.errors) ? r.errors.find((e) => e && e.message) : null;
    if (primo) return primaRiga(primo.message);
  }
  return '';
}

/**
 * Gli errori che Playwright scrive FUORI dall'elenco dei test. PURA.
 *
 * È il buco che ha fatto uscire verde una fetta persa: quando uno spec non
 * compila, Playwright non ha nessun test a cui attaccare l'errore — abbandona la
 * fetta e lo mette qui, in `errors`, dove un conto che guarda solo i fallimenti
 * non passa mai.
 *
 * Non sono tutti la stessa cosa, e la differenza è il FILE:
 *
 * · con un file, l'errore riguarda uno spec che non è nemmeno partito (import
 *   sbagliato, parentesi di troppo): sono test che non sono stati eseguiti, ed
 *   è rosso — provato, Playwright mette lì il percorso dello spec;
 * · senza file, è un guasto del worker DOPO i test (lo smontaggio che non
 *   finisce, il salvataggio di una traccia dopo un ritentativo). Non nasconde
 *   test non eseguiti, e infatti compare solo nelle fette che avevano già dei
 *   rossi: farlo pesare come rosso vorrebbe dire che un rosso NOTO — uno di
 *   quelli che la lista scusa apposta — riesce comunque a tingere la corsa.
 *   Si dice nel riassunto e basta; che nessun test sia sparito lo garantiscono
 *   già le altre due regole (nessuna fetta a zero, conto sopra il minimo).
 */
export function erroriFuoriTest(verbale) {
  const voci = Array.isArray(verbale && verbale.errors) ? verbale.errors : [];
  return voci
    .filter((e) => e && (e.message || e.stack))
    .map((e) => ({
      file: normalizzaFile((e.location && e.location.file) || ''),
      messaggio: primaRiga(e.message || e.stack),
    }));
}

/**
 * Gli spec falliti nel verbale JSON di Playwright. PURA.
 *
 * Ritorna `[{ file, titolo, messaggio }]`, uno per test andato male, in ordine
 * di verbale.
 *
 * Cosa conta come fallito: `status === 'unexpected'`, cioè rosso dopo TUTTI i
 * tentativi. Non contano `flaky` (rosso al primo giro, verde al ritentativo:
 * la configurazione ha 2 retry proprio per assorbire i blip) né `skipped`.
 * Contare i flaky rimetterebbe in circolo il falso "main rotto" che i retry
 * sono venuti a togliere.
 */
export function speccFalliti(verbale) {
  const fuori = [];
  const visita = (suite, ereditato) => {
    if (!suite || typeof suite !== 'object') return;
    const file = normalizzaFile(suite.file || ereditato || '');
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      const specFile = normalizzaFile(spec.file || file);
      const rotto = (Array.isArray(spec.tests) ? spec.tests : [])
        .find((t) => t && t.status === 'unexpected');
      if (rotto) {
        fuori.push({
          file: specFile,
          titolo: normalizzaTitolo(spec.title),
          messaggio: messaggioDelTest(rotto),
        });
      }
    }
    for (const dentro of Array.isArray(suite.suites) ? suite.suites : []) visita(dentro, file);
  };
  for (const suite of Array.isArray(verbale && verbale.suites) ? verbale.suites : []) visita(suite, '');
  return fuori;
}

/** Quanti test ha eseguito il verbale (esclusi gli skipped). PURA. */
export function testEseguiti(verbale) {
  let n = 0;
  const visita = (suite) => {
    if (!suite || typeof suite !== 'object') return;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
      for (const t of Array.isArray(spec.tests) ? spec.tests : []) {
        if (t && t.status && t.status !== 'skipped') n += 1;
      }
    }
    for (const dentro of Array.isArray(suite.suites) ? suite.suites : []) visita(dentro);
  };
  for (const suite of Array.isArray(verbale && verbale.suites) ? verbale.suites : []) visita(suite);
  return n;
}

/**
 * Normalizza la lista dei rossi noti letta dal file. PURA.
 *
 * Ogni voce: `{ file, titolo?, dove?, perche }`.
 *   · senza `titolo` la scusa vale per TUTTO il file;
 *   · con `titolo` vale solo per quel test (preferibile: un file intero scusato
 *     nasconde anche le regressioni dei suoi altri test).
 *   · `dove`: 'ovunque' | 'cloud' | 'actions' | 'locale' — un rosso d'ambiente
 *     di una macchina non è una scusa valida su un'altra (vedi ambienteCopre).
 */
export function leggiNoti(dati) {
  const voci = Array.isArray(dati && dati.spec) ? dati.spec : [];
  return voci
    .filter((v) => v && typeof v === 'object' && v.file)
    .map((v) => ({
      file: normalizzaFile(v.file),
      // Il titolo passa dalla stessa normalizzazione del percorso. Prima non
      // succedeva, e una voce scritta a mano con uno spazio davanti al titolo
      // non scusava niente pur sembrando a posto.
      titolo: normalizzaTitolo(v.titolo),
      dove: v.dove ? String(v.dove) : 'ovunque',
      perche: v.perche ? String(v.perche) : '',
    }));
}

/**
 * Quanti test deve eseguire la suite in questo ambiente. PURA.
 *
 * Zero = nessun numero per questo ambiente, quindi nessun confronto: una corsa
 * parziale (un ruolo che si rilancia due spec) non deve pretendere di essere la
 * suite intera.
 */
export function leggiAttesi(dati, ambiente) {
  const mappa = (dati && typeof dati.attesi === 'object' && dati.attesi) || {};
  const n = Number(mappa[ambiente || ''] || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Una scusa scritta per l'ambiente `dove` vale in `ambiente`? PURA.
 *
 * Gli ambienti non sono tre etichette alla pari: il runner di GitHub Actions è
 * anche lui una macchina senza schermo, quindi si becca pure i rossi scritti
 * per `cloud`. Non vale il contrario — ci sono spec rosse SOLO sul runner
 * (più lento della macchina delle routine) e scusarle anche altrove
 * spegnerebbe la suite in un posto dove funziona.
 */
export function ambienteCopre(dove, ambiente) {
  const d = dove || 'ovunque';
  const a = ambiente || 'cloud';
  if (d === 'ovunque' || d === a) return true;
  return d === 'cloud' && a === 'actions';
}

/** La voce della lista che scusa questo fallimento, se c'è. PURA. */
export function scusaPer(fallito, noti, ambiente) {
  return (noti || []).find((n) => n.file === fallito.file
    && (!n.titolo || n.titolo === fallito.titolo)
    && ambienteCopre(n.dove, ambiente)) || null;
}

/**
 * I verbali in forma uniforme `{ nome, dati }`. PURA.
 *
 * Il nome serve a dire QUALE fetta è morta: "una fetta non ha eseguito niente"
 * senza il nome è una notizia che non si può usare.
 */
export function normalizzaVerbali(verbali) {
  const lista = Array.isArray(verbali) ? verbali : [verbali];
  return lista.map((v, i) => (v && typeof v === 'object' && v.dati && typeof v.dati === 'object'
    ? { nome: String(v.nome || `fetta ${i + 1}`), dati: v.dati }
    : { nome: `fetta ${i + 1}`, dati: v }));
}

/**
 * Il conto finale. PURA.
 *
 * `rossi`    → fallimenti che nessuna voce scusa: sono la regressione.
 * `scusati`  → fallimenti coperti dalla lista.
 * `scaduti`  → voci della lista che oggi NON hanno fallito: la scusa non serve
 *              più. Non fanno rosso (un test che passa non è un guasto), ma si
 *              dicono: senza, la lista marcisce e finisce per coprire davvero
 *              una regressione, che è il solo modo in cui questo meccanismo può
 *              fare danno.
 * `fette`    → per ogni verbale, quanti test ha eseguito e che errori ha
 *              scritto fuori dai test.
 * `vuote`    → le fette che non hanno eseguito NEMMENO UN TEST. Il conto "zero"
 *              va per fetta e non sulla somma: sulla somma basta una fetta viva
 *              perché non scatti mai, ed è così che una fetta persa passava per
 *              verde.
 * `errori`   → errori fuori dai test che NOMINANO uno spec: quello spec non è
 *              partito. Rossi.
 * `avvisi`   → errori fuori dai test senza uno spec a cui appartenere (lo
 *              smontaggio del worker che non finisce). Si dicono, non fanno
 *              rosso: vedi `erroriFuoriTest`.
 * `minimo`   → quanti test la suite doveva eseguire (0 = nessun confronto).
 */
export function classifica(verbali, noti, ambiente, opzioni = {}) {
  // Uno o più verbali: la suite su Actions è divisa in fette parallele, e ogni
  // fetta consegna il suo. Il conto è sulla somma — una fetta verde da sola non
  // dice niente.
  const lista = normalizzaVerbali(verbali);
  const fette = lista.map(({ nome, dati }) => {
    const fuori = erroriFuoriTest(dati).map((e) => ({ ...e, fetta: nome }));
    return {
      nome,
      eseguiti: testEseguiti(dati),
      errori: fuori.filter((e) => e.file),    // uno spec che non è partito: rosso
      avvisi: fuori.filter((e) => !e.file),   // guasto del worker dopo i test: si dice
    };
  });
  const falliti = lista.flatMap(({ dati }) => speccFalliti(dati));
  const rossi = [];
  const scusati = [];
  const usate = new Set();
  for (const f of falliti) {
    const scusa = scusaPer(f, noti, ambiente);
    if (scusa) { scusati.push({ ...f, perche: scusa.perche }); usate.add(scusa); }
    else rossi.push(f);
  }
  const scaduti = (noti || []).filter((n) => !usate.has(n) && ambienteCopre(n.dove, ambiente));
  const eseguiti = fette.reduce((n, f) => n + f.eseguiti, 0);
  const minimo = Number(opzioni.minimo || 0) || 0;
  return {
    rossi,
    scusati,
    scaduti,
    eseguiti,
    fette,
    vuote: fette.filter((f) => f.eseguiti === 0).map((f) => f.nome),
    errori: fette.flatMap((f) => f.errori),
    avvisi: fette.flatMap((f) => f.avvisi),
    minimo,
  };
}

/**
 * La regola del verde, in un posto solo. PURA.
 *
 * Chiunque decida "verde o no" — il codice d'uscita, il file dell'esito, il
 * verdetto sul ref — la chiede qui: due copie di questa regola vorrebbero dire
 * che una delle due, prima o poi, dice verde mentre l'altra dice rosso.
 */
export function verde(esito) {
  if (!esito) return false;
  if ((esito.rossi || []).length) return false;
  if ((esito.vuote || []).length) return false;      // una fetta non ha eseguito niente
  if ((esito.errori || []).length) return false;     // uno spec non è nemmeno partito
  if (esito.minimo > 0 && esito.eseguiti < esito.minimo) return false; // il conto è crollato
  return true;
}

/** Un test in una riga leggibile da un umano. PURA. */
export function riga(f) {
  return f.titolo ? `${f.file} › ${f.titolo}` : f.file;
}

/**
 * Il riassunto che finisce nel cancello e, da lì, nella critica di chi
 * corregge. In italiano e senza gergo: lo legge l'owner, non un parser. PURA.
 */
export function riassunto(esito) {
  const r = [];
  const ok = verde(esito);
  if (ok) {
    r.push(`Suite completa verde: ${esito.eseguiti} test eseguiti, nessun rosso fuori dalla lista dei rossi noti.`);
  } else if (esito.rossi.length) {
    r.push(`Suite completa ROSSA: ${esito.rossi.length} spec rotti su ${esito.eseguiti} test eseguiti.`);
  } else {
    r.push(`Suite completa NON VERDE: nessuno spec rotto, ma la suite non ha eseguito quello che doveva (${esito.eseguiti} test eseguiti).`);
  }
  if (esito.rossi.length) {
    r.push('');
    r.push('Spec da rilanciare:');
    for (const f of esito.rossi) r.push(`- ${riga(f)}${f.messaggio ? `\n    ${f.messaggio}` : ''}`);
  }
  // ⚠️ Le tre righe qui sotto sono il motivo per cui questo riassunto esiste:
  // un verdetto che guarda solo i fallimenti direbbe "verde" in tutti e tre i
  // casi, con un pezzo di suite mai eseguito.
  if ((esito.vuote || []).length) {
    r.push('');
    r.push(`Fette che non hanno eseguito NEMMENO UN TEST (${esito.vuote.length}): una fetta persa non è un verde parziale.`);
    for (const nome of esito.vuote) r.push(`- ${nome}`);
  }
  if ((esito.errori || []).length) {
    r.push('');
    r.push(`Spec che non sono nemmeno partiti (${esito.errori.length}): Playwright ha abbandonato la fetta senza far fallire un solo test. Di solito è uno spec che non compila.`);
    for (const e of esito.errori) r.push(`- ${e.fetta} › ${e.file}: ${e.messaggio}`);
  }
  if ((esito.avvisi || []).length) {
    r.push('');
    r.push(`Guasti del worker dopo i test (${esito.avvisi.length}), non contati come rossi perché non nascondono test non eseguiti:`);
    for (const e of esito.avvisi) r.push(`- ${e.fetta}: ${e.messaggio}`);
  }
  if (esito.minimo > 0 && esito.eseguiti < esito.minimo) {
    r.push('');
    r.push(`Test eseguiti: ${esito.eseguiti}, contro i ${esito.minimo} attesi. Un crollo del conto È la regressione: spec cancellati o rinominati, oppure un filtro che non li prende più. Se il calo è voluto, il numero atteso si aggiorna nello stesso commit (.github/workflows/suite-attesi.json).`);
  } else if (esito.minimo > 0 && esito.eseguiti > esito.minimo + 20) {
    r.push('');
    r.push(`Test eseguiti: ${esito.eseguiti}, contro i ${esito.minimo} attesi. Il numero atteso è vecchio: alzalo, o smette di accorgersi di un crollo.`);
  }
  if (esito.scusati.length) {
    r.push('');
    r.push(`Rossi noti, ignorati (${esito.scusati.length}):`);
    for (const f of esito.scusati) r.push(`- ${riga(f)}${f.perche ? ` — ${f.perche}` : ''}`);
  }
  if (esito.scaduti.length) {
    r.push('');
    r.push('Voci della lista dei rossi noti che oggi passano: si possono togliere.');
    for (const n of esito.scaduti) r.push(`- ${riga(n)}`);
  }
  return r.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = { verbali: [], noti: '', attesi: '', jsonOut: '', ambiente: '', fette: 0, proponi: false, unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--noti') { out.noti = argv[++i] || ''; }
    else if (a === '--attesi') { out.attesi = argv[++i] || ''; }
    else if (a === '--json-out') { out.jsonOut = argv[++i] || ''; }
    else if (a === '--ambiente') { out.ambiente = argv[++i] || ''; }
    else if (a === '--fette') { out.fette = Number(argv[++i] || 0) || 0; }
    else if (a === '--proponi') { out.proponi = true; }
    else if (typeof a === 'string' && a.startsWith('-')) out.unknown.push(a);
    else out.verbali.push(a);
  }
  return out;
}

/**
 * Le voci pronte da incollare nella lista, per i rossi che oggi non ha nessuno.
 * PURA.
 *
 * Serve a tenere la lista una cosa scritta invece che ricopiata a mano: chi
 * scopre un rosso d'ambiente non deve ricordarsi il formato, e soprattutto non
 * deve ricordarsi il TITOLO esatto del test (scriverlo a occhio è il modo in cui
 * una voce nasce già inutile). Il motivo lo mette una persona: quello no, non si
 * può proporre.
 */
export function proponiVoci(rossi, ambiente) {
  return rossi.map((f) => ({
    file: f.file,
    titolo: f.titolo,
    dove: ambiente || 'actions',
    perche: 'DA SCRIVERE: perché questo rosso non dipende dal codice',
  }));
}

/**
 * I file di verbale da leggere: i percorsi passati, e per ogni cartella tutti i
 * `.json` che contiene (è così che arrivano le fette della suite parallela:
 * scaricate come artefatti in una cartella sola).
 */
export function espandiVerbali(percorsi, { esisteFn, elencaFn, isDirFn }) {
  const fuori = [];
  for (const p of percorsi) {
    const abs = resolve(p);
    if (!esisteFn(abs)) continue;
    if (isDirFn(abs)) {
      for (const f of elencaFn(abs)) if (f.endsWith('.json')) fuori.push(resolve(abs, f));
    } else fuori.push(abs);
  }
  return fuori.sort();
}

function leggiJson(percorso) {
  return JSON.parse(readFileSync(percorso, 'utf8'));
}

function scriviEsito(jsonOut, corpo) {
  if (!jsonOut) return;
  try { writeFileSync(resolve(jsonOut), `${JSON.stringify(corpo, null, 2)}\n`); }
  catch (_) { /* se non si riesce a scrivere, resta il codice d'uscita */ }
}

function main() {
  const {
    verbali: vArgs, noti: nArg, attesi: aArg, jsonOut, ambiente, fette, proponi, unknown,
  } = parseArgs(process.argv.slice(2));
  if (unknown.length) {
    console.error(`opzioni sconosciute: ${unknown.join(' ')}`);
    process.exit(1);
  }
  const richiesti = vArgs.length ? vArgs : [VERBALE_DEFAULT];
  const percorsoNoti = nArg ? resolve(nArg) : NOTI_DEFAULT;
  const percorsoAttesi = aArg ? resolve(aArg) : ATTESI_DEFAULT;
  const dove = ambiente || 'actions';

  // Un motivo per cui la suite NON è verde, detto una volta sola e nei tre posti
  // che contano: i log della corsa, il file dell'esito (da cui il verdetto sul
  // ref prende il riassunto) e il codice d'uscita. Senza il file, chi rilegge il
  // verdetto vedrebbe solo un generico "non è un verde" e dovrebbe andare a
  // rovistare nei log del workflow.
  const fermati = (motivo) => {
    console.error(`[suite-reds] ${motivo}`);
    scriviEsito(jsonOut, { verde: false, eseguiti: 0, rossi: [], riassunto: motivo });
    process.exit(1);
  };

  const percorsi = espandiVerbali(richiesti, {
    esisteFn: existsSync,
    elencaFn: (d) => readdirSync(d),
    isDirFn: (p) => statSync(p).isDirectory(),
  });
  if (!percorsi.length) {
    fermati(`nessun verbale in ${richiesti.join(' ')} — la suite non ha prodotto un risultato, quindi non è verde.`);
  }
  // ⚠️ Il buco peggiore di una suite a fette: se una fetta muore prima di
  // consegnare il suo verbale, le altre sono verdi e il conto totale sarebbe
  // verde — con un decimo della suite mai eseguito. Un pezzo mancante non è un
  // verde parziale: è un non-verde.
  if (fette && percorsi.length !== fette) {
    fermati(`${percorsi.length} verbali su ${fette}: una fetta della suite non ha consegnato. Non è un verde, è una suite incompleta.`);
  }
  const verbali = [];
  for (const p of percorsi) {
    try { verbali.push({ nome: basename(p), dati: leggiJson(p) }); }
    catch (e) {
      fermati(`verbale illeggibile ${basename(p)} (${e.message}): non è verde.`);
    }
  }
  let noti = [];
  if (existsSync(percorsoNoti)) {
    try { noti = leggiNoti(leggiJson(percorsoNoti)); }
    catch (e) {
      // Una lista illeggibile non deve poter scusare NIENTE per sbaglio: si
      // ferma qui, invece di proseguire con zero scuse e tingere di rosso
      // dei rossi che erano noti.
      fermati(`lista dei rossi noti illeggibile (${e.message}).`);
    }
  }
  // Il confronto col numero atteso vale solo per una corsa che si DICHIARA
  // completa, cioè quella con le fette (`--fette n`). Un ruolo che si rilancia
  // due spec a mano non sta pretendendo di aver eseguito la suite, e pretendere
  // da lui millequattrocento test sarebbe un rosso che non vuol dire niente.
  let minimo = 0;
  if (fette && existsSync(percorsoAttesi)) {
    try { minimo = leggiAttesi(leggiJson(percorsoAttesi), dove); }
    catch (e) {
      // Stessa logica della lista: se il numero atteso non si legge, il
      // controllo che lo usa sparirebbe in silenzio. Meglio fermarsi.
      fermati(`numero di test attesi illeggibile (${e.message}).`);
    }
  }

  const esito = classifica(verbali, noti, dove, { minimo });
  const testo = riassunto(esito);
  if (esito.eseguiti === 0) {
    console.error('[suite-reds] zero test eseguiti: non è un verde, è una suite che non è partita.');
  }

  console.log(testo);
  if (proponi && esito.rossi.length) {
    console.log('');
    console.log('Voci pronte per .github/workflows/rossi-noti.json (il motivo va scritto a mano):');
    console.log(JSON.stringify(proponiVoci(esito.rossi, dove), null, 2));
  }
  scriviEsito(jsonOut, {
    verde: verde(esito),
    eseguiti: esito.eseguiti,
    attesi: esito.minimo,
    rossi: esito.rossi,
    vuote: esito.vuote,
    errori: esito.errori,
    avvisi: esito.avvisi,
    scusati: esito.scusati,
    scaduti: esito.scaduti,
    riassunto: testo,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${testo}\n`); } catch (_) { /* il riassunto è un di più */ }
  }
  process.exit(verde(esito) ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
