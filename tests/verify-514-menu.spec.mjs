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

async function etichettaFullscreen(page) {
  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  return page.evaluate(() => {
    const el = document.querySelector('.sn-menu [data-id="fullscreen"], .sn-menu #sn-mi-fullscreen');
    if (el) return el.textContent.trim();
    const voci = [...document.querySelectorAll('.sn-menu *')].map((n) => n.textContent.trim());
    return voci.find((t) => /schermo intero/i.test(t)) || null;
  });
}

test('la voce del menu esce dallo schermo intero e si chiama «Esci da schermo intero»', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  const label = await etichettaFullscreen(page);
  expect(label).toMatch(/esci da schermo intero/i);

  await page.evaluate(() => {
    const nodi = [...document.querySelectorAll('.sn-menu *')];
    const v = nodi.reverse().find((n) => /esci da schermo intero/i.test(n.textContent) && n.children.length <= 2);
    v.click();
  });
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(false);
});

test('scheda aperta MENTRE si è a tutto schermo: il menu dice la verità', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, HTML);
  await accendi(app);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  // Una scheda nuova (un link con target=_blank, Ctrl+clic, l'assistente…) nasce
  // mentre lo schermo intero è acceso.
  const nuova = await testServer.openReady(openTab, HTML);
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  const label = await etichettaFullscreen(nuova);
  expect(label).toMatch(/esci da schermo intero/i);
});
