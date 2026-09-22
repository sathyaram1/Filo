// Dove stanno le prove dei giri di verifica, e cosa non devono contenere.
// Non deve fermare: guarda i file del repo, senza aprire Filo.
// La regola narrata sta in CLAUDE.md § Verifica; qui è quella verificabile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importRelativi, asserisceQualcosa, siDichiaraTemporanea, scorri } from '../helpers/proveDeiGiri.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Anche i file non ancora committati: chi scrive una prova nel posto sbagliato
// deve trovarla rossa subito, non al primo salvataggio automatico.
function nelRepo(sotto = '') {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...(sotto ? [sotto] : [])], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  return [...new Set(out.split('\0').filter(Boolean).map((f) => f.replace(/\\/g, '/')))];
}

// Gli spec che la suite completa raccoglie davvero: tutto tests/ tranne la
// memoria dei giri, che playwright.config.js tiene fuori di proposito.
function specDellaSuite() {
  return nelRepo('tests').filter((f) => f.endsWith('.spec.mjs') && !f.startsWith('tests/verifica/'));
}

const RIMEDIO = 'Spostala in tests/verifica/<numero>/ (git mv, e gli import relativi risalgono di due'
  + ' cartelle: ../../fixtures/…), oppure cancellala se era solo esplorazione. Se invece è copertura'
  + ' vera di una funzione, falla smettere di dichiararsi di passaggio e dalle un nome della funzione.';

// I nomi con cui chi verifica ha battezzato le sue prove, giro dopo giro: un
// elenco osservato, non una legge — le due regole qui sotto non ci dipendono.
const MARCATORI = ['verify-', 'verifier-', 'vcheck-', 'vfx-', 'vtmp-', 'tmp-', 'giro', '_verify', '_vcheck'];

test('una prova di un giro di verifica non sta nella suite: sta in tests/verifica/<numero>/', () => {
  const fuoriposto = specDellaSuite().filter((f) => MARCATORI.some((m) => posix.basename(f).startsWith(m)));
  assert.deepEqual(fuoriposto, [],
    'Queste prove nascono per controllare UN fix e poi restano: ogni spec riapre Filo, e la suite'
    + ` completa si allunga di minuti a ogni giro. ${RIMEDIO} Se è tua e l'hai appena scritta,`
    + ' questo rosso non è una regressione del ramo: è il posto sbagliato.');
});

// Le due regole che NON guardano il nome. Il nome è l'unica cosa che chi scrive
// può battezzare a modo suo; una prova di passaggio invece si tradisce da sé.
test('nessuno spec della suite si dichiara di passaggio nella sua intestazione', () => {
  const temporanei = specDellaSuite().filter((f) => siDichiaraTemporanea(readFileSync(resolve(ROOT, f), 'utf8')));
  assert.deepEqual(temporanei, [],
    `Dice di sé che è di passaggio, e intanto riapre Filo a ogni corsa della suite completa. ${RIMEDIO}`);
});

test('ogni spec della suite contiene almeno un controllo: nessuno è solo esplorazione', () => {
  const muti = specDellaSuite().filter((f) => !asserisceQualcosa(readFileSync(resolve(ROOT, f), 'utf8')));
  assert.deepEqual(muti, [],
    'Una prova senza controlli non può diventare rossa in nessun caso: riapre Filo, stampa qualcosa'
    + ` e basta. ${RIMEDIO}`);
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

// Le prove di un giro sono la memoria di quel giro: il giro dopo le rilancia
// nominando il numero della segnalazione, e una cartella senza numero è persa.
test('ogni cartella di prove di un giro porta il numero che la farà ritrovare', () => {
  const cartelle = [...new Set(nelRepo('tests/verifica')
    .map((f) => f.split('/')[2]).filter(Boolean))];
  const senzaNome = cartelle.filter((c) => !/^\d+$/.test(c) && !c.startsWith('locale-'));
  assert.deepEqual(senzaNome, [],
    'chi verifica il giro dopo nomina il numero della segnalazione: da una cartella che nessun numero'
    + ' nomina non riapre niente, e rifà da capo le porte già chiuse una volta');
});

// Un byte NUL crudo dentro un sorgente fa trattare il file come BINARIO a git:
// niente diff leggibile, niente revisione, e una fusione che si ferma a mano.
test('nessun sorgente del repo contiene un byte NUL crudo', () => {
  const SORGENTI = /\.(mjs|js|cjs|json|md|html|css|txt|sh|yml|yaml)$/;
  const colpevoli = nelRepo().filter((f) => SORGENTI.test(f) && readFileSync(resolve(ROOT, f)).includes(0));
  assert.deepEqual(colpevoli, [],
    'scrivilo come sequenza di escape (\'\\u0000\') invece che come byte: per JavaScript è lo stesso'
    + ' carattere, e il file resta testo.');
});

// Una prova che non si carica è peggio di una prova assente: il rosso sembra del
// ramo. Ventitré importavano ./fixtures da una cartella dove quel percorso non c'è.
test('ogni import relativo di uno spec o di un unit test punta a un file che esiste', () => {
  const rotti = [];
  for (const f of nelRepo('tests')) {
    if (!/\.(spec|test)\.mjs$/.test(f)) continue;
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

test('la dichiarazione di passaggio si legge solo nell\'intestazione', () => {
  assert.equal(siDichiaraTemporanea('// AUDIT (routine, throwaway): esercita la pagina.\nimport x from "y";'), true);
  assert.equal(siDichiaraTemporanea('// TEMP audit spec. Delete after.\n'), true);
  assert.equal(siDichiaraTemporanea('// Prova vera della funzione.\nconst nota = "questa riga è temporanea";'), false);
});

test('lo scorrimento non perde né inventa pezzi di codice', () => {
  const { codice, stringhe } = scorri("const a = 'uno'; // due\nconst b = `tre`;");
  assert.equal(stringhe.map((s) => s.testo).join('|'), 'uno|tre');
  assert.equal(codice.includes('due'), false);
});
