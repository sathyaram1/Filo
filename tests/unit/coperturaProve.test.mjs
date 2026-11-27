// Le due metà della registrazione per la mappa prova → file (#2502): il processo main scrive le funzioni di src/ che
// ha eseguito, e il lancio di Electron dalle prove porta il nome della prova e registra le funzioni delle pagine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';
import { percorsoDaIndirizzo } from '../../scripts/lib/mappaProve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require_ = createRequire(import.meta.url);

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
    const funzioni = (j.indirizzi[pathToFileURL(join(ROOT, 'src/main/percorsoFilo.js')).href] || []).map(([da]) => testo.slice(da, da + 21));
    assert.ok(funzioni.includes('function percorsoFilo'),`la funzione chiamata è registrata: ${JSON.stringify(funzioni)}`);
    assert.ok(Object.keys(j.indirizzi).every((u) => percorsoDaIndirizzo(u, ROOT)), 'solo file di src/');
  } finally { togliCartella(dir); }
});

test('il main registra i file che filo:// serve, anche senza funzioni: così si sa chi carica un foglio di stile', () => {
  const dir = cartellaTemporanea('filo-copertura-');
  try {
    const codice = `
      const { EventEmitter } = require('node:events');
      const app = new EventEmitter();
      const c = require(${JSON.stringify(join(ROOT, 'src/main/copertura.js'))});
      c.accendi(app);
      c.servito('filo://newtab/dashboard.css?v=2#x');
      c.servito('non è un indirizzo');
      app.emit('will-quit');
    `;
    const r = spawnSync(process.execPath, ['-e', codice], { env: { ...process.env, FILO_COPERTURA: dir, FILO_COPERTURA_PROVA: 'tests/x.spec.mjs' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith('main-'))), 'utf8'));
    assert.deepEqual(j.indirizzi['filo://newtab/dashboard.css'], []);
    assert.equal(percorsoDaIndirizzo('filo://newtab/dashboard.css', ROOT), 'src/pages/dashboard/dashboard.css');
  } finally { togliCartella(dir); }
});

test('una regola sola dice quando una funzione è eseguita, per il main e per le pagine', () => {
  const pagine = readFileSync(join(ROOT, 'scripts/lib/copertura-prove.mjs'), 'utf8');
  assert.ok(!/count\s*>\s*0/.test(pagine), 'le pagine non riscrivono la regola: la prendono dal main');
  assert.match(pagine, /src\/main\/copertura\.js/);
  const { accumula, comeIndirizzi } = require_(join(ROOT, 'src/main/copertura.js'));
  const viste = new Map();
  accumula(viste, { result: [{ url: 'filo://shell/a.js', functions: [{ ranges: [{ startOffset: 0, endOffset: 9, count: 1 }] }, { ranges: [{ startOffset: 2, endOffset: 5, count: 0 }] }] }] });
  assert.deepEqual(comeIndirizzi(viste), { 'filo://shell/a.js': [[0, 9]] });
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
    accendiCopertura(require_(join(ROOT, 'src/main/copertura.js')));
    try {
      // Il lancio patchato col lancio vero sostituito: qui Electron non parte.
      const app = await proto.launch.call(_electron, { env: { ALTRO: '1' } });
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
  assert.match(config, /^import regolaCopertura from '\.\/src\/main\/copertura\.js';$/m);
  assert.match(config, /^accendiCopertura\(regolaCopertura\);$/m);
  const main = readFileSync(join(ROOT, 'src/main/main.js'), 'utf8');
  const riga = main.split('\n').findIndex((r) => r.includes("require('./copertura').accendi(app)"));
  const primoRequireLocale = main.split('\n').findIndex((r) => /require\('\.\//.test(r));
  assert.ok(riga >= 0 && riga === primoRequireLocale, 'il main accende la registrazione prima di ogni altro modulo suo');
});
