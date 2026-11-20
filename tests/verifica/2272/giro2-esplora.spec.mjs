// Esplorazione del giro 2: tasto destro sulle foto, lightbox, risposta di sole immagini, marcatore in un elenco.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { NEWTAB, preparaImmagini, stubModello, chiedi } from './aiuti.mjs';

test('tasto destro: copia immagine e indirizzo', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 3);
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco.\n\n[[immagini: $ID0, $ID1, $ID2]]\n\nFine.' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco.' });
  await expect(bolla.locator('.filo-galleria-img')).toHaveCount(3, { timeout: 30_000 });
  const img = bolla.locator('.filo-galleria-img').first();
  await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  await app.evaluate(({ clipboard }) => clipboard.clear());
  await img.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voci.first()).toBeVisible({ timeout: 10_000 });
  const etichette = await menu.locator('.sn-menu-item, [data-tip], [title]').evaluateAll((els) => els.map((e) => (e.textContent || '').trim() + ' | ' + (e.getAttribute('data-tip') || e.getAttribute('title') || '')));
  console.log('MENU', JSON.stringify(etichette));
  await page.screenshot({ path: 'tests/.shots/2272-g2-menu.png' }).catch(() => {});
  const copia = menu.locator('[data-tip="Copia immagine"], [title="Copia immagine"], .sn-menu-item:has-text("Copia immagine")').first();
  await copia.click();
  await page.waitForTimeout(1500);
  const dopoCopia = await app.evaluate(async ({ clipboard }) => (await clipboard.read()).map((v) => v.types));
  console.log('COPIA', JSON.stringify(dopoCopia));
  await page.keyboard.press('Escape');

  await app.evaluate(({ clipboard }) => clipboard.clear());
  await img.click({ button: 'right' });
  const url = menu.locator('[data-tip*="URL"], [title*="URL"], [data-tip*="ndirizzo"], .sn-menu-item:has-text("URL"), .sn-menu-item:has-text("ndirizzo")').first();
  if (await url.count()) {
    await url.click();
    await page.waitForTimeout(800);
    console.log('URL', JSON.stringify(await app.evaluate(async ({ clipboard }) => clipboard.readText())));
  } else console.log('URL nessuna voce');
  await page.keyboard.press('Escape');

  // Lightbox in tema scuro
  await page.evaluate(() => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await img.click();
  await expect(page.locator('#lightbox.open img')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/2272-g2-lightbox.png' }).catch(() => {});
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  console.log('LIGHTBOX dopo freccia', await page.locator('#lightbox.open img').getAttribute('src'), await img.getAttribute('src'));
  await page.keyboard.press('Escape');
});

test('salva immagine come', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g2salva-')), 'foto.png');
  await preparaImmagini(app, 2);
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'antilope' } }, { testo: 'Ecco.\n\n[[immagini: $ID0, $ID1]]' }]);
  await app.evaluate(({ dialog }, dest) => {
    const f = async () => ({ canceled: false, filePath: dest });
    try { dialog.showSaveDialog = f; } catch (e) { console.log('no stub', e.message); }
  }, dest);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope immagine');
  const img = page.locator('.dash-bubble-filo .filo-galleria-img').first();
  await expect.poll(() => img.evaluate((e) => e.complete && e.naturalWidth > 0), { timeout: 30_000 }).toBe(true);
  await img.click({ button: 'right' });
  await menuDi(page).voce('Salva immagine come').click();
  await page.waitForTimeout(4000);
  console.log('SALVA', dest, fs.existsSync(dest) ? fs.statSync(dest).size : 'manca', fs.readdirSync(path.dirname(dest)));
  console.log('TOAST', await page.locator('.sn-toast, [class*=toast]').allTextContents().catch(() => []));
});

test('risposta di sole immagini, marcatore dentro un elenco, finestra stretta', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 4);
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'antilope' } }, { testo: 'Tre specie:\n\n- Impala\n[[immagine: $ID0]]\n- Gazzella\n[[immagine: $ID1]]\n- Kudu: [[immagini: $ID2, $ID3]] grande.' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilopi in elenco con foto');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Tre specie' });
  await expect(bolla).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  console.log('ELENCO', await bolla.evaluate((b) => b.innerHTML.replace(/src="[^"]+"/g, 'src=…').slice(0, 3000)));
  await page.screenshot({ path: 'tests/.shots/2272-g2-elenco.png' }).catch(() => {});
  await page.setViewportSize({ width: 520, height: 800 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/2272-g2-stretta.png' }).catch(() => {});
});

test('solo marcatore, niente testo', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaImmagini(app, 2);
  await stubModello(app, [{ strumento: { azione: 'immagini', query: 'antilope' } }, { testo: '[[immagini: $ID0, $ID1]]' }]);
  const page = await openTab(NEWTAB);
  await chiedi(page, 'antilope');
  await expect(page.locator('.dash-bubble-filo .filo-galleria-img')).toHaveCount(2, { timeout: 30_000 });
  await page.reload();
  await expect(page.locator('.dash-bubble-filo .filo-galleria-img')).toHaveCount(2, { timeout: 30_000 });
  await page.screenshot({ path: 'tests/.shots/2272-g2-solo.png' }).catch(() => {});
});
