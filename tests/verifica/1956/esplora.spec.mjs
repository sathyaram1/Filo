// Esplorazione del giro 2 di verifica #1956: schermate e casi limite. Si cancella prima della critica.
import { mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';

const NOVITA = 'filo://novita/novita.html';
const SHOTS = 'tests/.shots';

async function apri(openTab, url = NOVITA) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.body.dataset.pronto === '1', null, { timeout: 10_000 });
  return page;
}

test('schermate chiaro, scuro, stretto, recap', async ({ app, openTab }) => {
  mkdirSync(SHOTS, { recursive: true });
  const page = await apri(openTab);
  await page.screenshot({ path: `${SHOTS}/v2-chiaro.png` });
  await page.locator('#cerca').fill('scheda');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/v2-chiaro-cerca.png` });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/v2-scuro-cerca.png` });
  await page.locator('#cerca').fill('😀😀 <img src=x onerror=alert(1)>');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/v2-scuro-vuoto.png` });
  console.log('VUOTO', await page.locator('#vuoto').innerText());
  await page.locator('#cerca').fill('x'.repeat(5000));
  await page.waitForTimeout(500);
  console.log('LUNGO', (await page.locator('#vuoto').innerText()).length);
  await page.locator('#cerca').fill('   ');
  await page.waitForTimeout(300);
  console.log('SPAZI', await page.locator('#conta').innerText(), await page.locator('.nv-riga').count());
  // Battitura veloce: deve restare coerente con l'ultimo valore.
  await page.locator('#cerca').fill('');
  await page.locator('#cerca').pressSequentially('traduzione', { delay: 5 });
  await page.waitForTimeout(400);
  const righe = await page.locator('.nv-riga').allInnerTexts();
  console.log('TRAD', righe.length, righe.every((t) => /tradu/i.test(t)));
  // Parole frequenti con errore e numero di versione.
  for (const q of ['0.2.250', 'otobre', 'segnalazione', 'scheda chiusa', 'download pdf', '1691', '#1691']) {
    await page.locator('#cerca').fill(q);
    await page.waitForTimeout(300);
    console.log('Q', q, '|', await page.locator('#conta').innerText(), '|', await page.locator('#avviso').isVisible() ? await page.locator('#avviso').innerText() : '');
  }
  const t0 = Date.now();
  await page.locator('#cerca').fill('qwzx aggiornamneto');
  await page.waitForTimeout(150);
  console.log('TEMPO', Date.now() - t0, await page.locator('#conta').innerText());

  await page.setViewportSize({ width: 420, height: 800 });
  await page.locator('#cerca').fill('');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/v2-scuro-stretto.png` });

  const home = await openTab('filo://newtab/');
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw(globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION, '0.2.250');
  });
  await home.reload();
  await expect(home.locator('#recapOverlay')).toBeVisible({ timeout: 10_000 });
  await home.waitForTimeout(600);
  await home.screenshot({ path: `${SHOTS}/v2-recap.png` });
});

test('owner: tasto destro su una riga vera offre «Apri la segnalazione»', async ({ app, openTab }) => {
  const page = await apri(openTab);
  const conNumero = await page.locator('.nv-segn').count();
  console.log('NUMERI VISIBILI (non owner)', conNumero);
});
