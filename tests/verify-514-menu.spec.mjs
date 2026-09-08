// #514 avversariale, parte 2 — le altre strade d'uscita dallo schermo intero:
// la voce del menu del tasto destro, e cosa dice quella voce in una scheda
// aperta MENTRE si è già a tutto schermo.
import { test, expect } from './fixtures/electron.mjs';

const HTML = '<html><body style="margin:0"><p id="t">ciao</p></body></html>';

function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return { contentFullscreen: win._filoTabs.contentFullscreen };
  });
}

function accendi(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win._filoTabs.toggleContentFullscreen();
  });
}

async function bottoneFullscreen(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  const diretto = page.locator('[data-sn-icon-id="fullscreen"]');
  if (await diretto.count() === 0) {
    await page.locator('.sn-menu-row-overflow').first().click();
    await expect(diretto.first()).toBeVisible({ timeout: 8000 });
  }
  return diretto.first();
}

async function etichettaFullscreen(page) {
  const b = await bottoneFullscreen(page);
  return b.getAttribute('aria-label');
}

test('la voce del menu esce dallo schermo intero e si chiama «Esci da schermo intero»', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  const b = await bottoneFullscreen(page);
  expect(await b.getAttribute('aria-label')).toMatch(/esci da schermo intero/i);

  await b.click();
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
});

test('scheda aperta MENTRE si è a tutto schermo: il menu dice la verità', async ({ app, openTab, testServer }) => {
  // Prima scheda su una pagina di Filo, così la seconda (sul mini server) è
  // riconoscibile per hostname e non rischio di rileggere la prima.
  const prima = await openTab('filo://manage/manage.html');
  await prima.waitForLoadState('domcontentloaded').catch(() => {});
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  // Una scheda nuova (un link con target=_blank, Ctrl+clic, l'assistente…) nasce
  // mentre lo schermo intero è acceso.
  const nuova = await testServer.openReady(openTab, HTML);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  const label = await etichettaFullscreen(nuova);
  expect(label).toMatch(/esci da schermo intero/i);
});
