// #589.11 giro 1, rilievo 1: il velo bianco del sito appeso DENTRO il menu, o il menu reso trasparente dal sito,
// non viene visto dalla guardia: l'utente vede solo il velo e il clic incolla lo stesso.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoCronologia, testiCronologia } from '../../helpers/cronologiaAppunti.mjs';

const SEGRETO = 'pw-Segreta-589-undici';

async function apri(openTab, testServer, html) {
  const page = await testServer.openReady(openTab, html);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  return page;
}

async function centro(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('un velo bianco appeso dentro il menu fa incollare la password della cronologia senza vederla', async ({ app, shell, openTab, testServer }) => {
  test.fail(true, 'porta dichiarata: la chiude il menu disegnato fuori dalla pagina, lavoro a parte deciso dall\'owner (D14)');
  for (const text of ['un testo qualsiasi', SEGRETO]) {
    await shell.evaluate((t) => window.filoShell.message({ type: 'push_clipboard_entry', entry: { type: 'text', text: t } }), text);
  }
  const page = await apri(openTab, testServer, `<!doctype html><html><body style="padding:40px">
    <input id="campo" style="width:320px;font-size:16px">
    <script>
      const velo = () => { const v = document.createElement('div'); v.className = 'velo';
        v.style.cssText = 'position:fixed;left:-3000px;top:-3000px;width:9000px;height:9000px;background:#fff;pointer-events:none;z-index:99';
        return v; };
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.classList.contains('sn-menu')) n.appendChild(velo());
          else if (n.hasAttribute('data-sn-ui') && !n.hasAttribute('aria-hidden')) n.style.setProperty('opacity', '0', 'important');
        }
      }).observe(document.documentElement, { childList: true });
    </script></body></html>`);

  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu .velo')).toHaveCount(1);
  const freccia = await centro(page.locator('.sn-menu-paste-arrow'));
  await page.mouse.move(freccia.x, freccia.y, { steps: 4 });
  await expect.poll(() => testiCronologia(app, page)).toContain(SEGRETO);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/589-11-r1-cronologia.png' });
  const voce = (await statoCronologia(app, page)).voci.find((v) => v.testo === SEGRETO);
  await page.mouse.move(voce.incolla.x, voce.incolla.y, { steps: 4 });
  await page.mouse.click(voce.incolla.x, voce.incolla.y);
  await page.waitForTimeout(600);
  expect(await page.locator('#campo').inputValue(), 'la password non arriva al campo del sito').not.toContain(SEGRETO);
});

test('il foglio di stile del sito rende trasparente il menu: Incolla sotto il velo non incolla', async ({ app, openTab, testServer }) => {
  test.fail(true, 'porta dichiarata: la chiude il menu disegnato fuori dalla pagina, lavoro a parte deciso dall\'owner (D14)');
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await apri(openTab, testServer, `<!doctype html><html><head>
    <style>.sn-menu { opacity: 0 !important; }</style></head>
    <body style="padding:40px;background:#fff">
    <p style="font:20px sans-serif">Clicca i quadrati per continuare</p>
    <input id="campo" style="width:320px;font-size:16px"></body></html>`);
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toHaveCount(1);
  expect(await page.locator('.sn-menu').first().evaluate((m) => getComputedStyle(m).opacity)).toBe('0');
  await page.waitForTimeout(800);
  const incolla = await centro(page.locator('.sn-menu-paste-main'));
  await page.mouse.move(incolla.x, incolla.y, { steps: 3 });
  await page.mouse.click(incolla.x, incolla.y);
  await page.waitForTimeout(600);
  expect(await page.locator('#campo').inputValue(), 'gli appunti non arrivano al campo del sito').not.toContain(SEGRETO);
});
