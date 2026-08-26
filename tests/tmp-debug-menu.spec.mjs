import { test, expect } from './fixtures/electron.mjs';

test('debug geometria menu', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="height:65vh;padding:16px">Testo in cima alla pagina.</div>
    <a id="link" href="https://example.com/x" style="display:inline-block;padding:8px">un collegamento in fondo</a>
  </body></html>`);
  await page.locator('#link').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const dump = await page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    const box = menu.querySelector('.sn-menu-inline');
    const cs = getComputedStyle(menu);
    const before = {
      vh: window.innerHeight, dpr: devicePixelRatio,
      rect: JSON.parse(JSON.stringify(menu.getBoundingClientRect())),
      offsetHeight: menu.offsetHeight,
      boxSizing: cs.boxSizing, padding: cs.paddingTop + '/' + cs.paddingBottom,
      border: cs.borderTopWidth + '/' + cs.borderBottomWidth,
      transform: menu.style.transform,
    };
    box.style.minHeight = `${window.innerHeight + 400}px`;
    return { before };
  });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    return {
      vh: window.innerHeight,
      rect: JSON.parse(JSON.stringify(menu.getBoundingClientRect())),
      offsetHeight: menu.offsetHeight,
      styleMaxH: menu.style.maxHeight,
      styleTop: menu.style.top,
      scrollH: menu.scrollHeight,
      clientH: menu.clientHeight,
    };
  });
  console.log('BEFORE', JSON.stringify(dump.before));
  console.log('AFTER', JSON.stringify(after));

  // secondo caso: crescita moderata
  await page.keyboard.press('Escape');
  await page.locator('#link').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  const g2 = await page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    const box = menu.querySelector('.sn-menu-inline');
    const bottom = menu.getBoundingClientRect().bottom;
    const delta = Math.round(window.innerHeight - bottom + 40);
    box.style.minHeight = `${Math.round(box.getBoundingClientRect().height) + delta}px`;
    return { bottom, delta, vh: window.innerHeight };
  });
  await page.waitForTimeout(600);
  const after2 = await page.evaluate(() => {
    const menu = document.querySelector('.sn-menu');
    return {
      vh: window.innerHeight,
      rect: JSON.parse(JSON.stringify(menu.getBoundingClientRect())),
      offsetHeight: menu.offsetHeight,
      styleMaxH: menu.style.maxHeight, styleTop: menu.style.top,
      scrollH: menu.scrollHeight, clientH: menu.clientHeight,
    };
  });
  console.log('G2', JSON.stringify(g2));
  console.log('AFTER2', JSON.stringify(after2));
});
