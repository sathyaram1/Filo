// r1: le parti di Chrome rifatte da Filo non devono tradirsi: un riquadro vuoto ha lo stesso window.chrome della pagina,
// e un errore lanciato da una funzione mascherata non mostra righe del codice di Filo nella traccia.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 un riquadro vuoto creato dalla pagina ha lo stesso window.chrome della pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>RIQUADRO</title><p>ok</p>');
  const r = await page.evaluate(() => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const fw = f.contentWindow;
    const chiavi = (c) => (c ? Object.keys(c).sort() : null);
    const out = {
      pagina: chiavi(window.chrome),
      riquadro: chiavi(fw.chrome),
      runtime: !!(fw.chrome && fw.chrome.runtime && typeof fw.chrome.runtime.connect === 'function'),
      tempi: !!(fw.chrome && typeof fw.chrome.csi === 'function' && typeof fw.chrome.loadTimes === 'function'),
    };
    f.remove();
    return out;
  });
  expect(r.pagina).toEqual(['app', 'csi', 'loadTimes', 'runtime']);
  expect(r).toEqual({ pagina: r.pagina, riquadro: r.pagina, runtime: true, tempi: true });
});

test('r1 la traccia di un errore lanciato da una funzione mascherata non mostra il codice di Filo', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>TRACCIA</title><p>ok</p>');
  const r = await page.evaluate(() => {
    // Le righe «at …» con una posizione (<anonymous>:riga:colonna) che stanno prima di quella del chiamante sono codice
    // di Filo: le funzioni native non ne lasciano.
    const traccia = (fn) => {
      try { fn(); return 'nessun errore'; } catch (e) {
        const righe = String(e.stack).split('\n').filter((l) => /^\s+at /.test(l));
        const chiamante = righe.findIndex((l) => /chiamante/.test(l));
        return righe.slice(0, chiamante < 0 ? righe.length : chiamante).filter((l) => /<anonymous>:\d+:\d+/.test(l));
      }
    };
    return {
      toString: traccia(function chiamante() { return Function.prototype.toString.call(1); }),
      connect: traccia(function chiamante() { return window.chrome.runtime.connect(); }),
    };
  });
  expect(r).toEqual({ toString: [], connect: [] });
});
