// #1763 giro 1: senza rete il conteggio interrotto deve dire che manca la connessione, non il solo «fetch failed».
import { test, expect } from '@playwright/test';
import { main } from '../../../scripts/conta-documenti.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

test('r1 senza rete il messaggio dice cosa è successo', async () => {
  let scritto = '';
  const err = { isTTY: false, write: (s) => { scritto += s; } };
  const fetchImpl = async () => {
    const e = new TypeError('fetch failed');
    e.cause = Object.assign(new Error('getaddrinfo ENOTFOUND firestore.googleapis.com'), { code: 'ENOTFOUND' });
    throw e;
  };
  const codice = await main(['--progetto', 'filo-prova'], {
    err, out: () => {}, casa: cartellaTemporanea('conta-1763'), fetchImpl, token: async () => 't', attendi: async () => {},
  });
  expect(codice).toBe(1);
  const riga = scritto.split('\n').find((r) => r.startsWith('Conteggio interrotto')) || '';
  expect(riga).toMatch(/ENOTFOUND|rete|connession/i);
});
