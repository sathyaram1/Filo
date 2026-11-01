// #1096 — aprire e chiudere «Invia feedback» (e il pannello red-team) non lascia tele né ascoltatori in memoria.
// Ogni apertura agganciava window, documento, visualViewport e i messaggi senza staccarli: ognuno teneva viva la
// tela a tutto schermo con immagini e allegati, e lo strato sopra un sito vive quanto la scheda.
// Si misura dal motore (CDP): tele vive dopo il GC e ascoltatori registrati, prima e dopo cinque giri.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

async function misuratore(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  const oggetto = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr })).result.objectId;
  const vivi = async (proto) => {
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: await oggetto(proto) });
    const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true });
    return result.value;
  };
  const ascoltatori = async (expr) => (await cdp.send('DOMDebugger.getEventListeners', { objectId: await oggetto(expr) })).listeners.length;
  return async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    return {
      tele: await vivi('HTMLCanvasElement.prototype'),
      mediaQuery: await vivi('MediaQueryList.prototype'),
      window: await ascoltatori('window'),
      documento: await ascoltatori('document'),
      viewport: await ascoltatori('visualViewport'),
      messaggi: await page.evaluate(() => chrome.runtime.onMessage._listeners?.size ?? -1),
    };
  };
}

test('cinque aperture e chiusure del riquadro «Invia feedback» lasciano la memoria com’era', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const misura = await misuratore(page);
  const apri = async () => {
    await page.evaluate(() => window.SN_FEEDBACK_UI.open());
    await expect(page.locator('.sn-fb-modal')).toBeVisible();
  };
  // Un giro di riscaldamento: gli ascoltatori globali che nascono una volta sola non contano.
  await apri();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
  const prima = await misura();

  for (let giro = 0; giro < 5; giro++) {
    await apri();
    // Un'apertura usata davvero: un tratto sulla tela e una miniatura incollata.
    const tela = page.locator('.sn-fb-canvas');
    const box = await tela.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 90);
    await page.mouse.up();
    await page.evaluate(() => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const ev = new CustomEvent('filo:paste-image', { bubbles: true, cancelable: true, detail: { blob: new Blob([png], { type: 'image/png' }) } });
      document.querySelector('.sn-fb-modal').dispatchEvent(ev);
    });
    // Le tre strade per chiudere: il tasto, Esc, la chiusura chiesta da Filo.
    if (giro % 3 === 0) await page.locator('.sn-fb-cancel').click();
    else if (giro % 3 === 1) await page.keyboard.press('Escape');
    else await page.evaluate(() => window.SN_FEEDBACK_UI.close());
    await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
  }

  const dopo = await misura();
  expect(dopo, 'dopo cinque giri tele e ascoltatori sono quelli di prima').toEqual(prima);
});

test('la bozza scritta subito prima di chiudere resta, anche senza aspettare il salvataggio', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await page.locator('.sn-fb-text').fill('scritta e chiusa di corsa');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-text')).toHaveValue('scritta e chiusa di corsa');
});

test('cinque aperture e chiusure del pannello red-team lasciano gli ascoltatori com’erano', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const misura = await misuratore(page);
  const apri = async () => {
    await page.evaluate(() => window.SN_REDTEAM_ATTACK_UI.open());
    await expect(page.locator('.sn-rt-modal')).toBeVisible();
  };
  await apri();
  await page.locator('.sn-rt-cancel').click();
  await expect(page.locator('.sn-rt-modal')).toHaveCount(0);
  const prima = await misura();
  for (let giro = 0; giro < 5; giro++) {
    await apri();
    await page.locator('.sn-rt-attack').fill(`tentativo ${giro}`);
    if (giro % 2) await page.locator('.sn-rt-cancel').click();
    else await page.locator('.sn-rt-attack').press('Escape');
    await expect(page.locator('.sn-rt-modal')).toHaveCount(0);
  }
  expect(await misura()).toEqual(prima);
});
