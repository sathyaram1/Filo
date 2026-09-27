import { test, expect } from '../../fixtures/electron.mjs';

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('esplora: mappa d\'immagine', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <img id="clic" src="${PX}" usemap="#m" width="300" height="200" style="background:#e07b39">
    <map name="m"><area shape="rect" coords="0,0,300,200" href="https://paypa1.com/login" alt="Accedi"></map></body></html>`);
  await page.locator('#clic').click({ button: 'right', position: { x: 30, y: 30 } });
  await page.waitForTimeout(1500);
  const menu = page.locator('.sn-menu');
  console.log('MAPPA visibile', await menu.isVisible());
  console.log('MAPPA testo', (await menu.innerText().catch(() => '')).replace(/\n+/g, ' | '));
  console.log('MAPPA warn', await page.locator('.sn-menu .sn-menu-link-warn').count());
});

test('esplora: link SVG', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <svg width="300" height="120"><a href="https://paypa1.com/login"><rect id="clic" width="300" height="120" fill="#e07b39"/><text x="20" y="60">PayPal</text></a></svg></body></html>`);
  await page.locator('#clic').click({ button: 'right', position: { x: 30, y: 30 } });
  await page.waitForTimeout(1500);
  const menu = page.locator('.sn-menu');
  console.log('SVG visibile', await menu.isVisible());
  console.log('SVG testo', (await menu.innerText().catch(() => '')).replace(/\n+/g, ' | '));
  console.log('SVG warn', await page.locator('.sn-menu .sn-menu-link-warn').count());
});
