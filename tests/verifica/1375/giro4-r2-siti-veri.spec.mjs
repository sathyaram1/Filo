// #1375 giro 4: siti veri, dei marchi stessi o di altri, che su main passavano senza avviso e col classificatore lo
// prendono, all'apertura o nel menu del link.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate, codiceImitazione } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const LS = globalThis.SN_LINK_SOSPETTO;
const nelMenu = (u) => LS.conImitazione(LS.analizza(u), codiceImitazione(u)).some((c) => /^(typosquatting|omografo|nome_altrui):/.test(c));
const conAvviso = (h) => evaluate('https://' + h + '/').level !== 'safe' || nelMenu('https://' + h + '/');

test('r2 i siti veri che prima passavano passano ancora', () => {
  const nomi = ['bancoposta.it', 'mastercard.es', 'mastercard.com.au', 'bnpparibascardif.cl', 'openair.com', 'www.webfx.com',
    'patient.klara.com', 'reddit.app.link', 'booking.swissqualityhotels.com', 'codebase64.pokefinder.org'];
  expect(nomi.filter(conAvviso)).toEqual([]);
});
