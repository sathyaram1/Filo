// #873 giro 3, rilievo 2: staccando il caricatore la correzione immediata non deve essere ricoperta da una lettura vecchia.
// Il lettore di Windows e del Mac girano qui in un Node a parte, con un sistema finto: il contenitore è Linux.

import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULO = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), 'src', 'main', 'services', 'statoSistema.js');

const COMUNE = `
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const pm = new EventEmitter();
const finto = { powerMonitor: pm, app: { on() {} }, net: { isOnline: () => true } };
const vero = Module._load;
Module._load = function (r, ...a) { return r === 'electron' ? finto : vero.call(this, r, ...a); };
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
const storia = [];
const nota = (S) => storia.push(S.stato() && S.stato().batteria ? S.stato().batteria.collegata : null);
`;

// Windows: il PowerShell scrive la riga nuova al suo giro (ogni 2 s), l'avviso di Windows arriva subito.
const WINDOWS = `${COMUNE}
Object.defineProperty(process, 'platform', { value: 'win32' });
const cp = require('node:child_process');
const { PassThrough } = require('node:stream');
let figlio;
cp.spawn = () => { figlio = new EventEmitter(); figlio.stdout = new PassThrough(); figlio.kill = () => {}; return figlio; };
const S = require(${JSON.stringify(MODULO)});
const riga = (c) => JSON.stringify({ batteria: { livello: 100, inCarica: false, collegata: c }, rete: null, bluetooth: null }) + '\\n';
(async () => {
  S.richiedi();
  await attesa(50); figlio.stdout.write(riga(true)); await attesa(100);
  pm.emit('on-battery');
  for (let i = 0; i < 10; i++) { await attesa(100); nota(S); }
  figlio.stdout.write(riga(false)); await attesa(50); nota(S);
  console.log(JSON.stringify(storia)); process.exit(0);
})();`;

// Mac: il caricatore si stacca mentre la lettura del giro è in corso.
const MAC = `${COMUNE}
Object.defineProperty(process, 'platform', { value: 'darwin' });
const cp = require('node:child_process');
let collegata = true;
cp.execFile = (file, args, opts, cb) => {
  const c = collegata;
  const out = file === 'pmset' ? "Now drawing from '" + (c ? 'AC Power' : 'Battery Power') + "'\\n -InternalBattery-0 (id=1)\\t100%; " + (c ? 'charged' : 'discharging') + "; 0:00 remaining present: true\\n" : '';
  setTimeout(() => cb(null, out), 400);
};
const S = require(${JSON.stringify(MODULO)});
(async () => {
  S.richiedi();
  await attesa(3100);
  collegata = false; pm.emit('on-battery');
  for (let i = 0; i < 10; i++) { await attesa(150); nota(S); }
  console.log(JSON.stringify(storia)); process.exit(0);
})();`;

for (const [sistema, codice] of [['Windows', WINDOWS], ['Mac', MAC]]) {
  test(`${sistema}: dopo lo stacco del caricatore la voce resta «a batteria», non torna «collegata»`, () => {
    const storia = JSON.parse(execFileSync(process.execPath, ['-e', codice], { encoding: 'utf8', timeout: 20_000 }).trim().split('\n').pop());
    expect(storia.every((c) => c === false)).toBe(true);
  });
}
