// Sonda XSS (#498): il nome/testo di una segnalazione finisce nella lista e nel
// dettaglio della pagina di gestione. Verifica che resti TESTO.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('sonda: nome e testo con markup restano testo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));

  await page.evaluate(() => {
    window.__xssColpito = false;
    window.__mgTest.setData([{
      id: 'fb-x', seq: 999, subSeq: 0, num: '#999',
      name: '<script>window.__xssColpito = true;</script><img src=x onerror="window.__xssColpito=true">',
      text: '<script>window.__xssColpito = true;</script>',
      status: 'new', createdAt: { _seconds: 1787421271 },
      url: 'javascript:alert(1)', images: [], clientId: 'cx',
    }]);
  });
  await page.waitForTimeout(600);

  const html = await page.locator('#mgList').innerHTML();
  console.log('XSS innerHTML lista:', html.slice(0, 1200));
  const colpito = await page.evaluate(() => window.__xssColpito === true);
  console.log('XSS eseguito?', colpito);
  const nScript = await page.evaluate(() => document.querySelectorAll('#mgList script, #mgList img').length);
  console.log('XSS nodi script/img nella lista:', nScript);

  // Apri il dettaglio: stessa domanda al centro.
  const riga = page.locator('#mgList .mg-item, #mgList [data-id]').first();
  if (await riga.count()) {
    await riga.click();
    await page.waitForTimeout(500);
    const colpito2 = await page.evaluate(() => window.__xssColpito === true);
    console.log('XSS eseguito dopo apertura dettaglio?', colpito2);
    const d = await page.locator('#mgDetail').innerHTML();
    console.log('XSS innerHTML dettaglio:', d.slice(0, 1500));
  }
  expect(colpito).toBe(false);
});
