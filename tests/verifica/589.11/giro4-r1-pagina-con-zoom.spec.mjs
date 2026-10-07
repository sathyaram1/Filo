// #589.11 giro 4, rilievo 1: su una pagina con lo zoom sulla radice la guardia guarda nel posto sbagliato (un velo
// steso solo sul menu non la ferma) e il menu stesso esce dallo schermo.
import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'pw-Segreta-589-undici';

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}

test('r1 un velo steso solo sopra il menu, su una pagina con zoom, non fa incollare gli appunti', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html style="zoom:2"><body style="padding:20px;margin:0">
    <input id="campo" style="width:200px;font-size:16px">
    <script>
      new MutationObserver((ms, mo) => {
        const m = document.querySelector('.sn-menu');
        if (!m) return; mo.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const r = m.getBoundingClientRect();
          const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
          const v = document.createElement('div'); v.id = 'velo';
          v.style.cssText = 'position:fixed;background:#fff;pointer-events:none;z-index:2147483647;left:' + (r.left / z)
            + 'px;top:' + (r.top / z) + 'px;width:' + (r.width / z) + 'px;height:' + (r.height / z) + 'px';
          document.body.appendChild(v);
        }));
      }).observe(document.documentElement, { childList: true, subtree: true });
    </script></body></html>`);
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('#velo')).toHaveCount(1);
  await page.waitForTimeout(900);
  const b = await page.locator('.sn-menu-paste-main').boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.click(x, y);
  await page.waitForTimeout(600);
  expect(await page.locator('#campo').inputValue(), 'gli appunti arrivano al campo sotto il velo').not.toContain(SEGRETO);
});

test('r1 su una pagina con zoom il menu si apre a schermo, accanto al campo, e Incolla incolla', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html style="zoom:1.5"><body style="margin:0">
    <input id="campo" style="position:absolute;right:20px;top:200px;width:150px;font-size:16px"></body></html>`);
  await page.locator('#campo').click({ button: 'right' });
  const incolla = page.locator('.sn-menu-paste-main');
  await expect(incolla).toHaveCount(1);
  await page.waitForTimeout(700);
  const b = await incolla.boundingBox();
  const vw = await page.evaluate(() => innerWidth);
  const vh = await page.evaluate(() => innerHeight);
  expect(b.x + b.width <= vw && b.y + b.height <= vh, `Incolla fuori dallo schermo: ${JSON.stringify(b)}`).toBe(true);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});
