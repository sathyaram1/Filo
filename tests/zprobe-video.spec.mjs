import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><body style="margin:0;font:16px system-ui;background:#fff">
  <h3 style="padding:8px 12px;margin:0">Pagina con un video e una miniatura cliccabile</h3>
  <video id="vid" src="/video.mp4" controls style="display:block;margin:12px;width:360px;height:200px;background:#222"></video>
  <a id="thumb" href="https://example.com/articolo" style="display:inline-block;margin:12px">
    <img id="img" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2M0NWEzYiIvPjwvc3ZnPg==" style="display:block">
  </a>
</body></html>`;

async function menuItems(page) {
  return page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    if (!m) return null;
    return Array.from(m.children)
      .filter((c) => c.style.display !== 'none')
      .map((c) => (c.textContent || '').trim().slice(0, 50))
      .filter(Boolean);
  });
}

test('tasto destro su un video: nessuna azione sul video', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  const box = await page.locator('#vid').boundingBox();
  await page.mouse.click(box.x + 80, box.y + 60, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.waitForTimeout(500);
  const items = await menuItems(page);
  console.log('### VIDEO -> ' + JSON.stringify(items));
  await page.screenshot({ path: 'tests/.shots/audit-menu-video.png' });

  // Un browser qualsiasi offre "Salva video come…" / "Copia URL video" /
  // Picture-in-picture. Filo intercetta il tasto destro e non offre NULLA.
  const joined = (items || []).join(' | ').toLowerCase();
  expect(joined).not.toContain('video');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Miniatura dentro un link: si perdono le azioni sul link.
  const b2 = await page.locator('#img').boundingBox();
  await page.mouse.click(b2.x + 60, b2.y + 40, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.waitForTimeout(500);
  const items2 = await menuItems(page);
  console.log('### IMG-IN-LINK -> ' + JSON.stringify(items2));
  await page.screenshot({ path: 'tests/.shots/audit-menu-img-link.png' });
});
