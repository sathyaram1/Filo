// #589.11 giro 2 — esplorazione: veli che il sito disegna in modi diversi dal riquadro pieno.
import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'pw-Segreta-589-undici';

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}

const pagina = (veloJs, extraHead = '') => `<!doctype html><html><head>${extraHead}</head><body style="padding:40px">
  <input id="campo" style="width:320px;font-size:16px">
  <script>
    new MutationObserver((ms, mo) => {
      if (document.querySelector('.sn-menu')) { mo.disconnect(); (${veloJs})(); }
    }).observe(document.documentElement, { childList: true, subtree: true });
  </script></body></html>`;

const VELI = {
  ombra: `() => { const v = document.createElement('div');
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;box-shadow:0 0 0 5000px #fff;pointer-events:none;z-index:2147483647';
    document.body.appendChild(v); }`,
  contorno: `() => { const v = document.createElement('div');
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;outline:5000px solid #fff;pointer-events:none;z-index:2147483647';
    document.body.appendChild(v); }`,
  pseudo: `() => { const s = document.createElement('style');
    s.textContent = 'html::after{content:"";position:fixed;inset:0;background:#fff;pointer-events:none;z-index:2147483647}';
    document.head.appendChild(s); }`,
  popover: `() => { const v = document.createElement('div'); v.popover = 'manual';
    v.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0;border:0;background:#fff;pointer-events:none';
    document.body.appendChild(v); v.showPopover(); }`,
  ombraTesto: `() => { const v = document.createElement('div');
    v.style.cssText = 'position:fixed;left:0;top:0;width:10px;height:10px;font-size:10px;color:#fff;text-shadow:0 0 0 #fff;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 0 0 #fff)';
    v.innerHTML = '<div style="width:10px;height:10px;box-shadow:0 0 0 5000px #fff"></div>';
    document.body.appendChild(v); }`,
};

for (const [nome, js] of Object.entries(VELI)) {
  test(`velo ${nome}: Incolla sotto il velo non incolla`, async ({ app, openTab, testServer }) => {
    await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
    const page = await apri(openTab, testServer, pagina(js));
    await page.locator('#campo').click({ button: 'right' });
    await expect(page.locator('.sn-menu-paste-main')).toHaveCount(1);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `tests/.shots/589-11-g2-${nome}.png` });
    const b = await page.locator('.sn-menu-paste-main').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(700);
    expect(await page.locator('#campo').inputValue(), 'gli appunti non arrivano al campo').not.toContain(SEGRETO);
  });
}

test('pagina scura per inversione: aspetto a menu aperto', async ({ app, openTab, testServer }) => {
  const page = await apri(openTab, testServer, `<!doctype html><html style="filter:invert(1) hue-rotate(180deg)"><body style="padding:40px;background:#fff;color:#000">
    <h1>Pagina in tema scuro</h1><input id="campo" style="width:320px;font-size:16px"></body></html>`);
  await page.screenshot({ path: 'tests/.shots/589-11-g2-inversa-chiuso.png' });
  await page.locator('#campo').click({ button: 'right' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/589-11-g2-inversa-aperto.png' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).filter)).toBe('none');
});
