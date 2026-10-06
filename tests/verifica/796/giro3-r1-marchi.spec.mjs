// #796 giro 3, rilievo 1: i siti nazionali veri dei grandi marchi non devono aprirsi con l'avviso «sospetto».

import { test, expect } from '../../fixtures/electron.mjs';

const VERI = ['amazon.com.mx', 'amazon.com.tr', 'amazon.sa', 'amazon.eg', 'amazon.com.be', 'yahoo.co.jp', 'google.com.mx', 'google.com.tr', 'google.co.za', 'ebay.com.hk'];

test('r1 i siti nazionali dei marchi noti sono sicuri, come amazon.com.br e google.co.uk', async ({ app }) => {
  const livelli = await app.evaluate((_, nomi) => {
    const SB = globalThis.SN_SAFEBROWSE;
    return Object.fromEntries(nomi.map((n) => [n, SB.checkSync(`https://${n}/`, {}).level]));
  }, ['amazon.com.br', 'google.co.uk', ...VERI]);
  expect(livelli['amazon.com.br']).toBe('safe');
  expect(livelli['google.co.uk']).toBe('safe');
  expect(Object.entries(livelli).filter(([, l]) => l !== 'safe')).toEqual([]);
});
