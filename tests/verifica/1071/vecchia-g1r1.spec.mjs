// Verifica #1071 giro 1, rilievo 1: dentro i riquadri chiusi su un sito gli aiuti di Filo per scrivere devono
// funzionare come prima (correzione automatica; Sostituisci della Modifica che arriva alla bozza).
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca } from '../../helpers/riquadri.mjs';

const pagina = (corpo) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">${corpo}</body></html>`;

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
      streamComplete: async ({ onDelta }) => { onDelta('Vuol dire straordinario.'); return { text: 'Vuol dire straordinario.', usage: {} }; },
    };
    await globalThis.chrome.storage.local.set({ sn_autocorrect: { perchè: 'perché' } });
  });
}

test('r1 la correzione automatica lavora nella casella del feedback e nella domanda della spiegazione su un sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await finto(app);
  const page = await testServer.openReady(openTab, pagina('<p id="parola" style="font-size:20px">supercalifragilistico</p>'));

  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await clicca(app, page, '.sn-fb-text');
  await page.keyboard.type('perchè ', { delay: 30 });
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('perché ');
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.close());

  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('straordinario');
  await clicca(app, page, '.sn-popup-input');
  await page.keyboard.type('perchè ', { delay: 30 });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-input'))?.valore).toBe('perché ');
});

test('r1 Sostituisci della Modifica dentro la casella del feedback entra nella bozza', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await finto(app);
  const page = await testServer.openReady(openTab, pagina('<p>Sito</p>'));
  const chiave = `sn_feedback_draft_text@${testServer.origin}`;
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  const s = await statoDi(app, page, '.sn-fb-text');
  await clicca(app, page, '.sn-fb-text');
  await page.keyboard.type('testo con erore', { delay: 10 });
  await page.keyboard.press('Control+A');
  await page.mouse.click(s.x + 30, s.y + 12, { button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox')).not.toBeNull();
  await clicca(app, page, 'button[data-sc="fix"]');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.testo || '').toContain('RISCRITTO');
  await clicca(app, page, '.sn-editbox-replace');
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text'))?.valore).toBe('TESTO RISCRITTO');
  await expect.poll(() => app.evaluate(async (_e, k) => (await globalThis.chrome.storage.local.get([k]))[k] || '', chiave)).toBe('TESTO RISCRITTO');
});
