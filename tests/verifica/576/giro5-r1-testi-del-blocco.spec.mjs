// Verifica #576 giro 5, rilievo 1: quello che Filo racconta del blocco della pubblicità (novità, elenco di cosa sa fare)
// deve dire ciò che il blocco fa davvero. Logica pura: non apre Filo.
import { createRequire } from 'node:module';
import { test, expect } from '@playwright/test';

const require = createRequire(import.meta.url);

test('r1 nessuna voce di cosa sa fare Filo dice che lo spazio vuoto degli annunci resta, ora che si chiude', () => {
  require('../../../src/shared/capabilities.js');
  const voci = globalThis.SN_CAPABILITIES.all();
  const smentite = voci.filter((v) => /spazio vuoto che un annuncio bloccato lascia/i.test(`${v.desc} ${v.doesNot}`)).map((v) => v.id);
  expect(smentite).toEqual([]);
});

test('r1 le novità non promettono che i link di affiliazione si aprono se quelli delle reti più usate restano fermati', () => {
  process.env.NODE_ENV = 'test';
  const A = require('../../../src/main/services/adblock.js');
  // Una riga del file hosts di StevenBlack, com'è nella lista vera (Skimlinks, Awin, Rakuten, Tradedoubler, CJ ci sono tutti).
  const pagine = new Set();
  const domini = A.parseList('0.0.0.0 go.skimresources.com\n0.0.0.0 www.awin1.com\n0.0.0.0 click.linksynergy.com', pagine);
  A.setDomainsForTest([...domini], [...pagine]);
  const fermati = ['go.skimresources.com', 'www.awin1.com', 'click.linksynergy.com'].filter((h) => A.isBlockedSite(h));
  require('../../../src/shared/patchNotes.js');
  const PN = globalThis.SN_PATCH_NOTES;
  const testo = JSON.stringify(PN.NOTES);
  const promessa = /link di affiliazione[^"]*?si aprono/i.test(testo);
  expect({ promessa, fermati: fermati.length > 0 }).not.toEqual({ promessa: true, fermati: true });
});
