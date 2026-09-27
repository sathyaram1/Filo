// Verifica locale, giro 3: la pulizia registrata ne ha dimenticata una, e chi corregge toglie la prova rossa di un
// rilievo messo da parte (qui un esterno). La consegna si ferma, giusto, ma lo manda a correggerlo finché è verde.

import { test, expect } from '@playwright/test';
import { copia, RIASSUNTO, REPORT } from './giro3-copia.mjs';

let c;
test.beforeAll(async () => { test.setTimeout(300_000); c = await copia(); });
test.afterAll(() => { if (c) c.chiudi(); });

test('la consegna non manda a correggere la prova di un rilievo messo da parte', async () => {
  test.setTimeout(300_000);
  const cart = await c.ramo('dimenticata', ['a', 'b', 'x']);
  for (const [n, k] of [[1, 'a'], [2, 'b'], [3, 'x']]) c.prova(cart, `giro3-r${n}-${k}.spec.mjs`, [k]);
  c.commit('prove del giro');
  const critica = await c.vl('critica', [RIASSUNTO, '[2i] rilievo a: la cosa a non funziona.',
    '[1i?] rilievo b: bordo grigio o caldo? Scelta di gusto.', '[1e] rilievo x: un difetto di un altro lavoro.'].join('\n'));
  expect(critica.out).toContain('r3 [1e]');
  c.git('rm', '-q', `${cart}/giro3-r2-b.spec.mjs`);
  c.commit('pulizia del giro');
  expect((await c.vl('pulizia')).status).toBe(0);
  c.scrivi('stato-a.txt', 'corretto\n');
  c.git('rm', '-q', `${cart}/giro3-r3-x.spec.mjs`);
  c.commit('correggo a, e tolgo la prova di x che è di un altro lavoro');
  const consegna = await c.vl('corretto', REPORT);
  expect(consegna.status).not.toBe(0);
  // x è di un altro lavoro: chi corregge qui non lo deve toccare. La prova si rimette e si lascia com'è.
  expect(consegna.out).not.toMatch(/correggi finché è verde/);
});
