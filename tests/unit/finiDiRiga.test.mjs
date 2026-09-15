// Sentinella sui FINI RIGA: un file del repo non deve arrivare a un test con i
// fini riga della macchina che lo esegue.
//
// IL CASO (#569, e prima il #565)
//   Le sentinelle leggono file del repo e li analizzano: le regole Firestore e
//   Storage, l'indice dei pattern. Come arrivano le righe lo decide però il
//   checkout: Git for Windows converte in CRLF. Una ricerca che contiene un «a
//   capo» allora non trova più niente, e il test dice che manca una cosa che nel
//   file c'è. Rosso su una macchina sola — e quella macchina è il cancello
//   della pubblicazione: dall'11 al 15 settembre 2026 agli utenti non è arrivata
//   nessuna versione per un `indexOf('allow update: if\n        isAdmin()')`.
//   Il #565 era lo stesso difetto da un'altra porta (l'indice dei pattern letto
//   come «vuoto»), chiuso però solo in quel file: un anno dopo è rientrato da
//   quella accanto. Per questo la regola adesso è una sola e vale per tutti.
//
// LE DUE METÀ DELLA REGOLA
//   1. `.gitattributes` pretende LF da qualunque checkout: la differenza fra
//      macchine sparisce alla radice, per le copie scaricate d'ora in poi.
//   2. `tests/helpers/testo.mjs` normalizza quello che un test legge: copre
//      anche le copie già sul disco, dove i CRLF restano finché il file non
//      viene riscritto (è il caso della macchina di chi sviluppa Filo).
//   Servono tutte e due: la prima senza la seconda lascia rossa la macchina di
//   casa, la seconda senza la prima lascia il problema a chiunque legga un file
//   del repo senza passare dalla porta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { leggiTestoRepo, normalizzaFiniRiga } from '../helpers/testo.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CARTELLA_TEST = join(ROOT, 'tests');

// I file del repo che le sentinelle ANALIZZANO riga per riga: qui un CRLF non è
// un carattere in più, è un test che mente. Chi ne aggiunge uno lo mette qui.
const FILE_ANALIZZATI = /(firestore\.rules|storage\.rules|PATTERNS\.md|patterns[/\\])/;

// Una riga che parla DEL difetto invece di commetterlo: la sentinella qui sotto
// e le prove del giro di verifica se lo scrivono in casa, l'esempio malato, per
// far vedere che lo riconoscono. Senza questo marcatore si accuserebbero da sé.
const ESEMPIO_VOLUTO = /esempio del #569/;

// Tutti i file di test, a QUALUNQUE profondità sotto tests/.
//
// Perché ricorsivo, e non la sola tests/unit: la regola vale per chiunque
// analizzi un file del repo, e i test non stanno in una cartella sola. Guardarne
// una è il modo in cui questo difetto è già tornato: chiuso nel #565 dentro il
// file che l'aveva mostrato, è rientrato un anno dopo dal file accanto come
// #569. Una prova messa fra quelle dell'app, in tests/rules/ o in una cartella
// di verifica passava indisturbata.
function tuttiIFileDiTest(cartella, dentro = []) {
  for (const nome of readdirSync(cartella, { withFileTypes: true })) {
    if (nome.name === 'node_modules' || nome.name.startsWith('.')) continue;
    const p = join(cartella, nome.name);
    if (nome.isDirectory()) tuttiIFileDiTest(p, dentro);
    else if (nome.name.endsWith('.mjs')) dentro.push(p);
  }
  return dentro;
}

// I nomi di variabile che tengono il percorso di uno di quei file:
// `const RULES = join(ROOT, 'firestore.rules')`. Senza questo passaggio basta
// spostare il percorso una riga più su per sparire dal controllo, e la lettura
// grezza torna invisibile.
function variabiliColPercorso(sorgente) {
  const nomi = new Set();
  const assegnazione = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*)/g;
  let m;
  while ((m = assegnazione.exec(sorgente))) {
    if (FILE_ANALIZZATI.test(m[2])) nomi.add(m[1]);
  }
  return nomi;
}

test('il repo pretende LF da qualunque checkout (.gitattributes)', () => {
  const percorso = join(ROOT, '.gitattributes');
  assert.ok(existsSync(percorso), 'manca .gitattributes: senza, i fini riga dei file tracciati li decide la macchina che scarica il repo (e su Windows diventano CRLF)');
  const attributi = leggiTestoRepo(percorso);
  const riga = attributi
    .split('\n')
    .map((r) => r.trim())
    .find((r) => r.startsWith('*') && /text=auto/.test(r));
  assert.ok(riga, '.gitattributes deve dichiarare `* text=auto eol=lf`: senza, i fini riga li decide la macchina che scarica il repo');
  assert.match(riga, /eol=lf/, `la regola c'è ma non fissa i fini riga: "${riga}"`);
});

test('il lettore normalizza davvero CRLF e CR soli', () => {
  assert.equal(normalizzaFiniRiga('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(normalizzaFiniRiga('a\rb'), 'a\nb'); // vecchio Mac
  assert.equal(normalizzaFiniRiga('a\nb'), 'a\nb'); // già a posto: invariato
  // Il file letto dal disco esce senza nessun ritorno a capo di Windows.
  assert.ok(!leggiTestoRepo(join(ROOT, 'firestore.rules')).includes('\r'));
});

test('un file del repo che una sentinella analizza si legge dalla porta, non con readFileSync', () => {
  // Le prove dei giri di verifica passati sono memoria congelata: non si
  // riscrivono, quindi questa regola di stile non le riguarda. Il difetto vero
  // (la ricerca con un «a capo» in mezzo) le riguarda eccome, ed è il controllo
  // qui sotto, che infatti scende anche lì.
  const colpevoli = [];
  for (const percorso of tuttiIFileDiTest(CARTELLA_TEST)) {
    const rel = relative(ROOT, percorso).replace(/\\/g, '/');
    if (rel === 'tests/unit/finiDiRiga.test.mjs') continue; // qui readFileSync serve a leggere i test stessi
    if (rel.startsWith('tests/verifica/')) continue;
    const sorgente = readFileSync(percorso, 'utf8');
    const variabili = variabiliColPercorso(sorgente);
    sorgente.split(/\r?\n/).forEach((riga, i) => {
      if (!/readFileSync\s*\(/.test(riga)) return;
      if (ESEMPIO_VOLUTO.test(riga)) return;
      const nominaIlFile = FILE_ANALIZZATI.test(riga);
      const passaPerVariabile = [...variabili].some((v) => new RegExp(`readFileSync\\s*\\(\\s*${v}\\b`).test(riga));
      if (!nominaIlFile && !passaPerVariabile) return;
      colpevoli.push(`${rel}:${i + 1}: ${riga.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    colpevoli,
    [],
    'questi file del repo vengono analizzati riga per riga: leggili con leggiTestoRepo() (tests/helpers/testo.mjs), '
    + 'altrimenti su un checkout di Windows il test misura i fini riga invece del contenuto',
  );
});

test('nessuna ricerca su un file del repo contiene un «a capo» in mezzo', () => {
  // `indexOf('…if\n        isAdmin()')` è la forma che si è rotta: con CRLF non
  // trova niente e il test accusa il file. Un «a capo» in TESTA alla stringa
  // cercata regge (il \r sta prima), quindi si guarda solo quello in mezzo.
  //
  // Si guardano SOLO i test che leggono uno di quei file. Altrove una stringa
  // con un «a capo» dentro è di solito un testo che il test si è costruito da
  // sé (una critica, un prompt), dove i fini riga li decide il codice e non il
  // checkout: segnalarla sarebbe rumore, e il rumore fa spegnere le sentinelle.
  const conACapoInMezzo = /\.(indexOf|lastIndexOf|includes|startsWith|endsWith|split)\(\s*(['"`])(?:(?!\2)[^\\])+\\n/;
  const colpevoli = [];
  for (const nome of readdirSync(CARTELLA_UNIT)) {
    if (!nome.endsWith('.mjs')) continue;
    if (nome === 'finiDiRiga.test.mjs') continue; // la regex qui sopra si nomina da sé
    const sorgente = leggiTestoRepo(join(CARTELLA_UNIT, nome));
    if (!FILE_ANALIZZATI.test(sorgente)) continue;
    sorgente.split('\n').forEach((riga, i) => {
      if (conACapoInMezzo.test(riga)) colpevoli.push(`${nome}:${i + 1}: ${riga.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    colpevoli,
    [],
    'una stringa da cercare con un «a capo» in mezzo non regge un checkout con CRLF: usa una regex con \\s+ '
    + '(o normalizza il testo con leggiTestoRepo) — è il difetto del #569',
  );
});
