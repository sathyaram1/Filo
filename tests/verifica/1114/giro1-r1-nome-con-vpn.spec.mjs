// #1114 giro 1 — col Wi-Fi e una VPN (o un secondo collegamento a Internet) il nome della rete sparisce: il gestore
// delle reti non dice di quale adattatore è ogni nome, e il profilo di Windows legato al Wi-Fi il nome lo ha già.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../../src/main/services/statoSistema.js');
const W = 'aaaaaaaa-0000-0000-0000-000000000001';
const V = 'aaaaaaaa-0000-0000-0000-000000000003';

test('r1 Wi-Fi più VPN: l\'icona è del Wi-Fi e il nome della rete resta', () => {
  expect(S.SCRIPT_WINDOWS).toMatch(/ProfileName/);
  const riga = JSON.stringify({ rete: {
    schede: [{ id: W, tipo: 'Wireless80211', gateway: true }, { id: V, tipo: 'Unknown', gateway: true }],
    profili: [{ id: W, livello: 3, iana: 71, nome: 'Casa' }, { id: V, livello: 3, iana: 53, nome: 'VPN ufficio' }],
    principale: V,
    connessioni: [{ id: null, internet: true, nome: 'Casa' }, { id: null, internet: true, nome: 'VPN ufficio' }],
  } });
  expect(S.datiDaWindows(riga).rete).toEqual({ tipo: 'wifi', nome: 'Casa' });
});
