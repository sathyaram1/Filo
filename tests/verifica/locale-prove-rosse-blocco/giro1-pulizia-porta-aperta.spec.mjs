// Verifica locale, giro 1 (ramo claude/prove-rosse-blocco): una prova del giro ancora rossa, di un rilievo
// DA correggere, non esce di scena passando dal commit della pulizia (la porta di #679 per un'altra strada).

import { test, expect } from '@playwright/test';
import { giroFinto, CRITICA, REPORT } from './_giro-finto.mjs';

test.setTimeout(240_000);

test('la pulizia non fa passare una consegna col rilievo c ancora aperto', async () => {
  const g = await giroFinto();
  try {
    expect((await g.verify('start', 'richiesta del giro finto')).code).toBe(0);
    const critica = await g.verify('critica', CRITICA);
    expect(critica.out).toContain("c'è da correggere");
    // Messo da parte c'è solo b; c è da correggere, e la sua prova è rossa.
    g.togli('b', 'c');
    g.commit('pulizia del giro');
    const pulizia = await g.verify('pulizia');
    g.scrivi('a-corretto');
    g.commit('corretto solo a');
    const consegna = pulizia.code === 0 ? await g.verify('corretto', REPORT) : { code: 1, out: '' };
    expect(pulizia.code !== 0 || consegna.code !== 0,
      `pulizia e consegna passate entrambe con il rilievo c aperto:\n${pulizia.out}\n${consegna.out}`).toBe(true);
  } finally {
    g.chiudi();
  }
});
