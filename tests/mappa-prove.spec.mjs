// La mappa prova → file (#2502) fatta da un avvio vero di Filo con la registrazione accesa, poi interrogata come la
// interroga chi lavora: una costante di modulo letta da una funzione eseguita, e un foglio di stile che la home carica.
// La logica sta in scripts/lib/mappaProve.mjs (tests/unit/mappaProve.test.mjs); qui il giro intero, Electron compreso.

import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { accendiCopertura } from '../scripts/lib/copertura-prove.mjs';
import { costruisciMappa, unisciRegistrazioni } from '../scripts/lib/mappaProve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUESTA = 'tests/mappa-prove.spec.mjs';
// Il modulo si valuta più di una volta nel lavoratore: la cartella resta quella della prima, come la registrazione.
// Nella suite c'è già quella della suite, e la registrazione è già accesa.
if (!process.env.FILO_COPERTURA) process.env.FILO_COPERTURA = cartellaTemporanea('filo-mappa-reg-');
const REG = resolve(process.env.FILO_COPERTURA);
accendiCopertura(createRequire(import.meta.url)('../src/main/copertura.js'));

let mappa = '';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-mappa-ud-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test', FILO_DOWNLOAD_DIR: join(userData, 'downloads') },
  });
  await expect.poll(() => app.windows().some((w) => /^filo:\/\/newtab/.test(w.url())), { timeout: 30_000 }).toBe(true);
  // Il main scrive ogni cinque secondi e alla chiusura: l'attesa lascia girare le funzioni dell'avvio.
  await new Promise((r) => setTimeout(r, 6000));
  await chiudiApp(app, { tetto: 10_000 });
  // Solo le registrazioni di questa prova: nella suite la cartella è di tutta la parte.
  const regs = [];
  for (const f of readdirSync(REG).filter((n) => n.endsWith('.json'))) {
    try { const j = JSON.parse(readFileSync(join(REG, f), 'utf8')); if (j.prova === QUESTA) regs.push(j); } catch (_) {}
  }
  const sorgente = (rel) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch (_) { return null; } };
  const m = costruisciMappa({ registrazioni: unisciRegistrazioni(regs, ROOT), sorgente, root: ROOT });
  mappa = join(cartellaTemporanea('filo-mappa-'), 'mappa.json');
  writeFileSync(mappa, JSON.stringify(m));
});

function chiedi(args, input) {
  return JSON.parse(execFileSync(process.execPath, ['scripts/mappa-prove.mjs', '--mappa', mappa, '--json', ...args], { cwd: ROOT, encoding: 'utf8', input }));
}

function livelloPerRiga(rel, r) {
  const righe = readFileSync(join(ROOT, rel), 'utf8').split('\n');
  const diff = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -${r},1 +${r},1 @@\n-${righe[r - 1]}\n+${righe[r - 1]} \n`;
  return chiedi(['--diff', '-'], diff).prove.find((p) => p.spec === QUESTA)?.livello;
}

test('un cambio a una costante di modulo letta da una funzione che la prova esegue nomina la prova fra le specifiche', () => {
  const rel = 'src/main/protocol.js';
  const righe = readFileSync(join(ROOT, rel), 'utf8').split('\n');
  const usa = righe.findIndex((l) => l.includes("headers.set('Content-Security-Policy', FILO_PAGE_CSP)")) + 1;
  const costante = righe.findIndex((l) => l.startsWith('const FILO_PAGE_CSP = [')) + 2;
  expect(usa).toBeGreaterThan(0);
  expect(costante).toBeGreaterThan(1);
  // La funzione che legge la costante l'ha eseguita la prova: un cambio dentro di lei la nomina fra le specifiche.
  expect(livelloPerRiga(rel, usa)).toBe('funzione');
  expect(livelloPerRiga(rel, costante)).toBe('funzione');
});

test('un foglio di stile della home che la prova ha caricato la nomina', () => {
  const out = chiedi(['src/pages/dashboard/dashboard.css']);
  expect(out.prove.map((p) => p.spec)).toContain(QUESTA);
});
