// #1375 giro 2 — il marchio di una banca o di un servizio noto attaccato a una parola da truffa (posteonline.it,
// googleaccount.com, apple-id.it, accountamazon.wixsite.com) deve dare l'avviso, all'apertura e nel menu del link.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate, codiceImitazione } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const LS = globalThis.SN_LINK_SOSPETTO;
const nelMenu = (u) => LS.conImitazione(LS.analizza(u), codiceImitazione(u)).some((c) => /^(typosquatting|omografo|nome_altrui):/.test(c));

test('r1 i nomi classici da truffa col marchio e una parola danno l’avviso', () => {
  const nomi = [
    'accountgoogle.it', 'secure-google.com', 'googlehelp.com', 'apple-id.it', 'supportapple.com',
    'poste-id.it', 'posteonline.it', 'postesecure.it', 'check-poste.it', 'poste-service.it', 'unicredit-online.it',
    'microsoft-online.com', 'accountamazon.com', 'outlookaccount.com', 'secure-amazon.co.uk',
    'accountamazon.wixsite.com', 'appleaccount.github.io', 'posteonline.web.app',
  ];
  const persi = nomi.filter((h) => evaluate('https://' + h + '/').level === 'safe' || !nelMenu('https://' + h + '/'));
  expect(persi).toEqual([]);
});

test('r1 marchio più parola, attaccati o col trattino, su .com e .it: quasi sempre un avviso', () => {
  const marchi = ['poste', 'google', 'apple', 'microsoft', 'unicredit', 'amazon', 'outlook', 'icloud'];
  const parole = ['secure', 'login', 'verify', 'account', 'support', 'update', 'accesso', 'sicurezza', 'verifica', 'help', 'service', 'online'];
  const persi = [];
  let tutti = 0;
  for (const m of marchi) for (const p of parole) for (const s of ['com', 'it']) {
    for (const h of [`${p}-${m}`, `${m}-${p}`, p + m, m + p]) {
      tutti++;
      if (evaluate(`https://${h}.${s}/`).level === 'safe') persi.push(`${h}.${s}`);
    }
  }
  expect(persi.length / tutti, `${persi.length}/${tutti} senza avviso: ${persi.slice(0, 30).join(', ')}`).toBeLessThan(0.05);
});
