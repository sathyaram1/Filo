// Verifica #586, giro 10 — dove arriva la guardia che riporta la strada vecchia
// dello schermo su quella nuova, e dove non arriva.
//
// Il giro 9 aveva trovato che la strada vecchia della cattura schermo
// (getUserMedia con chromeMediaSource «desktop») salta la scelta di COSA si
// condivide e si prende schermo intero più audio del computer con un «Consenti»
// solo. La correzione vive nel mondo della pagina: la richiesta vecchia viene
// riscritta in quella nuova prima di partire. Qui si guarda in quali riquadri
// quella riscrittura c'è davvero — un riquadro senza guardia è la stessa porta
// riaperta.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><body style="margin:0;padding:12px">
<div id="out"></div>
<script>
  window.__stato = {};
  const forma = (w) => {
    try {
      const f = w.navigator.mediaDevices && w.navigator.mediaDevices.getUserMedia;
      if (!f) return 'assente';
      return /native code/.test(String(f)) ? 'ORIGINALE' : 'avvolta';
    } catch (e) { return 'errore:' + (e && e.name); }
  };
  window.__misura = async () => {
    const out = { principale: forma(window) };
    // 1 — riquadro scritto dalla pagina con srcdoc
    const a = document.createElement('iframe');
    a.srcdoc = '<!doctype html><html><body>a</body></html>';
    document.body.appendChild(a);
    await new Promise((r) => a.addEventListener('load', r, { once: true }));
    out.srcdoc = forma(a.contentWindow);
    // 2 — riquadro about:blank scritto a mano
    const b = document.createElement('iframe');
    document.body.appendChild(b);
    try {
      b.contentDocument.open();
      b.contentDocument.write('<!doctype html><html><body>b</body></html>');
      b.contentDocument.close();
    } catch (_) {}
    out.vuoto = forma(b.contentWindow);
    // 3 — riquadro con un indirizzo blob:, fabbricato dalla pagina
    const url = URL.createObjectURL(new Blob(['<!doctype html><html><body>c</body></html>'], { type: 'text/html' }));
    const c = document.createElement('iframe');
    c.src = url;
    document.body.appendChild(c);
    await new Promise((r) => c.addEventListener('load', r, { once: true }));
    out.blob = forma(c.contentWindow);
    window.__frames = { srcdoc: a, vuoto: b, blob: c };
    window.__stato = out;
    return out;
  };
</script></body></html>`;

test('la guardia della strada vecchia dello schermo arriva in ogni riquadro', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, PAGINA);
  const stato = await page.evaluate(() => window.__misura());
  console.log('[586 g10] dove la guardia c\'è:', JSON.stringify(stato));

  const scoperti = Object.entries(stato).filter(([, v]) => v !== 'avvolta').map(([k]) => k);
  expect(
    scoperti,
    'in questi riquadri la funzione con cui si chiede la fotocamera, il microfono e lo schermo è '
    + 'quella originale del browser, senza la guardia di Filo: da lì la strada vecchia della '
    + 'cattura schermo riparte come prima, cioè schermo intero e audio del computer senza far '
    + `scegliere niente (misurato: ${JSON.stringify(stato)})`,
  ).toEqual([]);
});
