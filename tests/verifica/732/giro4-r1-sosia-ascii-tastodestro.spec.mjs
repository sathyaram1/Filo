// Verifica #732 giro 4: grafie latine normali (vv, rn) non sono lettere finte: il tasto destro non avvisa dove l'apertura tace.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluate } = require('../../../src/main/services/safebrowse/engine.js');
require('../../../src/shared/linkSospetto.js');
const L = globalThis.SN_LINK_SOSPETTO;

test('r1 parole italiane con «vv» e nomi con «rn» (improvvise, avviserai, stearns): nessun avviso dal tasto destro, come all\'apertura', () => {
  for (const h of ['improvvise.it', 'cene-improvvise.it', 'avviserai.it', 'ravviserai.com', 'stearns.com']) {
    const u = 'https://' + h + '/';
    expect(evaluate(u).level, h + ' apertura').toBe('safe');
    expect(L.analizza(u), h + ' tasto destro').toEqual([]);
  }
});
