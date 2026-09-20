// Dove stanno le prove dei giri di verifica, e cosa non devono contenere.
// Non deve fermare: guarda i file del repo, senza aprire Filo.
// La regola narrata: CLAUDE.md § Verifica, e patterns/prove-di-un-giro-fuori-dalla-suite.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Anche i file non ancora committati: chi scrive una prova nel posto sbagliato
// deve trovarla rossa subito, non al primo salvataggio automatico.
function nelRepo(sotto = '') {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', ...(sotto ? [sotto] : [])], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26,
  });
  return [...new Set(out.split('\0').filter(Boolean).map((f) => f.replace(/\\/g, '/')))];
}

// I nomi con cui chi verifica ha battezzato le sue prove usa-e-getta, giro dopo
// giro. È un elenco osservato, non una legge: se ne nasce uno nuovo si aggiunge
// qui, e il messaggio sotto dice a chi lo incontra che cosa farne.
const MARCATORI = ['verify-', 'verifier-', 'vcheck-', 'vfx-', 'vtmp-', 'tmp-', 'giro', '_verify', '_vcheck'];

test('una prova di un giro di verifica non sta nella suite: sta in tests/verifica/<numero>/', () => {
  const fuoriposto = nelRepo('tests').filter((f) => {
    if (!f.endsWith('.spec.mjs')) return false;
    if (f.startsWith('tests/verifica/')) return false;
    const nome = posix.basename(f);
    return MARCATORI.some((m) => nome.startsWith(m));
  });
  assert.deepEqual(fuoriposto, [],
    'Queste prove nascono per controllare UN fix e poi restano: ogni spec riapre Filo, e la suite'
    + ' completa si allunga di minuti a ogni giro. Spostale in tests/verifica/<numero>/ (git mv, e gli'
    + ' import relativi risalgono di due cartelle: ../../fixtures/…). Se è tua e l\'hai appena scritta,'
    + ' questo rosso non è una regressione del ramo: è il posto sbagliato.');
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

// Un byte NUL crudo dentro un sorgente fa trattare il file come BINARIO a git:
// niente diff leggibile, niente revisione. Il carattere si prova lo stesso.
test('nessun sorgente del repo contiene un byte NUL crudo', () => {
  const SORGENTI = /\.(mjs|js|cjs|json|md|html|css|txt|sh|yml|yaml)$/;
  const colpevoli = nelRepo().filter((f) => SORGENTI.test(f) && readFileSync(resolve(ROOT, f)).includes(0));
  assert.deepEqual(colpevoli, [],
    'scrivilo come sequenza di escape (\'\\u0000\') invece che come byte: per JavaScript è lo stesso'
    + ' carattere, e il file resta testo.');
});

// Una prova che non si carica è peggio di una prova assente: il rosso sembra
// del ramo. Ventitré prove di giri passati importavano ./fixtures da una
// sottocartella dove quel percorso non esiste, e non se n'era accorto nessuno.
test('ogni import relativo di uno spec o di un unit test punta a un file che esiste', () => {
  const rotti = [];
  for (const f of nelRepo('tests')) {
    if (!/\.(spec|test)\.mjs$/.test(f)) continue;
    const src = readFileSync(resolve(ROOT, f), 'utf8');
    for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.[^'"]*)['"]/g)) {
      if (!existsSync(resolve(ROOT, dirname(f), m[1]))) rotti.push(`${f} → ${m[1]}`);
    }
  }
  assert.deepEqual(rotti, [], 'un import che non risolve fa morire lo spec alla prima riga');
});
