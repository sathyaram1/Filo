// Esplorazione del giro 1 di #2100: la correzione dal tasto destro, col menu nella pagina e nello strato.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('tests/.shots', { recursive: true });

const TA = `<!doctype html><html><body style="margin:0">
<textarea id="ta" spellcheck="true" style="font:16px monospace;padding:8px;width:400px;height:120px">ciiao come stai</textarea>
</body></html>`;

async function nativi(app, host) {
  return app.evaluate(({ webContents }, host) => {
    const t = webContents.getAllWebContents().filter((w) => { try { return new URL(w.getURL()).host === host; } catch { return false; } });
    for (const wc of t) wc.send('filo:broadcast', { type: '_spell:native', word: 'ciiao', suggestions: ['ciao', 'chiao'] });
    return t.length;
  }, host);
}

for (const strato of [false, true]) {
  test.describe(`strato ${strato}`, () => {
    test.use({ stratoDelMenu: strato });
    test(`correzione cliccata sostituisce la parola (strato ${strato})`, async ({ app, openTab, testServer }) => {
      const url = testServer.html(TA);
      const page = await openTab(url);
      await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
      await nativi(app, new URL(url).host);
      await page.waitForFunction(() => document.documentElement.dataset.filoNativeWord === 'ciiao', null, { timeout: 8000 });
      const box = await page.locator('#ta').boundingBox();
      await page.mouse.click(box.x + 16, box.y + 16, { button: 'right' });
      const m = menuDi(page);
      await expect(m.principale).toBeVisible();
      await expect(m.primaVoce).toContainText('ciao', { timeout: 4000 });
      const ordine = await m.valuta(() => [...document.querySelectorAll('.sn-menu:not(.sn-menu-sub) > *')]
        .filter((e) => e.offsetParent !== null).map((e) => `${e.className}|${(e.textContent || '').trim().slice(0, 30)}`));
      console.log('ORDINE', strato, JSON.stringify(ordine));
      await m.superficie.screenshot({ path: `tests/.shots/v2100-strato-${strato}.png` });
      await m.primaVoce.click();
      await expect.poll(() => page.locator('#ta').inputValue()).toBe('ciao come stai');
    });
  });
}
