// Prove del giro 4 (verifica locale) sul lavoro «giri corti».
//
// Il giro 3 aveva chiuso le porte sulle prove DEL VERIFICATORE. Qui si guarda
// l'altra metà: la prova che si scrive CHI RISOLVE, prima di consegnare. Quella
// non è la memoria di un giro, è la guardia contro il ritorno del difetto: deve
// finire dove la suite la rilancia per sempre. Se finisce nella cartella del
// giro, la suite non la raccoglie più — nemmeno dopo la fusione — e la guardia
// non esiste.
//
// Non aprono Filo: qui non c'è una schermata, c'è il meccanismo del giro.
// Restano nel ramo: sono la memoria di questo giro.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const leggi = (p) => readFileSync(resolve(ROOT, p), 'utf8');

/**
 * Le regole di esclusione della suite DI DEFAULT (niente manopola, niente
 * cartella nominata sulla riga di comando): vanno chieste a un processo a
 * parte, perché qui dentro la riga di comando nomina già tests/verifica.
 */
function regoleEsclusioneDefault() {
  const cfg = new URL('file:///' + resolve(ROOT, 'playwright.config.js').replace(/\\/g, '/')).href;
  const src = `import cfg from ${JSON.stringify(cfg)};`
    + 'const l = Array.isArray(cfg.testIgnore) ? cfg.testIgnore : [cfg.testIgnore];'
    + 'console.log("REGOLE=" + JSON.stringify(l.filter(Boolean).map((r) => r.source)));';
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', src], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, FILO_TEST_VERIFICA: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const m = /REGOLE=(\[.*\])/.exec(String(out));
  expect(m, `la config non ha risposto: ${String(out).slice(0, 300)}`).not.toBeNull();
  return JSON.parse(m[1]).map((s) => new RegExp(s));
}

/** La suite di default raccoglie una spec che sta in questo percorso? */
function raccoltaDallaSuite(percorso, regole) {
  const p = `/${percorso.replace(/\\/g, '/')}`;
  return !regole.some((r) => r.test(p) || r.test(p.replace(/\//g, '\\')));
}

test('#giri-corti — la cartella del giro resta fuori dalla suite di default (com\'è stato deciso)', () => {
  const regole = regoleEsclusioneDefault();
  expect(raccoltaDallaSuite('tests/verifica/495/giro1-conteggi-sezioni.spec.mjs', regole)).toBe(false);
  expect(raccoltaDallaSuite('tests/verifica/locale-giri-corti/giro4-prova-di-chi-risolve.spec.mjs', regole)).toBe(false);
  // Una spec normale invece la suite la raccoglie: è il metro dell'altro test.
  expect(raccoltaDallaSuite('tests/wheel-zoom.spec.mjs', regole)).toBe(true);
});

test('#giri-corti — la prova che scrive chi risolve finisce dove la suite la rilancia per sempre', () => {
  const regole = regoleEsclusioneDefault();
  const resolver = leggi('routines/roles/resolver.md');
  // Tutti i percorsi di spec che le istruzioni di chi risolve indicano come
  // POSTO DOVE SCRIVERE la propria prova (non quelli che dice solo di
  // rilanciare): li si riconosce dal nome di file.
  const dove = [...resolver.matchAll(/`?(tests\/[^\s`)]+\.spec\.mjs)`?/g)].map((m) => m[1]);
  expect(dove.length, 'le istruzioni di chi risolve devono dire dove va la sua prova').toBeGreaterThan(0);
  for (const p of dove) {
    expect(
      raccoltaDallaSuite(p, regole),
      `chi risolve è mandato a scrivere la sua prova in ${p}, che la suite completa non raccoglie: `
      + 'la guardia contro il ritorno del difetto non girerebbe mai più, nemmeno dopo la fusione',
    ).toBe(true);
  }
});

test('#giri-corti — le regole generali del repo e quelle di chi risolve dicono lo stesso posto', () => {
  const claude = leggi('CLAUDE.md');
  const regole = regoleEsclusioneDefault();
  // I minimi del repo mandano la spec di un fix in tests/<feature>.spec.mjs:
  // un posto che la suite raccoglie. Se un ruolo la sposta altrove, i due
  // documenti divergono e chi legge il ruolo perde la guardia senza saperlo.
  const minimi = [...claude.matchAll(/`npx playwright test (tests\/[^\s`]+)`/g)].map((m) => m[1]);
  const perIlFix = minimi.filter((p) => p.endsWith('.spec.mjs'));
  expect(perIlFix.length, 'i minimi del repo devono dire dove va la spec di un fix').toBeGreaterThan(0);
  for (const p of perIlFix) {
    expect(raccoltaDallaSuite(p.replace('<feature>', 'qualcosa'), regole)).toBe(true);
  }
});
