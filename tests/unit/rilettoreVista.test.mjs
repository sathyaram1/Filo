// #2059 — una pagina che si rilegge dal server ai movimenti di crediti (Gestione → Utenti, Crediti): fuori vista non
// legge e si segna vecchia, al ritorno rilegge subito; in vista una lettura alla volta e al più una ogni `ogniMs`,
// con gli avvisi arrivati in mezzo raccolti in UNA lettura dopo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/wallet.js');
const W = globalThis.SN_WALLET;

// Orologio e timer finti: `avanza(ms)` fa scattare i timer scaduti, in ordine.
function banco({ ogniMs = W.VISTA_OWNER_OGNI_MS, inVista = true } = {}) {
  const b = { ora: 0, timer: [], letture: [], inVista, aperte: [] };
  b.r = W.rilettoreVista({
    leggi: () => {
      b.letture.push(b.ora);
      return new Promise((ok, ko) => { b.aperte.push({ ok, ko }); });
    },
    inVista: () => b.inVista,
    ogniMs,
    now: () => b.ora,
    timer: {
      set: (fn, ms) => { const t = { at: b.ora + ms, fn }; b.timer.push(t); return t; },
      clear: (t) => { b.timer = b.timer.filter((x) => x !== t); },
    },
  });
  b.chiudi = async (fallita = false) => {
    const a = b.aperte.shift();
    if (fallita) a.ko(new Error('rete')); else a.ok();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  b.avanza = (ms) => {
    const fine = b.ora + ms;
    for (;;) {
      const prossimo = b.timer.filter((t) => t.at <= fine).sort((x, y) => x.at - y.at)[0];
      if (!prossimo) break;
      b.timer = b.timer.filter((t) => t !== prossimo);
      b.ora = prossimo.at;
      prossimo.fn();
    }
    b.ora = fine;
  };
  return b;
}

test('fuori vista nessun avviso legge; al ritorno UNA lettura, anche dopo cento avvisi', async () => {
  const b = banco({ inVista: false });
  for (let i = 0; i < 100; i++) b.r.cambiato();
  b.avanza(10 * 60_000);
  assert.equal(b.letture.length, 0, 'una vista che nessuno guarda non chiede niente al server');
  assert.equal(b.r.vecchia(), true);
  b.inVista = true;
  b.r.mostrata();
  assert.equal(b.letture.length, 1, 'al ritorno si rilegge subito');
  await b.chiudi();
  b.avanza(5 * 60_000);
  assert.equal(b.letture.length, 1);
  assert.equal(b.r.vecchia(), false);
});

test('mostrata senza avvisi in mezzo non rilegge', () => {
  const b = banco();
  b.r.mostrata();
  b.r.mostrata();
  assert.equal(b.letture.length, 0);
});

test('in vista: il primo avviso legge subito, quelli del minuto dopo diventano una lettura sola allo scadere', async () => {
  const b = banco();
  b.r.cambiato();
  assert.deepEqual(b.letture, [0]);
  await b.chiudi();
  for (let i = 0; i < 50; i++) { b.avanza(1000); b.r.cambiato(); }
  assert.deepEqual(b.letture, [0], 'cinquanta avvisi in cinquanta secondi: nessuna lettura in più prima del minuto');
  b.avanza(10_000);
  assert.deepEqual(b.letture, [0, 60_000], 'allo scadere del minuto una lettura, che vede l\'ultimo stato');
  await b.chiudi();
  b.avanza(5 * 60_000);
  assert.equal(b.letture.length, 2, 'senza avvisi nuovi non rilegge da sola');
});

test('una lettura alla volta: gli avvisi durante quella in volo ne fanno una dopo, non una ciascuno', async () => {
  const b = banco({ ogniMs: 0 });
  b.r.cambiato();
  for (let i = 0; i < 20; i++) b.r.cambiato();
  assert.equal(b.letture.length, 1, 'una sola in volo');
  await b.chiudi();
  assert.equal(b.letture.length, 2, 'finita quella, una per gli avvisi arrivati in mezzo');
  await b.chiudi();
  assert.equal(b.letture.length, 2);
});

test('una lettura fallita non blocca le prossime', async () => {
  const b = banco({ ogniMs: 0 });
  b.r.cambiato();
  await b.chiudi(true);
  b.r.cambiato();
  assert.equal(b.letture.length, 2);
});

test('la vista che va dietro mentre aspetta il minuto non legge allo scadere, e rilegge al ritorno', async () => {
  const b = banco();
  b.r.cambiato();
  await b.chiudi();
  b.avanza(10_000);
  b.r.cambiato();
  b.inVista = false;
  b.avanza(5 * 60_000);
  assert.equal(b.letture.length, 1);
  b.inVista = true;
  b.r.mostrata();
  assert.equal(b.letture.length, 2, 'chi torna a guardare non aspetta il resto del minuto');
});

test('tornare a guardare durante una lettura in volo non ne apre una seconda', async () => {
  const b = banco();
  b.r.cambiato();
  b.r.cambiato();
  b.r.mostrata();
  assert.equal(b.letture.length, 1);
  await b.chiudi();
  assert.equal(b.letture.length, 1, 'quella dopo aspetta il minuto');
  b.avanza(60_000);
  assert.equal(b.letture.length, 2);
});

test('tempi: un passo più corto vale subito anche per la lettura che stava aspettando', async () => {
  const b = banco();
  b.r.cambiato();
  await b.chiudi();
  b.avanza(1000);
  b.r.cambiato();
  assert.equal(b.letture.length, 1);
  b.r.tempi({ ogniMs: 500 });
  assert.equal(b.letture.length, 2);
  b.r.tempi({ ogniMs: -1 });
  b.r.tempi({ ogniMs: 'x' });
  await b.chiudi();
  b.r.cambiato();
  b.avanza(500);
  assert.equal(b.letture.length, 3, 'valori non validi lasciano il passo com\'era');
});

test('il passo della Gestione è un minuto', () => {
  assert.equal(W.VISTA_OWNER_OGNI_MS, 60_000);
});
