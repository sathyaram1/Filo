// Verifica #810.8 giro 12: scrivere in fondo a un documento lungo in un editor della pagina resta fluido.
import { test, expect } from '../../fixtures/electron.mjs';

test('scrivere in fondo a un documento lungo non blocca la pagina per secondi', async ({ openTab, testServer }) => {
  test.setTimeout(120_000);
  const par = Array.from({ length: 8000 }, (_, i) => `<p>Paragrafo ${i} con un po' di testo per fare volume, parole e ancora parole qui.</p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Doc</title></head><body>
    <div id="ed" contenteditable="true">${par}</div></body></html>`);
  await page.locator('#ed').focus();
  await page.evaluate(() => {
    const ed = document.getElementById('ed');
    const r = document.createRange(); r.selectNodeContents(ed.lastElementChild); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    window.__lunghi = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lunghi.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  const frase = 'Una frase scritta in fondo a un documento lungo.';
  const t0 = Date.now();
  await page.keyboard.type(frase, { delay: 30 });
  const durata = Date.now() - t0;
  const lunghi = await page.evaluate(() => window.__lunghi);
  console.log('durata', durata, 'compiti lunghi', lunghi.join(','));
  await expect(page.locator('#ed p').last()).toContainText(frase);
  expect(Math.max(0, ...lunghi), 'la pagina resta ferma più di mezzo secondo mentre l’utente scrive').toBeLessThan(500);
});
