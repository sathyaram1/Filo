// Verifica locale del lavoro «suite-locale», quinto giro.
// Le porte dei giri passati (pagine, servizi, stili, preload, shim: ognuno
// porta con sé gli spec della sua area) restano chiuse e sono provate dagli
// spec dei giri 3 e 4. Qui si prova quello che NON ha un'area: i file che
// stanno sotto a tutta l'app — l'avvio (src/main/main.js), il caricatore dei
// moduli condivisi (loader.js), l'IPC, il protocollo filo://, il registro dei
// messaggi e le costanti condivise — e le fondamenta dei test stessi (la
// fixture che ogni spec usa, la configurazione di Playwright). Toccati, il
// comando dei controlli non sceglie nessuno spec e chiude con «controlli
// passati» dopo i soli unit test, pur esistendo uno spec di avvio
// (tests/boot) che costa un minuto. Il primo test è rosso di proposito.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const tracked = execFileSync('git', ['ls-files', 'tests/*.spec.mjs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
const src = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

async function mod() {
  return import(pathToFileURL(join(ROOT, 'scripts', 'finish-local.mjs')).href);
}

test('un file sotto a tutta l’app, toccato, lancia almeno lo spec di avvio', async () => {
  // Rilievo con punto di domanda del quinto giro: quale pavimento dare ai
  // file senza area è una scelta dell'owner. Atteso rosso finché non decide
  // (poi togliere questa riga).
  test.fail(true, 'i file trasversali non fanno partire nessuno spec: decisione owner aperta');
  const m = await mod();
  const trasversali = [
    'src/main/main.js',
    'src/main/services/loader.js',
    'src/main/ipc.js',
    'src/main/protocol.js',
    'src/shared/messages.js',
    'src/shared/constants.js',
    'tests/fixtures/electron.mjs',
    'playwright.config.js',
  ];
  const senzaSpec = trasversali.filter((f) => m.specsForChangedFiles([f], tracked).length === 0);
  expect(senzaSpec, 'file che non lanciano nessuno spec').toEqual([]);
});

test('la scelta resta mirata anche col nome del file: mai più di una trentina per file', async () => {
  const m = await mod();
  const conteggi = src.map((f) => m.specsForChangedFiles([f], tracked).length);
  expect(Math.max(...conteggi)).toBeLessThanOrEqual(32);
  const ordinati = [...conteggi].sort((a, b) => a - b);
  expect(ordinati[Math.floor(ordinati.length / 2)]).toBeLessThanOrEqual(4);
});

test('i file dei test che non sono spec (unit, fixture, helper) non fanno partire spec a caso', async () => {
  const m = await mod();
  for (const f of ['tests/unit/foo.test.mjs', 'tests/helpers/scala.mjs', 'scripts/finish-local.mjs', 'package.json']) {
    const r = m.specsForChangedFiles([f], tracked);
    expect(r.every((s) => tracked.includes(`${s}.spec.mjs`)), f).toBe(true);
  }
});
