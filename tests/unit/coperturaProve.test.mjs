// Le due metà della registrazione per la mappa prova → file (#2502): il processo main scrive le funzioni di src/ che
// ha eseguito, e il lancio di Electron dalle prove porta il nome della prova e registra le funzioni delle pagine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('il main registra le funzioni di src/ che ha eseguito, col nome della prova, alla chiusura', () => {
  const dir = cartellaTemporanea('filo-copertura-');
  try {
    const codice = `
      const { EventEmitter } = require('node:events');
      const app = new EventEmitter();
      require(${JSON.stringify(join(ROOT, 'src/main/copertura.js'))}).accendi(app);
      const { percorsoFilo } = require(${JSON.stringify(join(ROOT, 'src/main/percorsoFilo.js'))});
      percorsoFilo('shell', '');
      app.emit('will-quit');
    `;
    const r = spawnSync(process.execPath, ['-e', codice], { env: { ...process.env, FILO_COPERTURA: dir, FILO_COPERTURA_PROVA: 'tests/x.spec.mjs' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const file = readdirSync(dir).filter((f) => f.startsWith('main-'));
    assert.equal(file.length, 1);
    const j = JSON.parse(readFileSync(join(dir, file[0]), 'utf8'));
    assert.equal(j.prova, 'tests/x.spec.mjs');
    assert.equal(j.processo, 'main');
    const testo = readFileSync(join(ROOT, 'src/main/percorsoFilo.js'), 'utf8');
    const funzioni = (j.file['src/main/percorsoFilo.js'] || []).map(([da]) => testo.slice(da, da + 21));
    assert.ok(funzioni.includes('function percorsoFilo'),`la funzione chiamata è registrata: ${JSON.stringify(funzioni)}`);
    assert.ok(Object.keys(j.file).every((f) => f.startsWith('src/')), 'solo file di src/');
  } finally { togliCartella(dir); }
});

test('senza FILO_COPERTURA il main non registra niente', () => {
  const codice = `require(${JSON.stringify(join(ROOT, 'src/main/copertura.js'))}).accendi({ on() { throw new Error('acceso'); } });`;
  const env = { ...process.env };
  delete env.FILO_COPERTURA;
  const r = spawnSync(process.execPath, ['-e', codice], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('il lancio dalle prove passa cartella e prova al main, e alla chiusura scrive le funzioni delle pagine', async () => {
  const dir = cartellaTemporanea('filo-copertura-');
  const prima = process.env.FILO_COPERTURA;
  try {
    const { _electron } = await import('@playwright/test');
    const proto = Object.getPrototypeOf(_electron);
    const vero = proto.launch;
    const chiamate = [];
    const pagina = { once() {} };
    const sessione = {
      async send(metodo) {
        chiamate.push(metodo);
        return metodo === 'Profiler.takePreciseCoverage'
          ? { result: [{ url: 'filo://shell/shell.js', functions: [{ ranges: [{ startOffset: 3, endOffset: 9, count: 1 }] }, { ranges: [{ startOffset: 20, endOffset: 30, count: 0 }] }] }] }
          : {};
      },
    };
    const contesto = { pages: () => [pagina], on() {}, newCDPSession: async () => sessione };
    let opzioni = null;
    let chiusa = false;
    proto.launch = async (o) => { opzioni = o; return { context: () => contesto, close: async () => { chiusa = true; }, once() {} }; };
    process.env.FILO_COPERTURA = dir;
    const { accendiCopertura } = await import('../../scripts/lib/copertura-prove.mjs');
    accendiCopertura();
    try {
      const app = await _electron.launch({ env: { ALTRO: '1' } });
      assert.equal(opzioni.env.ALTRO, '1', 'l\'ambiente della prova resta');
      assert.equal(opzioni.env.FILO_COPERTURA, resolve(dir));
      assert.equal(opzioni.env.FILO_COPERTURA_PROVA, '', 'fuori da una prova il nome è vuoto');
      await new Promise((r) => setTimeout(r, 20));
      await app.close();
      assert.ok(chiusa, 'la chiusura vera parte');
      assert.ok(chiamate.includes('Profiler.startPreciseCoverage'));
      const file = readdirSync(dir).filter((f) => f.startsWith('pagine-'));
      assert.equal(file.length, 1);
      const j = JSON.parse(readFileSync(join(dir, file[0]), 'utf8'));
      assert.deepEqual(j.indirizzi, { 'filo://shell/shell.js': [[3, 9]] }, 'solo le funzioni eseguite');
    } finally {
      proto.launch = vero;
      delete proto.__filoCopertura;
    }
  } finally {
    if (prima === undefined) delete process.env.FILO_COPERTURA; else process.env.FILO_COPERTURA = prima;
    togliCartella(dir);
  }
});

test('la config di Playwright accende la registrazione', () => {
  const config = readFileSync(join(ROOT, 'playwright.config.js'), 'utf8');
  assert.match(config, /import \{ accendiCopertura \} from '\.\/scripts\/lib\/copertura-prove\.mjs'/);
  assert.match(config, /^accendiCopertura\(\);$/m);
  const main = readFileSync(join(ROOT, 'src/main/main.js'), 'utf8');
  const riga = main.split('\n').findIndex((r) => r.includes("require('./copertura').accendi(app)"));
  const primoRequireLocale = main.split('\n').findIndex((r) => /require\('\.\//.test(r));
  assert.ok(riga >= 0 && riga === primoRequireLocale, 'il main accende la registrazione prima di ogni altro modulo suo');
});
