// #514, terzo giro di verifica — le porte dello stato "a tutto schermo" che
// gli altri spec non toccano. Tutte riguardano la stessa cosa: la voce del
// menu del tasto destro deve dire la VERITÀ su dove sei, comunque la pagina ci
// sia arrivata (nata prima, nata dopo, ricaricata, in secondo piano, dentro un
// riquadro incorporato) e senza restare indietro quando lo stato cambia.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = '<html><body style="margin:0;height:1200px"><p id="t">ciao</p></body></html>';
const CON_IFRAME = '<html><body style="margin:0"><p id="t">fuori</p>'
  + '<iframe id="f" srcdoc="<body style=margin:0><p id=i>dentro</p></body>" style="width:400px;height:200px"></iframe></body></html>';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}

async function setFs(app, on) {
  await app.evaluate(({ BrowserWindow }, v) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(v);
  }, on);
  await new Promise((r) => setTimeout(r, 800));
}

// Etichetta della voce "schermo intero" nel menu del tasto destro aperto su
// `scope` (una Page oppure il FrameLocator di un riquadro incorporato).
async function etichetta(scope, sel) {
  await scope.locator(sel).click({ button: 'right' });
  await expect(scope.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  const voce = scope.locator('[data-sn-icon-id="fullscreen"]');
  if (await voce.count() === 0) {
    await scope.locator('.sn-menu-row-overflow').first().click();
    await expect(voce.first()).toBeVisible({ timeout: 8000 });
  }
  return voce.first().getAttribute('aria-label');
}

test('scheda rimasta in secondo piano mentre si accendeva: il menu dice la verità', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  const seconda = await testServer.openReady(openTab, PAGINA);
  // torna sulla prima, accendi, poi rientra nella seconda
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    t.activate(t.tabs[t.tabs.length - 2].id);
  });
  await setFs(app, true);
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    t.activate(t.tabs[t.tabs.length - 1].id);
  });
  await new Promise((r) => setTimeout(r, 400));
  expect(await etichetta(seconda, '#t')).toMatch(/esci da schermo intero/i);
});

test('pagina RICARICATA mentre si è a tutto schermo: il menu dice la verità', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await setFs(app, true);
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  expect(await etichetta(page, '#t')).toMatch(/esci da schermo intero/i);
});

test('riquadro incorporato nato a tutto schermo: dentro c\'è la via d\'uscita, e esce davvero', async ({ app, openTab, testServer }) => {
  await setFs(app, true);
  const page = await testServer.openReady(openTab, CON_IFRAME);
  await new Promise((r) => setTimeout(r, 1000));
  const dentro = page.frameLocator('#f');
  expect(await etichetta(dentro, '#i')).toMatch(/esci da schermo intero/i);
  await dentro.locator('[data-sn-icon-id="fullscreen"]').first().click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
});

test('acceso e SUBITO spento mentre la scheda nasce: nessuna risposta stantia', async ({ app, openTab, testServer }) => {
  // La pagina CHIEDE lo stato appena si monta; se l'annuncio dello spegnimento
  // arriva prima della risposta, a vincere dev'essere l'annuncio (è più fresco).
  await setFs(app, true);
  const page = await testServer.openReady(openTab, PAGINA);
  await setFs(app, false);
  await new Promise((r) => setTimeout(r, 800));
  expect(await etichetta(page, '#t')).toMatch(/^schermo intero$/i);
});

test('uscito con la voce del menu, il menu riaperto torna a dire «Schermo intero»', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await setFs(app, true);
  await etichetta(page, '#t');
  await page.locator('[data-sn-icon-id="fullscreen"]').first().click();
  await expect.poll(async () => (await stato(app)).cf, { timeout: 8000 }).toBe(false);
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.querySelectorAll('.sn-menu').forEach((m) => m.remove()));
  expect(await etichetta(page, '#t')).toMatch(/^schermo intero$/i);
});
