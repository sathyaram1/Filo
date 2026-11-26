// #1403.27 giro 1 — una password fra virgolette vale tutta e sola: dal pavimento verso i modelli, dal correttore e dal
// freno sui link non esce un pezzo della frase, e le parole fuori dalle virgolette restano del testo.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(`../../../src/shared/${m}.js`);
const P = globalThis.SN_PAVIMENTO;
const X = globalThis.SN_URL_EXFIL;
const C = require('../../../src/main/services/correttoreRiservati.js');

test('r1 una frase di nove o più parole fra virgolette dopo «la password è» si toglie intera', () => {
  for (const frase of [
    'Mela Verde Sole Luna Mare Cielo Vento Fiume Monte',
    'Mela! Verde77 sole luna Mare9 cielo vento fiume monte lago neve pioggia',
  ]) {
    const t = `la password è «${frase}»`;
    expect(P.oscura(t), 'pavimento').toBe(`la password è «${P.SEGNAPOSTO}»`);
    expect(C.oscura(t), 'correttore').toBe(`la password è «${C.SEGNAPOSTO}»`);
  }
});

test('r2 le parole dopo la virgoletta che chiude non diventano segreti', () => {
  const t = 'la password è «Mela! Verde77» e il nome utente è «Mario Rossi» (non dirla a nessuno)';
  expect(C.oscura(t)).toBe(`la password è «${C.SEGNAPOSTO}» e il nome utente è «Mario Rossi» (non dirla a nessuno)`);
  expect(X.taintScritto('https://it.wikipedia.org/wiki/Nessuno', t, 'cerca chi era Ulisse')).toBeNull();
  expect(X.taintScritto('https://www.esempio.it/area-utente/accesso', t, 'apri la pagina di accesso')).toBeNull();
  // La password resta un dato da non far uscire in un link.
  expect(X.taintScritto('https://www.esempio.it/?q=Verde77', t, 'apri la pagina di accesso')).not.toBeNull();
});

test('r3 la password fra apici inversi, o con delle virgolette dentro, si toglie tutta', () => {
  for (const t of ['la password è `Mela! Verde77`', 'la password è «Mela "Verde" 77»']) {
    const o = P.oscura(t);
    expect(o, t).toContain(P.SEGNAPOSTO);
    expect(o, t).not.toMatch(/Mela|Verde|77/);
  }
});
