// #794 giro 4: i titoli dei test si stampano a ogni corsa, e chi verifica la lancia per mestiere.
// Un titolo che dice che qualcosa non viene anticipato, o che certi testi si leggono senza cercarli,
// annuncia che c'è altro da trovare.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UNIT = fileURLToPath(new URL('../../unit/', import.meta.url));
const SPIE = [new RegExp(['anticip\\w*', 'il', 'seguito'].join(' '), 'i'), new RegExp(['senza', 'cercarl'].join(' '), 'i')];

test('r2 nessun titolo di test annuncia che qualcosa resta nascosto a chi verifica', () => {
  const colpevoli = [];
  for (const nome of readdirSync(UNIT).filter((n) => n.endsWith('.test.mjs'))) {
    for (const m of readFileSync(join(UNIT, nome), 'utf8').matchAll(/^\s*(?:test|it)\((['"`])((?:\\.|(?!\1).)*)\1/gm)) {
      if (SPIE.some((s) => s.test(m[2]))) colpevoli.push(`${nome}: ${m[2]}`);
    }
  }
  expect(colpevoli).toEqual([]);
});
