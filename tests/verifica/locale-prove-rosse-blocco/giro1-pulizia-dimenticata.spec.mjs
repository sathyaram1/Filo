// Verifica locale, giro 1 (ramo claude/prove-rosse-blocco): senza la pulizia registrata, la consegna che
// toglie la prova rossa di un rilievo messo da parte si ferma, ma non racconta una pulizia che non c'è stata.

import { test, expect } from '@playwright/test';
import { giroFinto, CRITICA, REPORT } from './_giro-finto.mjs';

test.setTimeout(240_000);

test('pulizia saltata: la consegna si ferma e dice che la pulizia non è stata registrata', async () => {
  const g = await giroFinto();
  try {
    expect((await g.verify('start', 'richiesta del giro finto')).code).toBe(0);
    expect((await g.verify('critica', CRITICA)).out).toContain("c'è da correggere");
    g.scrivi('a-corretto c-corretto');
    g.togli('b');
    g.commit('corretti a e c, tolta la prova di b');
    const consegna = await g.verify('corretto', REPORT);
    expect(consegna.code).not.toBe(0);
    expect(consegna.out).toContain('giro1-b.spec.mjs');
    expect(consegna.out).not.toContain('sono uscite prima, nel commit della pulizia');
  } finally {
    g.chiudi();
  }
});
