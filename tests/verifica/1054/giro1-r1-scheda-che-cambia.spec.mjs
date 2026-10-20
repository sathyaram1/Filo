// Verifica #1054 giro 1, rilievo 1: il menu nello strato non segue la scheda sotto come il menu di oggi. La finestra
// che si accorcia lo chiude (oggi resta e rientra, #500); la pagina che scorre lo lascia appeso (oggi si chiude).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

test.use({ stratoDelMenu: true });

const PAGINA = `<!doctype html><html><body style="margin:0;font:16px sans-serif;height:4000px">
  <div style="height:55vh"></div><a id="link" href="https://example.com/a">un collegamento</a></body></html>`;

async function apri(app, openTab, testServer) {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#link').click({ button: 'right' });
  await expect(menuDi(page).principale).toBeVisible();
  return page;
}

test('r1 la finestra che si accorcia sotto al menu di un collegamento: il menu resta aperto e rientra', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  const menu = menuDi(page);
  const prima = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const b = w.getBounds();
    w.setBounds({ ...b, height: b.height - 340 });
    return b;
  });
  try {
    await page.waitForTimeout(1000);
    await expect(menu.principale, 'chi rimpicciolisce la finestra non sta chiedendo di chiudere il menu').toBeVisible();
    const r = await menu.principale.boundingBox();
    const alta = await menu.valuta(() => innerHeight);
    expect(r.y + r.height).toBeLessThanOrEqual(alta + 1);
    await menu.voci.last().hover({ timeout: 3000 });
  } finally {
    await app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows().find((x) => x._filoTabs).setBounds(b), prima);
  }
});

test('r1 la pagina che scorre sotto un menu normale lo chiude, come quello di oggi', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(menuDi(page).principale, 'il menu resta sopra un punto della pagina che non è più quello cliccato').toHaveCount(0, { timeout: 3000 });
});
