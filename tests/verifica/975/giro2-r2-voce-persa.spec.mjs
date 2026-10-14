// #975 giro 2, rilievo 2 — la voce scelta dove il sito non mostra un menu sparisce da tutta la pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const voci = (page) => page.locator('.sn-menu .sn-menu-split-main', { hasText: /^Menu di/ });

// Un ascoltatore sul documento che apre il menu solo su alcuni elementi (posta, file): la voce scelta altrove.
const DELEGATO = `<!doctype html><html><head><meta charset="utf-8"><meta property="og:site_name" content="Posta">
<style>#menu-suo { position: fixed; width: 160px; height: 120px; background: #eee; border: 1px solid #999 }</style>
<script>
  document.addEventListener('contextmenu', function (e) {
    if (!e.target.closest || !e.target.closest('#area')) return;
    e.preventDefault();
    var m = document.getElementById('menu-suo'); m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.hidden = false;
  });
  document.addEventListener('click', function () { document.getElementById('menu-suo').hidden = true; });
</script></head><body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="area" style="width:420px;height:120px;background:#cde">un messaggio</div>
  <p id="libero" style="width:420px">testo di un messaggio aperto</p>
  <div id="menu-suo" hidden>menu del sito</div>
</body></html>`;
test('r2 la voce scelta dove il sito non ha menu non sparisce dove il menu ce l\'ha', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, DELEGATO);
  await page.locator('#libero').click({ button: 'right' });
  const primaVoce = await voci(page).count();
  if (primaVoce) await voci(page).click();
  await page.waitForTimeout(1500);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => { if (w.webContents.getURL().startsWith('data:text/html')) w.close(); }));
  await page.keyboard.press('Escape');
  await page.mouse.click(700, 500);
  await page.locator('#area').click({ button: 'right', position: { x: 60, y: 50 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  expect(primaVoce).toBe(1);
  await expect(voci(page)).toHaveCount(1);
});
