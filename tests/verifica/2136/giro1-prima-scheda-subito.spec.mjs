// #2136 giro 1 (esplorazione): una valutazione delle prove entra a metà del codice sincrono del processo principale?
import { test, expect } from '../../fixtures/electron.mjs';

test('una valutazione arriva mentre il processo principale è in un ciclo sincrono', async ({ app }) => {
  await app.evaluate(() => {
    globalThis.__fase = 'attesa';
    setTimeout(() => {
      globalThis.__fase = 'dentro';
      const fine = Date.now() + 3000;
      let n = 0;
      while (Date.now() < fine) { n++; if (n % 1e6 === 0) globalThis.__giri = n; }
      globalThis.__fase = 'fuori';
    }, 200);
  });
  await new Promise((r) => setTimeout(r, 1200));
  const visto = await app.evaluate(() => globalThis.__fase);
  console.log('fase vista dalla valutazione:', visto);
  expect(visto).toBe('dentro');
});
