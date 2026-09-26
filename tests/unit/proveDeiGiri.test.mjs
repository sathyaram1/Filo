// Dove stanno le prove dei giri di verifica, e cosa non devono contenere.
// Non deve fermare: guarda i file del repo, senza aprire Filo.
// La regola narrata sta in patterns/le-prove-di-un-giro-stanno-nel-ramo-e-la-cartella-si-svuota.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importRelativi, asserisceQualcosa, siDichiaraTemporanea, scorri } from '../helpers/proveDeiGiri.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Il raccoglitore si legge una volta sola, all'import: qui si guarda il caso
// normale, non quello in cui chi lancia ha chiesto anche la memoria dei giri.
delete process.env.FILO_TEST_VERIFICA;

// Anche i file non ancora committati: chi scrive una prova nel posto sbagliato
// deve trovarla rossa subito, non al primo salvataggio automatico.
function nelRepo(sotto = '') {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...(sotto ? [sotto] : [])], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  return [...new Set(out.split('\0').filter(Boolean).map((f) => f.replace(/\\/g, '/')))];
}

// Le regole del raccoglitore si riusano tali e quali: un elenco di estensioni
// riscritto qui lascia fuori il file battezzato in un modo non previsto.
let cfgCache;
async function configRaccoglitore() {
  if (!cfgCache) {
    const href = new URL(`file://${resolve(ROOT, 'playwright.config.js').replace(/\\/g, '/')}`).href;
    cfgCache = (await import(href)).default;
  }
  return cfgCache;
}

const regexDi = (v) => (Array.isArray(v) ? v : [v]).filter((r) => r instanceof RegExp);
const combacia = (r, s) => { r.lastIndex = 0; return r.test(s); };

async function appartieneAllaSuite() {
  const cfg = await configRaccoglitore();
  const radice = ROOT.replace(/\\/g, '/');
  const dir = `${resolve(ROOT, cfg.testDir || '.').replace(/\\/g, '/')}/`;
  const match = regexDi(cfg.testMatch);
  const ignora = regexDi(cfg.testIgnore);
  assert.ok(match.length, 'il raccoglitore non dice più con quali nomi riconosce una prova: senza quello'
    + ' questa sentinella guarderebbe il vuoto e passerebbe sempre');
  return (relativo) => {
    const assoluto = `${radice}/${relativo}`;
    return assoluto.startsWith(dir) && match.some((r) => combacia(r, assoluto))
      && !ignora.some((r) => combacia(r, assoluto));
  };
}

async function specDellaSuite() {
  const dentro = await appartieneAllaSuite();
  const fuori = nelRepo('tests').filter(dentro);
  assert.ok(fuori.length, 'nessuna prova raccolta: la sentinella si sta guardando allo specchio');
  return fuori;
}

const RIMEDIO = 'Spostala in tests/verifica/<numero>/ (git mv, e gli import relativi risalgono di due'
  + ' cartelle: ../../fixtures/…), oppure cancellala se era solo esplorazione. Se invece è copertura'
  + ' vera di una funzione, falla smettere di dichiararsi di passaggio e dalle un nome della funzione.';

// I nomi con cui chi verifica ha battezzato le sue prove, giro dopo giro: un
// elenco osservato, non una legge — le due regole qui sotto non ci dipendono.
const MARCATORI = ['verify-', 'verifier-', 'vcheck-', 'vfx-', 'vtmp-', 'tmp-', 'giro', '_verify', '_vcheck'];

test('una prova di un giro di verifica non sta nella suite: sta in tests/verifica/<numero>/', async () => {
  const fuoriposto = (await specDellaSuite()).filter((f) => MARCATORI.some((m) => posix.basename(f).startsWith(m)));
  assert.deepEqual(fuoriposto, [],
    'Queste prove nascono per controllare UN fix e poi restano: ogni spec riapre Filo, e la suite'
    + ` completa si allunga di minuti a ogni giro. ${RIMEDIO} Se è tua e l'hai appena scritta,`
    + ' questo rosso non è una regressione del ramo: è il posto sbagliato.');
});

// Le due regole che NON guardano il nome. Il nome è l'unica cosa che chi scrive
// può battezzare a modo suo; una prova di passaggio invece si tradisce da sé.
test('nessuno spec della suite si dichiara di passaggio nella sua intestazione', async () => {
  const temporanei = (await specDellaSuite()).filter((f) => siDichiaraTemporanea(readFileSync(resolve(ROOT, f), 'utf8')));
  assert.deepEqual(temporanei, [],
    `Dice di sé che è di passaggio, e intanto riapre Filo a ogni corsa della suite completa. ${RIMEDIO}`);
});

test('ogni spec della suite contiene almeno un controllo: nessuno è solo esplorazione', async () => {
  const muti = (await specDellaSuite()).filter((f) => !asserisceQualcosa(readFileSync(resolve(ROOT, f), 'utf8')));
  assert.deepEqual(muti, [],
    'Una prova senza controlli non può diventare rossa in nessun caso: riapre Filo, stampa qualcosa'
    + ` e basta. ${RIMEDIO}`);
});

test('quello che la sentinella chiama suite è quello che il raccoglitore lancia', async () => {
  const dentro = await appartieneAllaSuite();
  assert.equal(dentro('tests/boot.spec.js'), true,
    'il raccoglitore lancia anche questa forma: se la sentinella non la guarda, battezzare così una'
    + ' prova di passaggio basta a farla restare nella suite per sempre');
  assert.equal(dentro('tests/boot.spec.mjs'), true);
  assert.equal(dentro('tests/verifica/510/giro1-x.spec.mjs'), false, 'la memoria dei giri sta fuori');
  assert.equal(dentro('tests/helpers/scala.mjs'), false, 'un aiuto non è una prova');
});

test('la suite di default non raccoglie le prove dei giri', async () => {
  // Il filtro si spegne di proposito quando la cartella è nominata sulla riga
  // di comando o con FILO_TEST_VERIFICA=1: qui si guarda il caso normale.
  delete process.env.FILO_TEST_VERIFICA;
  const cfg = (await import(new URL(`file://${resolve(ROOT, 'playwright.config.js').replace(/\\/g, '/')}`).href)).default;
  const regole = Array.isArray(cfg.testIgnore) ? cfg.testIgnore : [cfg.testIgnore];
  // Playwright confronta il percorso INTERO del file, non quello dalla radice.
  const dentro = `${ROOT}/tests/verifica/495/giro1-x.spec.mjs`;
  assert.ok(regole.some((r) => r instanceof RegExp && r.test(dentro)),
    'senza questa esclusione le prove di ogni giro passato rientrerebbero nella suite completa, e la'
    + ' pulizia del #510 si disferebbe da sola');
  assert.ok(!regole.some((r) => r instanceof RegExp && r.test(`${ROOT}/tests/boot.spec.mjs`)),
    'l\'esclusione deve valere solo per tests/verifica/');
});

// Nominando la cartella l'esclusione si spegne, e decide solo testMatch: chiesto al raccoglitore.
test('ogni prova di un giro ha un nome che il raccoglitore raccoglie', async () => {
  const cfg = await configRaccoglitore();
  const dir = `${resolve(ROOT, cfg.testDir || '.').replace(/\\/g, '/')}/`;
  const raccolta = (rel) => {
    const assoluto = `${ROOT.replace(/\\/g, '/')}/${rel}`;
    return assoluto.startsWith(dir) && regexDi(cfg.testMatch).some((r) => combacia(r, assoluto));
  };
  const perse = nelRepo('tests/verifica')
    .filter((f) => /\.(m?js|cjs)$/.test(f) && !raccolta(f))
    .filter((f) => registraProve(readFileSync(resolve(ROOT, f), 'utf8')));
  assert.deepEqual(perse.map((f) => `${f} → ${f.replace(/(\.test)?\.(mjs|cjs|js)$/, '.spec.mjs')}`), [],
    '`npx playwright test tests/verifica/<numero>` raccoglie solo i file *.spec.mjs: queste prove non'
    + ' girerebbero mai, e sparirebbero in silenzio. Rinominale come indicato (git mv).');
});

test('il riconoscitore distingue una prova da un aiuto e da uno script', () => {
  assert.equal(registraProve("import { test, expect } from '../../fixtures/electron.mjs';\ntest('x', async () => {});"), true);
  assert.equal(registraProve("import { test } from 'node:test';\ntest.describe('y', () => {});"), true);
  assert.equal(registraProve("import { expect } from '../../fixtures/electron.mjs';\nexport function aiuto() {}"), false);
  assert.equal(registraProve("// test('commentato')\nconst s = \"test('in stringa')\";\nawait prova();"), false);
});

// Le prove di un giro sono la memoria di quel giro: il giro dopo le rilancia
// nominando il numero della segnalazione, e una cartella senza numero è persa.
test('ogni cartella di prove di un giro porta il numero che la farà ritrovare', () => {
  const cartelle = [...new Set(nelRepo('tests/verifica')
    .map((f) => f.split('/')[2]).filter(Boolean))];
  const senzaNome = cartelle.filter((c) => !/^\d+(\.\d+)*$/.test(c) && !c.startsWith('locale-'));
  assert.deepEqual(senzaNome, [],
    'chi verifica il giro dopo nomina il numero della segnalazione: da una cartella che nessun numero'
    + ' nomina non riapre niente, e rifà da capo le porte già chiuse una volta');
});

// Chi deve decidere se vale la pena ripulire ancora parte dal numero scritto
// nei documenti: se resta indietro, decide su una suite che non esiste più.
test('ogni documento che dichiara quanto è grande la suite dice il numero vero', async () => {
  const vero = (await specDellaSuite()).length;
  const sbagliati = [];
  const casi = new Set();
  for (const doc of ['CLAUDE.md', 'README.md']) {
    const testo = readFileSync(resolve(ROOT, doc), 'utf8');
    for (const m of testo.matchAll(/~\s*([\d.]+)\s+spec/g)) {
      const dichiarato = Number(m[1].replace(/\./g, ''));
      if (Math.abs(vero - dichiarato) / vero >= 0.05) sbagliati.push(`${doc}: ~${m[1]} spec`);
    }
    for (const m of testo.matchAll(/~\s*([\d.]+)\s+casi/g)) casi.add(m[1]);
  }
  assert.deepEqual(sbagliati, [],
    `la suite raccoglie ${vero} file di prove: un documento che ne dichiara molti di più nasconde il`
    + ' tempo che la pulizia ha restituito, e il prossimo che deve decidere parte da un numero vecchio');
  assert.ok(casi.size <= 1,
    `i documenti non dicono lo stesso numero di casi (${[...casi].join(', ')}): correggerne uno solo è`
    + ' come non correggerne nessuno');
});

// Quali file NASCONO testo lo dicono le regole del repo, non un elenco di
// estensioni scritto qui: si guarda l'attributo dichiarato, non l'esito.
function fileDiTesto() {
  const out = execFileSync('git', ['ls-files', '--eol', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  return out.split('\n').filter(Boolean).map((r) => {
    const i = r.indexOf('\t');
    // L'esito (i/ e w/) diventa «-text» PROPRIO per il byte NUL che si cerca:
    // guardarlo vorrebbe dire scartare i colpevoli uno per uno.
    const dichiarato = (r.slice(0, i).split('attr/')[1] || '').trim();
    return { binario: /(^|\s)-text(\s|$)/.test(dichiarato), file: r.slice(i + 1) };
  }).filter((v) => !v.binario && existsSync(resolve(ROOT, v.file))).map((v) => v.file);
}

// Un byte NUL crudo dentro un sorgente fa trattare il file come BINARIO a git:
// niente diff leggibile, niente revisione, e una fusione che si ferma a mano.
test('nessun file di testo del repo contiene un byte NUL crudo', () => {
  const colpevoli = fileDiTesto().filter((f) => readFileSync(resolve(ROOT, f)).includes(0));
  assert.deepEqual(colpevoli, [],
    'scrivilo come sequenza di escape (\'\\u0000\') invece che come byte: per JavaScript è lo stesso'
    + ' carattere, e il file resta testo.');
});

// Una prova che non si carica è peggio di una prova assente: il rosso sembra del
// ramo. Ventitré importavano ./fixtures da una cartella dove quel percorso non c'è.
test('ogni import relativo di uno spec o di un unit test punta a un file che esiste', () => {
  const rotti = [];
  for (const f of nelRepo('tests')) {
    if (!/\.(spec|test)\.m?js$/.test(f)) continue;
    for (const p of importRelativi(readFileSync(resolve(ROOT, f), 'utf8'))) {
      if (!existsSync(resolve(ROOT, dirname(f), p))) rotti.push(`${f} → ${p}`);
    }
  }
  assert.deepEqual(rotti, [], 'un import che non risolve fa morire lo spec alla prima riga');
});

// Da qui in giù: il riconoscitore provato su sorgenti finti, perché una regola
// che sbaglia manda chi lavora a cercare un difetto che non c'è.
test('un import citato dentro una stringa non è un import', () => {
  const src = [
    "import { test } from './fixtures/electron.mjs';",
    'const finto = "import x from \'./non-esiste.mjs\';";',
    'const modello = `\nimport y from "./neanche-questo.mjs";\n`;',
  ].join('\n');
  assert.deepEqual(importRelativi(src), ['./fixtures/electron.mjs']);
});

test('un import vero si riconosce in tutte le forme che il repo usa', () => {
  const src = [
    "import { a } from '../helpers/scala.mjs';",
    "import './effetto.mjs';",
    "const m = await import('./tardi.mjs');",
    "import pkg from 'node:fs';",
  ].join('\n');
  assert.deepEqual(importRelativi(src), ['../helpers/scala.mjs', './effetto.mjs', './tardi.mjs']);
});

test('una espressione regolare con virgolette dentro non sfasa la lettura', () => {
  const src = ["const r = /['\"](\\.[^'\"]*)['\"]/g;", "import { x } from './vero.mjs';"].join('\n');
  assert.deepEqual(importRelativi(src), ['./vero.mjs']);
});

test('un controllo dentro un commento o una stringa non conta come controllo', () => {
  assert.equal(asserisceQualcosa('// expect(1).toBe(1)\nconst s = "expect(2).toBe(2)";\n'), false);
  assert.equal(asserisceQualcosa("test('x', () => { expect(1).toBe(1); });"), true);
  assert.equal(asserisceQualcosa("assert.deepEqual(a, b);"), true);
});

test('la dichiarazione di passaggio si legge solo dove un file dice cos\'è', () => {
  assert.equal(siDichiaraTemporanea('// AUDIT (routine, throwaway): esercita la pagina.\nimport x from "y";'), true);
  assert.equal(siDichiaraTemporanea('// TEMP audit spec. Delete after.\n'), true);
  assert.equal(siDichiaraTemporanea('// Prova vera.\nconst nota = "questa riga è temporanea";'), false);
  // Una prova vera che racconta un «cancella» dell'app non si sta descrivendo:
  // accusarla per quello fa cancellare copertura buona.
  assert.equal(siDichiaraTemporanea([
    '// Disegna su tutta la finestra di Filo.',
    '// Il bottone compare perché ora c\'è qualcosa da cancellare, e un solo',
    '// clic deve bastare a togliere il disegno temporaneo dalla barra.',
  ].join('\n')), false);
  // L'intestazione si legge intera: la guida ne concede tre righe, e chi si
  // dichiara di passaggio lo scrive dove gli viene, non sempre sulla prima.
  assert.equal(siDichiaraTemporanea([
    '// Controllo del pannello laterale.',
    '// Ricostruisce il caso segnalato e guarda cosa succede.',
    '// Prova usa-e-getta: va cancellata dopo il giro.',
  ].join('\n')), true);
  assert.equal(siDichiaraTemporanea('// Questa prova è temporanea: serve solo a guardare.'), true);
});

test('lo scorrimento non perde né inventa pezzi di codice', () => {
  const { codice, stringhe } = scorri("const a = 'uno'; // due\nconst b = `tre`;");
  assert.equal(stringhe.map((s) => s.testo).join('|'), 'uno|tre');
  assert.equal(codice.includes('due'), false);
});
