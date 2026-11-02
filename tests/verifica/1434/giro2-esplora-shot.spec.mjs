// Esplorazione: si cancella prima della consegna.
import { test } from '../../fixtures/electron.mjs';

for (const tema of ['light', 'dark']) {
  test(`shot ${tema}`, async ({ openTab, testServer }) => {
    const prefs = await openTab('filo://preferences/preferences.html');
    await prefs.evaluate((t) => chrome.runtime.sendMessage({ type: self.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }), tema);
    const page = await testServer.openReady(openTab, `<!doctype html><title>S</title><body style="padding:40px;font:16px sans-serif">
      <div id="ricco" contenteditable="true" style="width:400px">Una <b><span style="background-color: rgba(255, 196, 0, 0.42)">parola</span></b> da formattare.</div></body>`);
    await page.waitForTimeout(600);
    const p = await page.evaluate(() => {
      const el = document.getElementById('ricco'); el.focus();
      const r = document.createRange(); r.selectNodeContents(el.querySelector('span'));
      getSelection().removeAllRanges(); getSelection().addRange(r);
      const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/.shots/1434-g2-acceso-${tema}.png`, clip: { x: 0, y: 0, width: 700, height: 200 } });
  });
}
