// #1611 — il client dell'ispettore che guida Filo senza Playwright regge sul Node dei lavori di GitHub, dove il
// WebSocket globale non c'è: senza, le prove a pagina nascosta erano rosse solo nella suite su main.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { collegaIspettore } from '../helpers/filoSenzaPlaywright.mjs';

async function processoConIspettore(t) {
  const figlio = spawn(process.execPath, ['--inspect=127.0.0.1:0', '-e', 'globalThis.quanto = 6 * 7; setInterval(() => {}, 1e6)'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { try { figlio.kill('SIGKILL'); } catch (_) {} });
  let letto = '';
  return new Promise((ok, ko) => {
    figlio.stderr.setEncoding('utf8');
    figlio.stderr.on('data', (pezzo) => {
      letto += pezzo;
      const m = /Debugger listening on (ws:\/\/\S+)/.exec(letto);
      if (m) ok(m[1]);
    });
    figlio.once('exit', () => ko(new Error(`il processo è uscito senza ispettore\n${letto}`)));
  });
}

test('senza il WebSocket globale il client dell\'ispettore valuta nel processo e riporta le sue eccezioni', async (t) => {
  const prima = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'WebSocket', { value: undefined, configurable: true, writable: true });
  t.after(() => {
    if (prima) Object.defineProperty(globalThis, 'WebSocket', prima);
    else delete globalThis.WebSocket;
  });

  const ispettore = await collegaIspettore(await processoConIspettore(t));
  t.after(() => ispettore.chiudi());
  assert.equal(await ispettore.valuta('globalThis.quanto'), 42);
  assert.deepEqual(await ispettore.valuta('Promise.resolve({ a: [1, "è"] })'), { a: [1, 'è'] });
  await assert.rejects(ispettore.valuta('throw new Error("rotto qui")'), /nel main: Error: rotto qui/);
});
