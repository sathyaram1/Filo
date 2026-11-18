// #1803.1 giro 1 — la riga della conversazione dice cosa è successo alla barra: un sito che c'era già non è «Messo».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/urlNav.js');
require('../../../src/shared/eseguibili.js');
require('../../../src/shared/barraSiti.js');
require('../../../src/shared/righeAttivita.js');

function storageFinto() {
  let dati = {};
  globalThis.chrome = { storage: { local: {
    get: async (k) => (typeof k === 'string' ? { [k]: dati[k] } : { ...dati }),
    set: async (o) => { dati = { ...dati, ...o }; },
  } } };
  globalThis.SN_CONST = globalThis.SN_CONST || { STORAGE_KEYS: { FILO_BARRA_SITI: 'filo_barra_siti' } };
  globalThis.SN_CONST.STORAGE_KEYS = { ...(globalThis.SN_CONST.STORAGE_KEYS || {}), FILO_BARRA_SITI: 'filo_barra_siti' };
}

test('r1 chiesto a parole un sito che è già nella barra, la riga non dice «Messo nella barra»', async () => {
  storageFinto();
  const S = require('../../../src/main/services/barraSiti.js');
  const R = globalThis.SN_RIGHE_ATTIVITA;
  const a = { type: 'BARRA_SITI', operazione: 'aggiungi', elemento: 'youtube.com', nome: 'YouTube' };
  const prima = await S.daChat(a);
  expect(prima.output.error).toBeUndefined();
  const seconda = await S.daChat(a);
  expect(seconda.output.gia).toBe(true);
  const riga = R.riga({ ...a, _output: seconda.output }).text;
  expect(riga).not.toMatch(/^Messo nella barra/);
  expect(riga).toMatch(/già nella barra/);
});

test('r1 una mossa che lascia la barra com\'era non si racconta come fatta: stesso nome, stesso posto', async () => {
  storageFinto();
  const S = require('../../../src/main/services/barraSiti.js');
  const R = globalThis.SN_RIGHE_ATTIVITA;
  await S.daChat({ type: 'BARRA_SITI', operazione: 'aggiungi', elemento: 'youtube.com', nome: 'YouTube' });
  for (const a of [
    { type: 'BARRA_SITI', operazione: 'rinomina', elemento: 'YouTube', nome: 'YouTube' },
    { type: 'BARRA_SITI', operazione: 'sposta', elemento: 'YouTube', verso: 'cima' },
  ]) {
    const r = await S.daChat(a);
    expect(r.cambiate, JSON.stringify(a)).toBeUndefined();
    expect(R.riga({ ...a, _output: r.output }).text, JSON.stringify(a)).not.toMatch(/^(Rinominato|Spostato) nella barra/);
  }
});
