// Feedback alpha #5, poi #869: dalle Preferenze si spegne il messaggio con cui Filo scrive per primo nella home quando
// succede qualcosa (un timer, un download, un avviso, l'inizio della giornata). Il toggle è `showHomeMessage`.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

async function setShowHomeMessage(page, value) {
  await page.evaluate((v) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { showHomeMessage: v } },
      (r) => resolve(r),
    );
  }), value);
}

async function modelloDellaHome(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__home_calls = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      if (JSON.stringify(messages).includes('preparare la dashboard')) globalThis.__home_calls += 1;
      return { text: JSON.stringify({ message: 'Il timer è suonato.', suggestions: [] }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

const parla = (app) => app.evaluate(async () => {
  await globalThis.SN_FILO_PARLA.giro({ subito: [{ tipo: 'timer', testo: 'timer «pasta»' }] });
  return { chiamate: globalThis.__home_calls, scritti: (await globalThis.SN_IL_FILO.chats()).flatMap((c) => c.messages.filter((m) => m.spontaneo)).length };
});

test('acceso di serie: quando suona un timer Filo lo scrive nella home (#869)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await modelloDellaHome(app);
  expect(await parla(app)).toEqual({ chiamate: 1, scritti: 1 });
  await expect(page.locator('.dash-bubble-filo[data-spontaneo="1"]')).toHaveText('Il timer è suonato.');
});

test('spento: Filo non scrive per primo e non chiama il modello; riacceso torna a farlo (#5, #869)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await modelloDellaHome(app);
  await setShowHomeMessage(page, false);
  expect(await parla(app)).toEqual({ chiamate: 0, scritti: 0 });
  await expect(page.locator('.dash-bubble-filo[data-spontaneo="1"]')).toHaveCount(0);
  await setShowHomeMessage(page, true);
  expect(await parla(app)).toEqual({ chiamate: 1, scritti: 1 });
});

test('la pagina Preferenze espone il toggle e ne riflette lo stato (#5)', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  const box = page.locator('#showHomeMessage');
  await expect(box).toBeVisible({ timeout: 8_000 });
  // Default: spuntato.
  await expect(box).toBeChecked();
  // Togli la spunta → niente pulsante Salva, l'auto-save persiste subito
  // (il "Salvato" lampeggia come conferma). Ricaricando lo stato è persistito.
  await box.uncheck();
  await expect(page.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  await page.reload();
  await expect(page.locator('#showHomeMessage')).not.toBeChecked({ timeout: 8_000 });
});
