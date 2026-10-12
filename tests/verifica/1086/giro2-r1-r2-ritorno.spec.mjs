// #1086, giro 2: il ritorno loopback davanti a una richiesta malformata di un altro programma locale (r1),
// e la pagina che il ritorno mostra a chi usa l'accesso owner da terminale (r2). Logica pura: niente Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import net from 'node:net';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const googleAuth = require('../../../src/main/auth/google-auth.js');

test('r1 una richiesta con un indirizzo malformato riceve un rifiuto, senza errori non gestiti nel processo', async () => {
  const errori = [];
  const raccogli = (e) => errori.push(e?.message || String(e));
  process.on('uncaughtException', raccogli);
  try {
    const state = 'S'.repeat(43);
    const loop = await googleAuth._internals.startLoopback(state);
    loop.waitForCode().catch(() => {});
    const port = new URL(loop.redirectUri).port;
    const risposta = await new Promise((res) => {
      let dati = '';
      const s = net.connect(port, '127.0.0.1', () => s.write('GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      s.on('data', (d) => { dati += d; });
      s.on('close', () => res(dati));
      s.on('error', () => res(dati));
      setTimeout(() => { s.destroy(); res(dati); }, 1500);
    });
    loop.abort(new Error('fine prova'));
    expect(errori).toEqual([]);
    expect(risposta.split('\r\n')[0]).toMatch(/^HTTP\/1\.1 4\d\d/);
  } finally {
    process.off('uncaughtException', raccogli);
  }
});

test('r2 la pagina di ritorno dell\'accesso owner da terminale non manda a «tornare all\'app»', async () => {
  const state = 'T'.repeat(43);
  const loop = await googleAuth._internals.startLoopback(state);
  const codice = loop.waitForCode();
  const r = await fetch(`${loop.redirectUri}/?code=c&state=${state}`, { headers: { Connection: 'close' } });
  const pagina = await r.text();
  await codice;
  const script = readFileSync(new URL('../../../scripts/admin-login.mjs', import.meta.url), 'utf8');
  if (script.includes('_internals') && script.includes('startLoopback')) {
    expect(pagina).not.toMatch(/tornare all'app/);
  }
});
