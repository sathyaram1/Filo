// Esplorazione giro 2 #1697: conferma del cestino. Solo log.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(120_000);
function log(...a) { console.log('[ESPLORA]', ...a); }
const KEY = 'filo.editor.collection';

test('C1 elimina definitivamente cliccato due volte nel terzo sinistro, anche a finestra stretta', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  for (const largh of [1200, 520]) {
    await page.setViewportSize({ width: largh, height: 800 }).catch(() => {});
    await page.click('#doc');
    await page.keyboard.type(`documento da buttare ${largh}`);
    await page.waitForTimeout(400);
    await page.click('#docTitle', { button: 'right' });
    await page.click('.ed-title-ctxmenu .sn-select-option:has-text("Elimina file")');
    await page.waitForTimeout(300);
    await page.click('#docTitle', { button: 'right' });
    await page.click('.ed-title-ctxmenu .sn-select-option:has-text("Cestino")');
    const b = page.locator('.ed-tr-purge').first();
    const r = page.locator('.ed-tr-restore').first();
    const s1 = await b.boundingBox();
    const sr1 = await r.boundingBox();
    const x = s1.x + s1.width / 6, y = s1.y + s1.height / 2;
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
    const s2 = await b.boundingBox();
    const sr2 = await r.boundingBox();
    log('C1', largh, 'prima', JSON.stringify(s1), 'dopo', JSON.stringify(s2), 'ripristina', JSON.stringify(sr1), JSON.stringify(sr2), 'scritta', await b.textContent());
    await page.screenshot({ path: `tests/.shots/1697-cestino-${largh}.png` });
    await page.mouse.click(x, y);
    await page.waitForTimeout(400);
    const cestino = await page.evaluate(() => JSON.parse(localStorage.getItem('filo.editor.trash') || '[]').length).catch(() => 'n/d');
    const aperti = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).files.map((f) => f.meta.title), KEY);
    const voci = await page.locator('.ed-tr-item').count();
    log('C1', largh, 'voci cestino a video', voci, 'cestino salvato', cestino, 'aperti', JSON.stringify(aperti));
    await page.keyboard.press('Escape');
    await page.locator('#ovClose').click().catch(() => {});
  }
});
