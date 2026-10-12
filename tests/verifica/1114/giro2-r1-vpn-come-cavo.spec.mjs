// #1114 giro 2 — Wi-Fi più una VPN il cui adattatore si presenta come scheda Ethernet (TAP, AnyConnect, GlobalProtect):
// l'icona deve restare quella del Wi-Fi, col nome della rete, anche quando Windows usa la VPN per Internet.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../../src/main/services/statoSistema.js');
const W = 'aaaaaaaa-0000-0000-0000-000000000001';
const V = 'aaaaaaaa-0000-0000-0000-000000000003';

const riga = (principale, profili) => JSON.stringify({ rete: {
  schede: [{ id: W, tipo: 'Wireless80211', gateway: true }, { id: V, tipo: 'Ethernet', gateway: true }],
  profili,
  principale,
  connessioni: [{ id: null, internet: true, nome: 'Casa' }, { id: null, internet: true, nome: 'ufficio.local' }],
} });
const pW = { id: W, livello: 3, iana: 71, nome: 'Casa' };
const pV = { id: V, livello: 3, iana: 6, nome: 'ufficio.local' };

test('r1 Wi-Fi più VPN «Ethernet» che Windows usa per Internet: icona del Wi-Fi e nome della rete', () => {
  expect(S.datiDaWindows(riga(V, [pW, pV])).rete).toEqual({ tipo: 'wifi', nome: 'Casa' });
});
