// Verifica #1077 giro 1, rilievo 1: il manifesto delle capacità (quello che Filo legge per rispondere in chat)
// deve dire che il premio per le segnalazioni inviate ha un tetto al giorno.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('r1 il manifesto dice che i premi d\'invio valgono fino a un tetto al giorno', () => {
  require('../../../src/shared/capabilities.js');
  const caps = globalThis.SN_CAPABILITIES;
  const voci = (caps.list || caps.CAPABILITIES || caps.all || []).filter((c) => c && (c.id === 'credits' || c.id === 'feedback'));
  expect(voci.length).toBeGreaterThan(0);
  const testo = voci.map((c) => `${c.desc || ''} ${c.doesNot || ''} ${c.invoke || ''}`).join(' ');
  expect(testo).toMatch(/(al giorno|per giorno|del giorno|primi \d+|al più \d+)/i);
});
