// #1054 giro 3, rilievo 3: un'icona trascinata dalla barra laterale entra nel menu aperto (#871) col menu nella pagina,
// non con quello nello strato.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

test.use({ stratoDelMenu: true });

test('r3 un\'icona trascinata dalla barra laterale entra nella riga del menu aperto nello strato', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:40px;height:1400px">
    <p id="p">Clic destro qui.</p></body>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const barra = await barraPage(app);
  const mossa = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'screenshot', target: 'bar' }, {}));
  expect(mossa && mossa.ok).toBe(true);
  await expect.poll(async () => (await statoBarra(app)).bar).toContain('screenshot');
  await page.locator('#p').click({ button: 'right' });
  const riga = menuDi(page).locator('.sn-menu .sn-menu-row[data-sn-drop-target="primary"]').first();
  await expect(riga).toBeVisible();
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const src = await barra.locator('#nav .ico[data-id="screenshot"]').boundingBox();
  const dst = await riga.boundingBox();
  const s = await statoBarra(app);
  const alto = s.bounds.y - s.alto;
  await barra.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await barra.mouse.down();
  await barra.mouse.move(src.x + 30, src.y + 10, { steps: 3 });
  await barra.mouse.move(dst.x + dst.width - 20, dst.y + dst.height / 2 - alto, { steps: 10 });
  await barra.mouse.up();
  await expect.poll(async () => (await statoBarra(app)).bar, { timeout: 5000 }).not.toContain('screenshot');
  const dopo = await statoBarra(app);
  expect([...dopo.primary, ...dopo.secondary]).toContain('screenshot');
});
