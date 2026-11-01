// #1096 — aprire e chiudere «Invia feedback» (e il pannello red-team) non lascia tele né ascoltatori in memoria.
// Ogni apertura agganciava window, documento, visualViewport e i messaggi senza staccarli: ognuno teneva viva la
// tela a tutto schermo con immagini e allegati, e lo strato sopra un sito vive quanto la scheda.
// Si misura dal motore (CDP): tele vive dopo il GC e ascoltatori registrati. Il motore tiene da sé l'ultimo nodo
// sotto il puntatore o cliccato, e dopo i primi giri il conto si ferma: si confrontano due misure a regime.

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, paginaDelloStrato } from './helpers/riquadri.mjs';

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
  const objectGroup = 'misura-1096';
  const oggetto = async (expr) => (await cdp.send('Runtime.evaluate', { expression: expr, objectGroup })).result.objectId;
  const vivi = async (proto) => {
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: await oggetto(proto), objectGroup });
    const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true, objectGroup });
    return result.value;
  };
  const ascoltatori = async (expr) => (await cdp.send('DOMDebugger.getEventListeners', { objectId: await oggetto(expr) })).listeners.length;
  return async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const m = {
      tele: await vivi('HTMLCanvasElement.prototype'),
      mediaQuery: await vivi('MediaQueryList.prototype'),
      window: await ascoltatori('window'),
      documento: await ascoltatori('document'),
      viewport: await ascoltatori('visualViewport'),
      // Nello strato i moduli di Filo vivono nel mondo isolato: da qui il conto dei messaggi non si legge.
      messaggi: await page.evaluate(() => globalThis.chrome?.runtime?.onMessage?._listeners?.size ?? -1),
    };
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup });
    return m;
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
  const cinqueGiri = async () => { for (let giro = 0; giro < 5; giro++) {
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
  } };

  // I primi giri fanno nascere ciò che nasce una volta sola (ascoltatori globali, cache del motore).
  await cinqueGiri();
  const prima = await misura();
  await cinqueGiri();
  await cinqueGiri();
  const { tele, ...ascolto } = await misura();
  const { tele: telePrima, ...ascoltoPrima } = prima;
  expect(ascolto, 'altri dieci giri non lasciano ascoltatori').toEqual(ascoltoPrima);
  // Prima del fix ogni giro ne lasciava una: dieci giri, dieci tele in più.
  expect(tele - telePrima, 'le tele non crescono coi giri (al più una, che il motore tiene per sé)').toBeLessThanOrEqual(1);
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
  const cinqueGiri = async () => { for (let giro = 0; giro < 5; giro++) {
    await apri();
    await page.locator('.sn-rt-attack').fill(`tentativo ${giro}`);
    if (giro % 2) await page.locator('.sn-rt-cancel').click();
    else await page.locator('.sn-rt-attack').press('Escape');
    await expect(page.locator('.sn-rt-modal')).toHaveCount(0);
  } };
  await cinqueGiri();
  const prima = await misura();
  await cinqueGiri();
  expect(await misura()).toEqual(prima);
});

// Su un sito il riquadro sta nello strato sopra la scheda, che resta vivo fra un'apertura e l'altra: aperto dalla
// pagina come lo apre l'utente, chiuso dal suo tasto o con Esc.
test('aperto e chiuso dieci volte su un sito, lo strato non tiene tele né ascoltatori in più', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const p = await testServer.openReady(openTab, '<!doctype html><html><head><meta charset="utf-8"></head><body><p>Una pagina qualunque.</p></body></html>');
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  const strato = await paginaDelloStrato(app, p);
  await expect(strato.locator('.sn-fb-modal')).toBeVisible();
  await strato.locator('.sn-fb-cancel').click();
  await expect(strato.locator('.sn-fb-modal')).toHaveCount(0);
  const misura = await misuratore(strato);
  const giri = async (n) => { for (let i = 0; i < n; i++) {
    await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
    await expect(strato.locator('.sn-fb-modal')).toBeVisible();
    await strato.locator('.sn-fb-text').fill(`giro ${i}`);
    const box = await strato.locator('.sn-fb-canvas').boundingBox();
    await strato.mouse.move(box.x + 30, box.y + 30);
    await strato.mouse.down();
    await strato.mouse.move(box.x + 120, box.y + 60);
    await strato.mouse.up();
    if (i % 2) await strato.locator('.sn-fb-cancel').click();
    else await strato.keyboard.press('Escape');
    await expect(strato.locator('.sn-fb-modal')).toHaveCount(0);
  } };
  await giri(4);
  const { tele: telePrima, ...prima } = await misura();
  await giri(10);
  const { tele, ...dopo } = await misura();
  expect(dopo).toEqual(prima);
  expect(tele - telePrima).toBeLessThanOrEqual(1);
});
