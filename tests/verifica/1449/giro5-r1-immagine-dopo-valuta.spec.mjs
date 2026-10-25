// Verifica #1449 giro 5: dopo «Valuta», con il campo cambiato, un'immagine allegata a una domanda nell'Aiuto deve
// arrivare al modello in quel turno, come arriva senza Valuta.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PARERE = JSON.stringify({
  text: 'C\'è un refuso.',
  correzioni: [{ prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' }],
  status: 'done',
});
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Messaggio</title>
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" style="display:block;width:520px;height:90px;font:16px sans-serif"></textarea>
</body>`;

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: false, spellcheckContext: false },
    });
    globalThis.__chiamate = [];
    const finto = async ({ attempts, messages }) => {
      const tutto = JSON.stringify(messages);
      globalThis.__chiamate.push(tutto);
      const ultimo = JSON.stringify(messages[messages.length - 1]);
      const text = ultimo.includes('e questa?') ? JSON.stringify({ text: 'Vista.', status: 'done' }) : PARERE_;
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text };
    };
    const PARERE_ = globalThis.__parere;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

async function incollaImmagine(app, page) {
  await app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' }) })]);
  }, B64);
  await page.click('.sn-sidebar-input textarea');
  await page.keyboard.press('Control+V');
  await expect.poll(() => nelMondoDiFilo(app, page, () => (globalThis.__filoSidebarTest?.allegati?.() || []).length), { timeout: 5_000 }).toBe(1);
}

async function domandaConImmagine(app, page) {
  await incollaImmagine(app, page);
  await page.fill('.sn-sidebar-input textarea', 'e questa?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar-msg-assistant', { hasText: 'Vista.' })).toBeVisible({ timeout: 20_000 });
  const tutte = await app.evaluate(() => globalThis.__chiamate);
  const messages = JSON.parse(tutte[tutte.length - 1]);
  // La foto della pagina viaggia nell'ultimo messaggio; l'immagine allegata nel turno dell'utente che lo precede.
  return { ultimo: JSON.stringify(messages[messages.length - 1]), prima: JSON.stringify(messages.slice(0, -1)) };
}

test('r1 dopo «Valuta» e il campo cambiato, l’immagine allegata alla domanda arriva al modello in quel turno', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate((_e, p) => { globalThis.__parere = p; }, PARERE);
  await prepara(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await page.fill('#ta', 'Ieri sono andato al mare con i mei amici.');
  await page.locator('#ta').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  await menu.voce('Valuta').click();
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ta')).toHaveValue(/i miei amici/);

  const { ultimo, prima } = await domandaConImmagine(app, page);
  expect(ultimo).toContain('e questa?');
  expect(prima).toContain('image_url');
});

test('controllo: senza «Valuta» la stessa immagine arriva al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate((_e, p) => { globalThis.__parere = p; }, PARERE);
  await prepara(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.open(); return 1; });
  await page.waitForSelector('.sn-sidebar-input textarea');
  const { prima } = await domandaConImmagine(app, page);
  expect(prima).toContain('image_url');
});
