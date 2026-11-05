// La cache del codice del main (#2118): riletta quando l'app sta nella stessa cartella, mai accumulata quando la cartella
// cambia a ogni avvio (AppImage, app spostata da Gatekeeper), mai pulita dentro una cartella di cache che non è di Filo.
// Ogni caso gira in un processo suo: la cache di Node si accende una volta per processo.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { cartellaTemporanea, togliCartella } from '../helpers/percorsi.mjs';

const MODULO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'main', 'cacheCodice.js');

// La cache la accende il Node di Electron: quello che corre gli unit (il 20 di GitHub) non ha enableCompileCache (#2204).
function motore() {
  const require = createRequire(import.meta.url);
  try {
    const bin = require('electron');
    if (typeof bin === 'string' && fs.existsSync(bin)) return { bin, env: { ELECTRON_RUN_AS_NODE: '1' } };
  } catch (_) {}
  return typeof require('node:module').enableCompileCache === 'function' ? { bin: process.execPath, env: {} } : null;
}
const MOTORE = motore();
const OPZ = { skip: !MOTORE && 'manca Electron, e questo Node non ha la cache del codice compilato' };
const cartelle = [];
afterEach(() => { while (cartelle.length) togliCartella(cartelle.pop()); });
const nuova = (p) => { const d = cartellaTemporanea(p); cartelle.push(d); return d; };

// Un'app finta: un modulo abbastanza grosso da finire in cache, nella cartella da cui «gira».
function app(dir) {
  fs.mkdirSync(dir, { recursive: true });
  let s = '';
  for (let i = 0; i < 300; i++) s += `function f${i}(x) { return x * ${i} + Math.sqrt(x); }\n`;
  fs.writeFileSync(join(dir, 'pesante.js'), `${s}module.exports = 1;\n`);
  return dir;
}

function avvia(userData, appPath, env = {}) {
  const codice = `
    const C = require(${JSON.stringify(MODULO)});
    const accesa = C.accendi({ getPath: () => ${JSON.stringify(userData)}, getAppPath: () => ${JSON.stringify(appPath)} });
    require(${JSON.stringify(join(appPath, 'pesante.js'))});
    C.scrivi();
    process.stdout.write(JSON.stringify({ accesa }));`;
  const ambiente = { ...process.env, NODE_DEBUG_NATIVE: 'COMPILE_CACHE', ...MOTORE.env, ...env };
  for (const k of ['NODE_COMPILE_CACHE', 'NODE_DISABLE_COMPILE_CACHE', 'APPIMAGE']) if (!(k in env)) delete ambiente[k];
  const r = spawnSync(MOTORE.bin, ['-e', codice], { env: ambiente, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { ...JSON.parse(r.stdout), presa: /pesante\.js was accepted/.test(r.stderr) };
}

const voci = (userData) => {
  const c = join(userData, 'codice-compilato');
  return fs.existsSync(c) ? fs.readdirSync(c, { recursive: true }).length : 0;
};

test('dalla stessa cartella il secondo avvio riprende il codice compilato', () => {
  const base = nuova('filo-cache-stessa-');
  const ud = join(base, 'dati');
  const dir = app(join(base, 'Filo'));
  assert.equal(avvia(ud, dir).accesa, true);
  const dopoPrimo = voci(ud);
  const secondo = avvia(ud, dir);
  assert.equal(secondo.presa, true, 'il modulo è stato ricompilato');
  assert.equal(voci(ud), dopoPrimo);
});

test('da una cartella diversa a ogni avvio la cache non si accumula', () => {
  const base = nuova('filo-cache-sposta-');
  const ud = join(base, 'dati');
  avvia(ud, app(join(base, 'uno')));
  const dopoPrimo = voci(ud);
  avvia(ud, app(join(base, 'due')));
  avvia(ud, app(join(base, 'tre')));
  assert.ok(voci(ud) <= dopoPrimo, `${voci(ud)} voci dopo tre cartelle, ${dopoPrimo} dopo una`);
});

test('con l\'AppImage o l\'app spostata da Gatekeeper la cache resta spenta e quella rimasta se ne va', () => {
  const base = nuova('filo-cache-volatile-');
  const ud = join(base, 'dati');
  fs.mkdirSync(join(ud, 'codice-compilato', 'v24.0.0-x64-aaaa-0'), { recursive: true });
  assert.equal(avvia(ud, app(join(base, '.mount_Filoabc123')), { APPIMAGE: join(base, 'Filo.AppImage') }).accesa, false);
  assert.equal(fs.existsSync(join(ud, 'codice-compilato')), false);
  assert.equal(avvia(ud, app(join(base, 'AppTranslocation', 'X1', 'd', 'Filo.app'))).accesa, false);
  assert.equal(fs.existsSync(join(ud, 'codice-compilato')), false);
});

test('la sottocartella di un motore vecchio se ne va, quella di adesso e il percorso restano', () => {
  const base = nuova('filo-cache-motore-');
  const ud = join(base, 'dati');
  const dir = app(join(base, 'Filo'));
  avvia(ud, dir);
  const vecchia = join(ud, 'codice-compilato', 'v0.0.0-x64-vecchia-0');
  fs.mkdirSync(vecchia);
  avvia(ud, dir);
  assert.equal(fs.existsSync(vecchia), false);
  assert.ok(fs.existsSync(join(ud, 'codice-compilato', 'percorso-app.txt')));
  assert.equal(avvia(ud, dir).presa, true);
});

test('con una cartella di cache scelta nell\'ambiente Filo non cancella niente di suo', () => {
  const base = nuova('filo-cache-altrui-');
  const altrui = join(base, 'cache-mia');
  const sua = join(altrui, 'v0.0.0-x64-sua-0');
  fs.mkdirSync(sua, { recursive: true });
  fs.writeFileSync(join(sua, 'voce'), 'x');
  avvia(join(base, 'dati'), app(join(base, 'Filo')), { NODE_COMPILE_CACHE: altrui });
  assert.ok(fs.existsSync(join(sua, 'voce')), 'una voce della cache altrui è sparita');
});
