// Verifica #2394.1, giro 2: mentre il PowerShell del lettore risponde a un elenco non rilegge lo stato, e la sua
// ultima riga non deve passare per una lettura di adesso.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const L = require('../../../src/main/services/statoSistema.js');

function powershellLento(attesaMs, consegna) {
  const f = new EventEmitter();
  f.stdout = new PassThrough();
  f.stdin = new PassThrough();
  f.stdin.setEncoding('utf8');
  f.kill = () => setImmediate(() => f.emit('exit', null, 'SIGTERM'));
  f.stdin.on('data', (r) => {
    const cosa = String(r).trim();
    setTimeout(() => { f.stdout.write(`${JSON.stringify({ elenco: { cosa, acceso: true, dispositivi: [] } })}\n`); consegna(); }, attesaMs);
  });
  setTimeout(() => f.stdout.write(`${JSON.stringify({ bluetooth: { acceso: false, dispositivi: [] }, volume: { livello: 20, muto: false } })}\n`), 5);
  return f;
}

test('r1 col PowerShell fermo su un elenco per più di due giri, il lettore non dà la sua riga di prima come letta adesso', async () => {
  test.setTimeout(30_000);
  const attesa = L.VECCHIO_MS + 1500;
  let risposto = false;
  const w = L.lettoreWindows({ avvia: () => powershellLento(attesa, () => { risposto = true; }) });
  try {
    w.assicura();
    await w.pronto(2000);
    expect(w.inAttesa() === false && w.ultimo() !== null).toBe(true);
    const elenco = w.chiedi('bluetooth', attesa + 5000);
    await new Promise((r) => setTimeout(r, L.VECCHIO_MS + 500));
    expect(risposto).toBe(false);
    // Il Bluetooth può essersi acceso da fuori in questi secondi: la riga di prima non è una lettura di adesso.
    expect(w.inAttesa() === true || w.ultimo() === null).toBe(true);
    expect((await elenco).cosa).toBe('bluetooth');
  } finally { w.ferma(); }
});
