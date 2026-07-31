// PROBE TEMPORANEO — verifica finale del buco "tasto destro dentro un iframe"
import { test, expect } from './fixtures/electron.mjs';

const INNER = `<!doctype html><html><body style="margin:0;background:#fff;font:16px/1.5 sans-serif">
  <div style="padding:24px">
    <h2 style="margin:0 0 8px">Contenuto incorporato</h2>
    <p id="p">Questo paragrafo sta dentro un iframe (come un video incorporato,
    una mappa, un riquadro dei commenti). Prova il tasto destro qui.</p>
    <p><a id="lnk" href="https://example.com/pagina">un link dentro l'iframe</a></p>
  </div>
</body></html>`;

test('tasto destro dentro un iframe: nessun menu (né Filo né nativo)', async ({ openTab, testServer }) => {
  test.setTimeout(180_000);
  const innerUrl = testServer.html(INNER);
  const html = `<!doctype html><html><body style="font:16px/1.5 sans-serif;padding:24px">
    <h1>Pagina ospite</h1>
    <p id="outside">Testo della pagina ospite: qui il tasto destro funziona.</p>
    <iframe id="f" src="${innerUrl}" style="width:640px;height:220px;border:2px solid #c45a3b"></iframe>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  await page.waitForTimeout(1500);

  // 1) sanity: fuori dall'iframe il menu di Filo compare
  await page.locator('#outside').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 4000 });
  await page.screenshot({ path: 'tests/.shots/audit-iframe-ok-fuori.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const fr = page.frameLocator('#f');

  // 2) tasto destro sul testo dentro l'iframe → NESSUN menu
  await fr.locator('#p').click({ button: 'right' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/audit-iframe-nomenu.png' });
  console.log('A) menu su testo iframe (top/frame):',
    await page.locator('.sn-menu').count(), await fr.locator('.sn-menu').count());

  // 3) tasto destro su un LINK dentro l'iframe → NESSUN menu (niente "Apri in
  //    nuova tab", "Copia URL", "Salva link per dopo", "Spiega link"…)
  await fr.locator('#lnk').click({ button: 'right' });
  await page.waitForTimeout(1000);
  console.log('B) menu su link iframe (top/frame):',
    await page.locator('.sn-menu').count(), await fr.locator('.sn-menu').count());

  // 4) selezione dentro l'iframe + Alt+E (Spiega) e Alt+T (Traduci)
  await fr.locator('#p').evaluate((el) => {
    const r = el.ownerDocument.createRange();
    r.selectNodeContents(el);
    const s = el.ownerDocument.defaultView.getSelection();
    s.removeAllRanges(); s.addRange(r);
  });
  await page.keyboard.press('Alt+e');
  await page.waitForTimeout(1500);
  console.log('C) dopo Alt+E — popup Filo (top/frame):',
    await page.locator('.sn-popup, .sn-menu, .sn-inline').count(),
    await fr.locator('.sn-popup, .sn-menu, .sn-inline').count());

  // 5) il content script è montato nell'iframe?
  const ready = await page.evaluate(() => {
    const f = document.querySelector('#f');
    try {
      return {
        filoReady: f.contentDocument.documentElement.dataset.filoReady || 'ASSENTE',
        hasChrome: typeof f.contentWindow.chrome,
      };
    } catch (e) { return { err: String(e) }; }
  });
  console.log('D) stato content script nell\'iframe:', JSON.stringify(ready));
});
