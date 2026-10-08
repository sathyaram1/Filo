// Esplorazione del verificatore #1071: aspetto dei riquadri su un sito, tasto destro dentro la spiegazione,
// lettura del testo scritto dall'utente nella casella del feedback.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi } from '../../helpers/riquadri.mjs';

const pagina = (corpo) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif;background:#fff">${corpo}</body></html>`;

async function finto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'TESTO RISCRITTO', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('Una parola inventata che vuol dire straordinario.'); return { text: 'Una parola inventata che vuol dire straordinario.', usage: {} }; },
    };
  });
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await finto(app);
    await app.evaluate(async (_e, t) => globalThis.__filoHandlers.applySettingsUpdate({ theme: t }), tema);
    const page = await testServer.openReady(openTab, pagina('<p id="parola" style="font-size:20px">supercalifragilistico</p><textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea>'));
    await page.locator('#parola').dblclick();
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });
    await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('straordinario');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tests/.shots/v1071-popup-${tema}.png` });
    await page.keyboard.press('Escape');

    await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
    await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
    await scrivi(app, page, '.sn-fb-text', 'Prova di aspetto del riquadro');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/.shots/v1071-feedback-${tema}.png` });
    await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.close());

    await page.locator('#campo').click();
    await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
    await page.locator('#campo').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
    await page.locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
    await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tests/.shots/v1071-editbox-${tema}.png` });
  });
}

test('tasto destro su una parola della spiegazione', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await finto(app);
  const page = await testServer.openReady(openTab, pagina('<p id="parola" style="font-size:20px">supercalifragilistico</p>'));
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('straordinario');
  const b = await statoDi(app, page, '.sn-popup-body');
  await page.mouse.dblclick(b.x + 30, b.y + 12);
  const sel = await nelMondoDiFilo(app, page, () => String(getSelection()));
  await page.mouse.click(b.x + 30, b.y + 12, { button: 'right' });
  await page.waitForTimeout(1500);
  const voci = await page.locator('.sn-menu .sn-menu-item').allTextContents().catch(() => []);
  await page.screenshot({ path: 'tests/.shots/v1071-destro-popup.png' });
  console.log('SELEZIONE', JSON.stringify(sel), 'VOCI', JSON.stringify(voci));
});

test('il sito legge quello che l\'utente scrive nel feedback', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p>Sito</p>'));
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await scrivi(app, page, '.sn-fb-text', 'il mio codice fiscale RSSMRA80A01H501U');
  await page.waitForTimeout(400);
  const letto = await page.evaluate(() => {
    const out = [];
    for (const c of 'aeiou') {
      getSelection().removeAllRanges();
      if (window.find(c, false, false, true)) {
        const s = getSelection();
        try { s.modify('move', 'backward', 'lineboundary'); s.modify('extend', 'forward', 'lineboundary'); } catch (_) {}
        out.push(String(s));
      }
    }
    return out;
  });
  console.log('LETTO', JSON.stringify(letto));
});
