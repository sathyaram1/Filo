// #514 giro 4 — le porte sulle pagine interne, provate sulla scheda ATTIVA.
// Nota di metodo: openTab('filo://newtab/') restituisce la newtab del boot, che
// resta in secondo piano mentre quella appena aperta va in primo piano. Qui
// pilotiamo la scheda del boot senza aprirne altre, così la pagina che ha il
// riquadro è davvero quella attiva.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const att = t.tabs.find((x) => x.id === t.activeId);
    return {
      cf: !!t.contentFullscreen,
      conRiquadro: [...t.tabsWithFiloBox],
      attiva: t.activeId,
      urlAttiva: att ? att.view.webContents.getURL() : null,
      schede: t.tabs.length,
    };
  });
}

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

async function esc(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, 900));
}

async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.SN_PROVIDER_OPENROUTER,
      streamComplete: async ({ onDelta }) => {
        onDelta('Una spiegazione breve.');
        return { text: 'Una spiegazione breve.', usage: {} };
      },
    };
  });
}

function pasteImage(page) {
  return page.evaluate(() => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([arr], 'img.png', { type: 'image/png' }));
    document.getElementById('inputForm')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
}

test('riquadro della risposta sulla home: fuori dallo schermo intero Esc lo chiude', async ({ app }) => {
  const page = await newtabPage(app);
  await preparaProvider(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: 300 },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  const prima = await stato(app);
  console.log('[risposta/senza] setup:', JSON.stringify(prima));
  await esc(app);
  const aperti = await page.locator('.sn-popup').count();
  console.log('[risposta/senza] riquadri dopo Esc:', aperti);
  expect(aperti).toBe(0);
});

test('riquadro della risposta sulla home: a schermo intero il primo Esc chiude lui', async ({ app }) => {
  const page = await newtabPage(app);
  await preparaProvider(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await entra(app);
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: 300 },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  const prima = await stato(app);
  console.log('[risposta/pieno] setup:', JSON.stringify(prima));
  await esc(app);
  const dopo = await stato(app);
  const aperti = await page.locator('.sn-popup').count();
  console.log('[risposta/pieno] riquadri dopo il primo Esc:', aperti, '| schermo intero:', dopo.cf);
  expect({ riquadroAperto: aperti > 0, schermoIntero: dopo.cf })
    .toEqual({ riquadroAperto: false, schermoIntero: true });
});

test('home: immagine ingrandita — il primo Esc chiude lei, non lo schermo intero', async ({ app }) => {
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await pasteImage(page);
  await expect(page.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 4000 });
  await entra(app);
  await page.locator('#imgPreviews .dash-img-preview img').first().click();
  await expect(page.locator('.dash-lightbox.open')).toBeVisible({ timeout: 4000 });
  await new Promise((r) => setTimeout(r, 400));
  const prima = await stato(app);
  console.log('[home immagine] setup:', JSON.stringify(prima));

  await esc(app);
  const dopo = await stato(app);
  const ancora = await page.locator('.dash-lightbox.open').count();
  console.log('[home immagine] ancora aperta:', ancora, '| schermo intero:', dopo.cf);
  expect({ immagineAperta: ancora > 0, schermoIntero: dopo.cf })
    .toEqual({ immagineAperta: false, schermoIntero: true });
});

test('home: riquadro di conferma — il primo Esc annulla lui, non lo schermo intero', async ({ app }) => {
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8000 });
  await entra(app);
  await page.evaluate(() => {
    window.__esitoConferma = 'in corso';
    window.SN_CONFIRM_UI.confirm({ title: 'Sicuro?', text: 'Azione delicata' })
      .then((v) => { window.__esitoConferma = v; });
  });
  await new Promise((r) => setTimeout(r, 500));
  const prima = await stato(app);
  console.log('[home conferma] setup:', JSON.stringify(prima));

  await esc(app);
  const dopo = await stato(app);
  const esito = await page.evaluate(() => window.__esitoConferma);
  console.log('[home conferma] esito:', esito, '| schermo intero:', dopo.cf);
  expect({ conferma: esito, schermoIntero: dopo.cf })
    .toEqual({ conferma: false, schermoIntero: true });
});
