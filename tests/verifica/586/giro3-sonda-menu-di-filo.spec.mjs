// Verifica #586, giro 3 — SONDA: le due cose che Filo chiede per conto proprio
// dentro una pagina (il microfono della dettatura, gli appunti dell'Incolla)
// non passano dalla domanda. Se il codice della pagina riuscisse a far partire
// quei gesti da solo, si prenderebbe microfono e appunti senza che compaia
// niente. Qui si guarda se il menu di Filo è raggiungibile dal codice del sito.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="margin:0;padding:20px">
<textarea id="ta" rows="4" cols="40"></textarea>
<p id="p">testo qualunque da selezionare</p>
<script>
  window.__menuDopoTastoDestroFinto = () => {
    const t = document.getElementById('ta');
    t.focus();
    t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 }));
    return new Promise((r) => setTimeout(() => {
      const nodi = [...document.querySelectorAll('*')]
        .filter((n) => typeof n.className === 'string' && /sn-menu|sn-popup|filo/i.test(n.className))
        .map((n) => n.className);
      r(nodi.slice(0, 20));
    }, 600));
  };
  window.__tuttiIRoot = () => {
    // Quello che il sito riesce a vedere: quanti elementi con una radice
    // d'ombra APERTA ci sono (una chiusa non si apre dal codice della pagina).
    let aperte = 0, totali = 0;
    for (const n of document.querySelectorAll('*')) { totali++; if (n.shadowRoot) aperte++; }
    return { totali, aperte };
  };
</script></body></html>`;

test('sonda: il menu di Filo risponde a un tasto destro finto del sito?', async ({ shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const page = await testServer.openReady(openTab, HTML);

  const nodi = await page.evaluate(() => window.__menuDopoTastoDestroFinto());
  console.log('[586 g3] nodi di Filo visti dal sito dopo un tasto destro finto:', JSON.stringify(nodi));
  console.log('[586 g3] radici d\'ombra:', JSON.stringify(await page.evaluate(() => window.__tuttiIRoot())));

  // Tasto destro VERO, per confronto: il menu di Filo esiste e il sito lo vede?
  await page.locator('#ta').click({ button: 'right' });
  await page.waitForTimeout(700);
  const veri = await page.evaluate(() => [...document.querySelectorAll('*')]
    .filter((n) => typeof n.className === 'string' && /sn-menu/i.test(n.className))
    .map((n) => n.className).slice(0, 20));
  console.log('[586 g3] nodi del menu dopo un tasto destro VERO:', JSON.stringify(veri));
  expect(true).toBe(true);
});
