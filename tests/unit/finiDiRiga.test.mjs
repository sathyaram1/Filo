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
//
// LE DUE RETI GUARDANO LA FORMA, NON IL NOME
//   Questo difetto è già rientrato due volte dalla porta accanto, e le due reti
//   qui sotto lo hanno imparato: non sorvegliano `readFileSync` e `indexOf`,
//   sorvegliano LEGGERE UN FILE DEL REPO SENZA NORMALIZZARLO e CERCARCI DENTRO
//   UNA COSA CHE UN `\r` DI TROPPO FA SPARIRE. Quindi la lettura vale anche
//   asincrona (`readFile` di node:fs/promises è la stessa lettura grezza con un
//   `await` davanti), e la ricerca vale anche scritta come regex con un «a
//   capo» dentro, come `replace`/`match`/`search`, o come `$` di fine riga in
//   una regex multiriga (era il #565: `\r` sta prima della fine riga, e il `$`
//   non ci arriva mai).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
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

// L'unica uscita dalla regola, e si scrive sulla riga che la usa. Serve dove il
// testo del file NON viene analizzato ma solo passato a qualcun altro (le regole
// date in pasto agli emulatori veri: lì i fini riga non cambiano niente, e il
// file gira fuori dal repo, dove la porta comune non si può importare).
// Un'esenzione scritta si vede in revisione; una cartella esclusa in silenzio no.
const NON_ANALIZZATO = /fini riga: non analizzato/;

// Leggere il file dal disco, in tutte le forme che lo fanno davvero: sincrona e
// asincrona. `readFile` di node:fs/promises non è un'altra cosa — è la stessa
// lettura grezza, e lasciarla fuori era la porta accanto.
const LETTURA_GREZZA = /\b(?:readFileSync|readFile)\s*\(/;

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

// --- La rete sulle RICERCHE -------------------------------------------------
//
// Tutti i modi di cercare dentro un testo che un `\r` di troppo fa fallire.
// Sono tre forme, e sono tre solo perché è così che il difetto si è presentato:
// la regola vera è «fra due pezzi di testo che stanno su righe diverse non si
// scrive un `\n` nudo, e la fine riga non si àncora con `$`».

const METODI_DI_RICERCA = 'indexOf|lastIndexOf|includes|startsWith|endsWith|split|replace|replaceAll|match|matchAll|search';

// 1. La stringa cercata con un «a capo» IN MEZZO: `indexOf('…if\n        isAdmin()')`.
//    Un «a capo» in testa regge (il `\r` sta prima), quindi si guarda il mezzo.
const STRINGA_CON_A_CAPO = new RegExp(`\\.(?:${METODI_DI_RICERCA})\\(\\s*(['"\`])(?:(?!\\1)[^\\\\])+\\\\n`);

// 2 e 3 vivono dentro i letterali di regex, che vanno prima ritagliati dalla
//    riga. Il ritaglio è volutamente prudente: meglio lasciarsi sfuggire una
//    forma esotica che accusare una divisione.
const LETTERALE_REGEX = /\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuy]*/g;

// Cosa può stare prima di un «a capo» (o di un `$`) perché quello sia davvero
// un problema: del TESTO. Se prima c'è un quantificatore o una classe — `\s*`,
// `[\s\S]*?`, `\r?` — il `\r` se lo mangia quella, e la ricerca regge.
const TESTO_PRIMA = /[\w \t;:,.'"=<>!&%@#~`-]$/;

/** Il carattere in posizione `i` è sfuggito da una barra rovescia? */
function sfuggito(corpo, i) {
  let barre = 0;
  for (let j = i - 1; j >= 0 && corpo[j] === '\\'; j -= 1) barre += 1;
  return barre % 2 === 1;
}

/** Il carattere in posizione `i` sta dentro una classe `[…]`? */
// Dentro una classe `$` è un dollaro letterale e `\n` un'alternativa, non una
// fine riga da ancorare: `[A-Za-z_$]` accusato era un falso allarme.
function dentroClasse(corpo, i) {
  let aperta = false;
  for (let j = 0; j < i; j += 1) {
    if (corpo[j] === '\\') { j += 1; continue; }
    if (!aperta && corpo[j] === '[') aperta = true;
    else if (aperta && corpo[j] === ']') aperta = false;
  }
  return aperta;
}

/** I motivi per cui le ricerche di questa riga non reggono un CRLF. */
function ricercheFragili(riga) {
  const motivi = new Set();
  if (STRINGA_CON_A_CAPO.test(riga)) motivi.add('una stringa da cercare con un «a capo» in mezzo');
  for (const letterale of riga.match(LETTERALE_REGEX) || []) {
    const fine = letterale.lastIndexOf('/');
    const corpo = letterale.slice(1, fine);
    const opzioni = letterale.slice(fine + 1);
    for (let i = 0; i < corpo.length - 1; i += 1) {
      if (corpo[i] !== '\\' || corpo[i + 1] !== 'n' || sfuggito(corpo, i)) continue;
      if (TESTO_PRIMA.test(corpo.slice(0, i))) motivi.add('una regex con un «a capo» in mezzo (usa `\\s+`, o `\\r?\\n`)');
    }
    if (!opzioni.includes('m')) continue;
    for (let i = 0; i < corpo.length; i += 1) {
      if (corpo[i] !== '$' || sfuggito(corpo, i)) continue;
      if (TESTO_PRIMA.test(corpo.slice(0, i))) motivi.add('un `$` di fine riga in una regex multiriga (il `\\r` sta prima: era il #565)');
    }
  }
  return [...motivi];
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

// Le estensioni che NON sono testo. `text=auto` indovina guardando i primi
// byte e su un PDF sbaglia: senza una riga che lo dichiari, il giorno in cui un
// documento di prova contiene un `\r\n` quel byte viene riscritto al
// salvataggio e il file arriva rotto a chi lo legge.
const NON_TESTO = /\.(pdf|png|jpe?g|gif|ico|icns|dmg|zip|woff2?|ttf|otf|mp3|mp4|webm)$/i;

test('i file che non sono testo sono DICHIARATI tali, non lasciati indovinare', () => {
  let righe;
  try {
    righe = execFileSync('git', ['ls-files', '--eol'], { cwd: ROOT, encoding: 'utf8' });
  } catch (_) {
    return; // fuori da un deposito git non c'è niente da controllare
  }
  const indovinati = [];
  for (const riga of normalizzaFiniRiga(righe).split('\n')) {
    if (!riga.trim()) continue;
    const [attributi, nome] = riga.split('\t');
    if (!nome || !NON_TESTO.test(nome.trim())) continue;
    if (!/(^|\s)attr\/(.*\s)?-text(\s|$)/.test(attributi)) indovinati.push(nome.trim());
  }
  assert.deepEqual(
    indovinati,
    [],
    'questi file non sono testo ma nessuna riga di .gitattributes lo dice: `text=auto` lo indovina dai primi '
    + 'byte, e su un PDF sbaglia — aggiungi `*.<estensione> -text`',
  );
});

test('il lettore normalizza davvero CRLF e CR soli', () => {
  assert.equal(normalizzaFiniRiga('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(normalizzaFiniRiga('a\rb'), 'a\nb'); // vecchio Mac
  assert.equal(normalizzaFiniRiga('a\nb'), 'a\nb'); // già a posto: invariato
  // Il file letto dal disco esce senza nessun ritorno a capo di Windows.
  assert.ok(!leggiTestoRepo(join(ROOT, 'firestore.rules')).includes('\r'));
});

test('le due reti riconoscono le forme che un CRLF rompe, e lasciano stare le altre', () => {
  // La lettura vale in tutte le forme che leggono davvero dal disco.
  assert.ok(LETTURA_GREZZA.test("const r = readFileSync(PERCORSO, 'utf8');"));
  assert.ok(LETTURA_GREZZA.test("const r = await readFile(PERCORSO, 'utf8');"));
  assert.ok(LETTURA_GREZZA.test("const r = await fs.promises.readFile(PERCORSO, 'utf8');"));
  assert.ok(!LETTURA_GREZZA.test('const r = leggiTestoRepo(PERCORSO);'));

  // Taratura: senza questa prova le reti potrebbero non riconoscere più niente
  // e la sentinella resterebbe verde per sempre. Sono le forme con cui il
  // difetto si è presentato davvero (#565 e #569).
  assert.deepEqual(ricercheFragili("RULES.indexOf('allow update: if\\n        isAdmin()')").length, 1);
  assert.deepEqual(ricercheFragili("RULES.replace('if\\n   isAdmin()', 'x')").length, 1);
  assert.deepEqual(ricercheFragili('/allow update: if\\n        isAdmin\\(\\)/.test(RULES)').length, 1);
  assert.deepEqual(ricercheFragili('RULES.match(/^ *allow read: if true;$/m)').length, 1);
  // E quello che invece regge un CRLF non va segnalato, o la sentinella diventa
  // rumore e la si spegne.
  assert.deepEqual(ricercheFragili('testo.split(/\\r?\\n/)'), []);
  assert.deepEqual(ricercheFragili('testo.replace(/\\n/g, "\\r\\n")'), []);
  assert.deepEqual(ricercheFragili('/\\n\\s*allow /.exec(resto)'), []);
  assert.deepEqual(ricercheFragili('/function\\s+tipoPassivo\\(\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}/'), []);
  assert.deepEqual(ricercheFragili('/^\\s*Giudici\\s*$/m'), []);
});

test('un file del repo che una sentinella analizza si legge dalla porta, non a mano', () => {
  // Le prove dei giri di verifica passati sono memoria congelata: non si
  // riscrivono, quindi questa regola di stile non le riguarda. Il difetto vero
  // (la ricerca che un CRLF rompe) le riguarda eccome, ed è il controllo
  // qui sotto, che infatti scende anche lì.
  const colpevoli = [];
  for (const percorso of tuttiIFileDiTest(CARTELLA_TEST)) {
    const rel = relative(ROOT, percorso).replace(/\\/g, '/');
    if (rel === 'tests/unit/finiDiRiga.test.mjs') continue; // qui la lettura grezza serve a leggere i test stessi
    if (rel.startsWith('tests/verifica/')) continue;
    const sorgente = readFileSync(percorso, 'utf8');
    const variabili = variabiliColPercorso(sorgente);
    sorgente.split(/\r?\n/).forEach((riga, i) => {
      if (!LETTURA_GREZZA.test(riga)) return;
      if (ESEMPIO_VOLUTO.test(riga) || NON_ANALIZZATO.test(riga)) return;
      const nominaIlFile = FILE_ANALIZZATI.test(riga);
      const passaPerVariabile = [...variabili].some((v) => new RegExp(`readFile(?:Sync)?\\s*\\(\\s*${v}\\b`).test(riga));
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

test('nessuna ricerca su un file del repo si rompe con i fini riga di Windows', () => {
  // `indexOf('…if\n        isAdmin()')` è la forma che si è rotta per prima, ma
  // la stessa ricerca scritta come regex, come `replace` o con un `$` di fine
  // riga in modalità multiriga si rompe uguale: chiuderne una sola sarebbe
  // chiudere la porta e lasciare aperta quella accanto, che è come questo
  // difetto è già tornato due volte.
  //
  // Si guardano SOLO i test che leggono uno di quei file. Altrove una stringa
  // con un «a capo» dentro è di solito un testo che il test si è costruito da
  // sé (una critica, un prompt), dove i fini riga li decide il codice e non il
  // checkout: segnalarla sarebbe rumore, e il rumore fa spegnere le sentinelle.
  const colpevoli = [];
  for (const percorso of tuttiIFileDiTest(CARTELLA_TEST)) {
    const rel = relative(ROOT, percorso).replace(/\\/g, '/');
    if (rel === 'tests/unit/finiDiRiga.test.mjs') continue; // le forme qui sopra si nominano da sé
    const sorgente = leggiTestoRepo(percorso);
    if (!FILE_ANALIZZATI.test(sorgente)) continue;
    sorgente.split('\n').forEach((riga, i) => {
      if (ESEMPIO_VOLUTO.test(riga)) return;
      const motivi = ricercheFragili(riga);
      if (motivi.length) colpevoli.push(`${rel}:${i + 1}: ${motivi.join(' + ')} → ${riga.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    colpevoli,
    [],
    'una ricerca così non regge un checkout con CRLF: usa `\\s+` (o `\\r?\\n`) al posto di un «a capo» nudo, '
    + 'e normalizza il testo con leggiTestoRepo() — è il difetto del #569, e il `$` multiriga era il #565',
  );
});
