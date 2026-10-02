// Verifica #894, giro 1, rilievo 1: su una pagina di login di un sito qualunque l'età si chiede prima, e il giudizio AI e
// la finestra isolata partono solo se dopo l'età resta un indizio; quando partono, il giudizio riceve l'età.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SB = require('../../../src/main/services/safebrowse/index.js');
const attesa = (ms) => new Promise((ok) => setTimeout(ok, ms));

function fornitori(etaGiorni) {
  for (const c of Object.values(SB._caches)) c.m.clear();
  const conta = { rdap: 0, ct: 0, llm: [], sandbox: 0 };
  SB.setProviders({
    gsb: async () => ({ listed: false }),
    rdap: async () => { conta.rdap++; await attesa(150); return etaGiorni; },
    ct: async () => { conta.ct++; return null; },
    llm: async (meta) => { conta.llm.push(meta); await attesa(100); return { suspicious: false, reason: null }; },
    sandbox: async () => { conta.sandbox++; await attesa(100); return { verdict: 'clean' }; },
  });
  return conta;
}

test('login su un sito vecchio di anni: età chiesta, nessun giudizio AI e nessuna finestra isolata', async () => {
  const conta = fornitori(4000);
  const url = 'https://forum-cucina-italiana.com/login';
  SB.analyze(url, { hasPassword: true }, () => {});
  await attesa(800);
  SB.analyze(url, { hasPassword: true }, () => {});
  await attesa(800);
  expect(conta.rdap).toBe(1);
  expect(conta.llm.map((m) => m.ageDays), 'il giudizio AI, se parte, conosce l\'età').not.toContain(null);
  expect(conta.llm.length, 'giudizi AI su un sito vecchio con una password').toBe(0);
  expect(conta.sandbox, 'finestre isolate su un sito vecchio con una password').toBe(0);
});

test('login su un dominio di ieri: resta l\'avviso «Dominio registrato da poco»', async () => {
  fornitori(1);
  const url = 'https://negozio-scarpe-sconti.com/cassa';
  const aggiornato = await new Promise((ok) => {
    SB.analyze(url, { hasPayment: true }, ok);
    setTimeout(() => ok(null), 1500);
  });
  expect(aggiornato && aggiornato.level).toBe('sospetto');
  expect(aggiornato.message.title).toBe('Dominio registrato da poco');
});
