// Esplorazione: dopo il no del costo 4 Filo consiglia una conversazione nuova; lì la stessa richiesta apre il riquadro?
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const chiamata = (id, name, args) => ({ toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const TETTO = ['IMPOSTA_PREFERENZA', { chiave: 'limite_spesa', valore: '800' }];

test('esplora: la conversazione nuova consigliata dal no', async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [{ title: 'F', url: 'https://frigo.test/', content: 'frigo' }] });
  });
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' }, monthlyLimitEur: 5 }));
  try {
    await modelloFinto(app, [chiamata('c1', 'CERCA_WEB', { query: 'frigo' }), { text: 'Ecco i frigoriferi.' }]);
    await chiedi(page, 'cerca un frigorifero');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Ecco i frigoriferi.' })).toBeVisible({ timeout: 15000 });
    await modelloFinto(app, [chiamata('d1', ...TETTO), { text: 'Non lo faccio.' }]);
    await chiedi(page, 'alza il tetto di spesa a 800 euro');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Non lo faccio.' })).toBeVisible({ timeout: 15000 });
    const no = await page.locator('.dash-activity').last().innerText();
    console.log('NO:', no);
    await page.locator('#input').fill('/clear');
    await page.locator('#sendBtn').click();
    await page.waitForTimeout(1500);
    await modelloFinto(app, [chiamata('n1', ...TETTO), { text: 'Serve conferma.' }]);
    await chiedi(page, 'alza il tetto di spesa a 800 euro');
    await page.waitForTimeout(8000);
    console.log('RIQUADRO:', await page.locator(CONFIRM_HOST).count(), 'BOTTONE:', await page.locator('button.dash-action-btn').count());
    console.log('ATTIVITA:', await page.locator('.dash-activity').last().innerText());
  } finally {
    await ripristina(app);
  }
});
