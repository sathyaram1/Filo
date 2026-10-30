import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, domanda } from '../../helpers/gestioneMainFinto.mjs';
const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
test('debug', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const base = [domanda(100, { creataIl: 1e12 }), domanda(101, { creataIl: 1e12 + 1000 }), domanda(102, { creataIl: 1e12 + 2000 })];
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), base);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  const box = await riga(page, 'D-102').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  console.log('HOVER', await riga(page, 'D-102').evaluate((e) => e.matches(':hover')));
  console.log('INFO', await page.evaluate(() => {
    const l = document.getElementById('mgDomandeLista');
    const out = [];
    for (let el = l; el && el !== document.body; el = el.parentElement) out.push(`${el.id || el.className}:${getComputedStyle(el).overflowY}:${el.scrollHeight}/${el.clientHeight}`);
    return out.join(' | ') + ' LIVE=' + !!window.SN_FEEDBACK_LIVE;
  }));
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), [domanda(99, { creataIl: 1 }), ...base]);
  await expect(riga(page, 'D-99')).toHaveCount(1);
  console.log('DOPO', await page.evaluate(() => document.getElementById('mgDomandeLista').getAttribute('style')), (await riga(page, 'D-102').boundingBox()).y, box.y);
});
