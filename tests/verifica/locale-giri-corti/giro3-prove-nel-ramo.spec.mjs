// Prove del giro 3 (verifica locale) sul lavoro «giri corti».
//
// Non aprono Filo, e non è una scorciatoia: qui non c'è una schermata da
// ripercorrere. Quello che c'è da provare è il MECCANISMO del giro — dove
// restano le prove, che la suite di default non se le porti dietro, che chi
// corregge si senta dire di rilanciarle, e che un verdetto non si registri con
// file fuori dai commit. Restano nel ramo: sono la memoria di questo giro.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function ignorato(percorso) {
  try {
    execFileSync('git', ['check-ignore', '-q', percorso], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

/** Quante regole di esclusione applica la config in queste condizioni. */
function testIgnoreLen({ env = {}, args = [] } = {}) {
  const src = `import cfg from ${JSON.stringify(new URL('file:///' + resolve(ROOT, 'playwright.config.js').replace(/\\/g, '/')).href)};`
    + 'console.log("REGOLE=" + (Array.isArray(cfg.testIgnore) ? cfg.testIgnore.length : 1));';
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', src, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, FILO_TEST_VERIFICA: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const m = /REGOLE=(\d+)/.exec(String(out));
  expect(m, `la config non ha risposto: ${String(out).slice(0, 200)}`).not.toBeNull();
  return Number(m[1]);
}

test('#giri-corti — una prova del giro non viene scartata dal repo, nemmeno col nome vecchio', () => {
  for (const p of [
    'tests/verifica/495/giro1-conteggi-sezioni.spec.mjs',
    'tests/verifica/locale-giri-corti/giro3-prove-nel-ramo.spec.mjs',
    'tests/_verify-qualcosa.spec.mjs',
    'tests/_vcheck-altro.spec.mjs',
    'tests/verifica/495/_verify-dentro.spec.mjs',
  ]) {
    expect(ignorato(p), `${p} non deve essere escluso dal repo`).toBe(false);
  }
  // Le spec usa-e-getta degli audit invece restano escluse: quelle asseriscono
  // che un difetto ESISTE, e diventano rosse appena viene chiuso.
  expect(ignorato('tests/_audit-x.spec.mjs')).toBe(true);
});

test('#giri-corti — la suite di default non raccoglie le prove dei giri, ma nominarle le raccoglie', () => {
  expect(testIgnoreLen()).toBe(1);
  expect(testIgnoreLen({ env: { FILO_TEST_VERIFICA: '1' } })).toBe(0);
  expect(testIgnoreLen({ args: ['tests/verifica/495'] })).toBe(0);
  expect(testIgnoreLen({ args: ['tests\\verifica\\495'] })).toBe(0);
});

test('#giri-corti — le prove di un giro passato si lanciano per cartella e vengono trovate', () => {
  const out = execFileSync('npx', ['playwright', 'test', 'tests/verifica/495', '--list'], {
    cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32',
  });
  expect(out).toContain('giro1-conteggi-sezioni.spec.mjs');
  expect(out).toMatch(/Total: \d+ tests/);
});

test('#giri-corti — chi verifica in locale riceve una cartella per le prove, ricavata dal ramo', async () => {
  const m = await import(new URL('file:///' + resolve(ROOT, 'scripts/verify-local.mjs').replace(/\\/g, '/')).href);
  expect(m.cartellaProveGiro('claude/giri-corti')).toBe('tests/verifica/locale-giri-corti');
  // Lo stesso ramo dà sempre la stessa cartella: è così che i giri si ritrovano.
  expect(m.cartellaProveGiro('claude/giri-corti')).toBe(m.cartellaProveGiro('claude/giri-corti'));
  // Una lettera accentata resta una lettera.
  expect(m.cartellaProveGiro('claude/però-così')).toBe('tests/verifica/locale-pero-cosi');
  const brief = m.buildVerifierBrief({ request: 'x', branch: 'claude/giri-corti', recipe: '', history: [] });
  expect(brief).toContain('tests/verifica/locale-giri-corti');
  // E l'isolamento resta: mai il diff né il report di chi ha lavorato.
  expect(brief).toContain('niente report o note di chi ha lavorato');
});

test('#giri-corti — la fase 2 dice a chi corregge di rilanciare le prove prima di consegnare', async () => {
  const m = await import(new URL('file:///' + resolve(ROOT, 'scripts/verify-local.mjs').replace(/\\/g, '/')).href);
  const coda = m.codaText({
    findings: [{ level: 2, text: 'un rilievo' }], derived: [], budgets: null,
    branch: 'claude/giri-corti', instructions: '',
  });
  expect(coda).toContain('npx playwright test tests/verifica/locale-giri-corti');
  expect(coda).toMatch(/rilancia le prove del giro/i);
});

test('#giri-corti — un verdetto non si registra con file fuori dai commit, su tutte e tre le porte', async () => {
  const d = await import(new URL('file:///' + resolve(ROOT, 'scripts/lib/dirty-tree.mjs').replace(/\\/g, '/')).href);
  // I nomi arrivano leggibili anche con spazi e lettere accentate.
  expect(d.dirtyTreeLines('?? "prova però con spazi.txt"\n M src/a.js\n'))
    .toEqual(['prova però con spazi.txt', 'src/a.js']);
  for (const porta of ['critica', 'consegna', 'revisione']) {
    const t = d.dirtyTreeText(['prova però.txt'], porta);
    expect(t, `porta ${porta}: deve elencare il file rimasto fuori`).toContain('prova però.txt');
    expect(t, `porta ${porta}: deve dire che il salvataggio automatico non arriva da solo`)
      .toMatch(/non arriva da solo/);
  }
});

test('#giri-corti — le istruzioni dei ruoli dicono a chi corregge di rilanciare le prove del giro', () => {
  const verifier = readFileSync(resolve(ROOT, 'routines/roles/verifier.md'), 'utf8');
  expect(verifier).toMatch(/rilancia le prove del giro/i);
  expect(verifier).toContain('npx playwright test tests/verifica/');
  const resolver = readFileSync(resolve(ROOT, 'routines/roles/resolver.md'), 'utf8');
  expect(resolver).toContain('tests/verifica/');
  // Chi risolve non deve inventarsi una prova che apre Filo quando non c'è
  // niente da aprire: il rimando è ai minimi del repo.
  expect(resolver).toMatch(/CLAUDE\.md § Verifica/);
});
