// Verifica #592 giro 13, rilievo 4: nella domanda dopo di «Spiega» lo stile
// arriva al modello due volte, con due recinti e due intestazioni.
import { test, expect } from '../../fixtures/electron.mjs';
import { configuraModello, modelloFinto, ripristina } from './giro13-comune.mjs';

test('Spiega: alla domanda successiva lo stile arriva una volta sola', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await configuraModello(app, ['EXPLAIN_DEEP']);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ agentStyle: 'Rispondi breve.' }));
  await modelloFinto(app, [{ text: 'Una spiegazione.' }, { text: 'Un seguito.' }]);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming, null, { timeout: 8_000 });
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'Bundesliga', sentence: 'La Bundesliga riparte.' },
    anchor: { x: 120, y: 200 }, title: 'Approfondisci',
  }));
  await expect(page.locator('.sn-popup-body')).toContainText('Una spiegazione.', { timeout: 10_000 });
  await page.locator('.sn-popup-input').fill('e quando riparte?');
  await page.locator('.sn-popup-send').click();
  await expect(page.locator('.sn-popup')).toContainText('Un seguito.', { timeout: 10_000 });
  const buste = await app.evaluate(() => {
    const c = globalThis.__v592;
    return JSON.stringify(c[c.length - 1]).split('<<<STILE_UTENTE>>>').length - 1;
  });
  await ripristina(app);
  expect(buste, 'alla domanda dopo lo stile è nel prompt due volte').toBe(1);
});
