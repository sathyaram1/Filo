// #592 giro 19 — esplorazione: un doppio clic su OK ancora grigio conferma un
// testo che non è mai stato sotto gli occhi?
import { test, expect } from '../../fixtures/electron.mjs';
import { confirmState, mouseClickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const NEWTAB = 'filo://newtab/';

for (const extra of [1, 3, 8, 20]) {
  test(`doppio clic su OK grigio, ${extra} righe oltre il bordo`, async ({ openTab }) => {
    const page = await openTab(NEWTAB);
    // Quante righe stanno nel riquadro: si misura con un testo di prova.
    const cap = await page.evaluate(async () => {
      const righe = Array.from({ length: 200 }, (_, i) => `Riga ${i + 1}.`).join('\n');
      window.SN_CONFIRM_UI.confirm({ title: 'misura', text: righe });
      await new Promise((r) => setTimeout(r, 50));
      const s = window.SN_CONFIRM_UI._test.state();
      window.SN_CONFIRM_UI._test.click('cancel');
      return s;
    });
    const h = await page.evaluate(() => window.innerHeight);
    const lineH = 19.5;
    const maxH = Math.min(640, h - 160);
    const n = Math.floor(maxH / lineH) + extra;
    await page.evaluate((k) => {
      window.__r = undefined;
      const righe = Array.from({ length: k - 1 }, (_, i) => `Frase ${i + 1}.`).join('\n') + '\nULTIMA RIGA NASCOSTA';
      window.SN_CONFIRM_UI.confirm({ title: 'Stile', text: righe }).then((r) => { window.__r = r; });
    }, n);
    await expect(page.locator(CONFIRM_HOST)).toBeVisible();
    const s0 = await confirmState(page);
    console.log('extra', extra, 'textScrolls', s0.textScrolls, 'okDisabled', s0.okDisabled, 'h', h, 'cap', !!cap);
    const p = await page.evaluate(() => window.SN_CONFIRM_UI._test.point('ok'));
    const t0 = Date.now();
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => window.__r);
    console.log('extra', extra, 'risultato dopo doppio clic:', r, 'ms', Date.now() - t0);
    await page.screenshot({ path: `tests/.shots/g19-doppio-${extra}.png` });
    expect(r, 'un doppio clic su OK grigio ha confermato').not.toBe(true);
  });
}
