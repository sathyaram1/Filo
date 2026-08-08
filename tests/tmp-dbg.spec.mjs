import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
  <h1>Pagina con un collegamento</h1>
  <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
</body></html>`;

async function clickMenuItem(page, label, exclude, wait) {
  await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  let item = menu.locator('button', { hasText: label });
  if (exclude) item = item.filter({ hasNotText: exclude });
  await item.first().click();
  await expect(menu).toHaveCount(0);
  if (wait) await page.waitForTimeout(wait);
}

test('dbg', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  await clickMenuItem(page, 'Copia URL', 'immagine', 300);
  console.log('primo ok');
  await clickMenuItem(page, 'Salva link per dopo', null, 300);
  console.log('secondo ok');
  const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('.sn-toast')).map((el) => {
    const r = el.getBoundingClientRect();
    return { text: el.textContent, y: r.y, x: r.x, w: r.width, h: r.height };
  }));
  console.log(JSON.stringify(boxes));
  await page.screenshot({ path: 'tests/.shots/dbg-toast.png' });
});
