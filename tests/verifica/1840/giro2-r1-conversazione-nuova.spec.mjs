// Verifica #1840 giro 2, rilievo 1: la frase sotto i livelli promette che dopo una lettura togliere un freno si fa
// «in una conversazione nuova». Nella home la conversazione nuova ha davanti gli ultimi giorni del filo, ricerca
// compresa, e riceve lo stesso no. O la strada promessa funziona, o la frase non la promette.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

const chiamata = (id, name, args) => ({ toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const TETTO = ['IMPOSTA_PREFERENZA', { chiave: 'limite_spesa', valore: '800' }];

test('r1 dopo una ricerca, la conversazione nuova promessa dalla frase dei livelli apre il riquadro con la parola', async ({ app }) => {
  await app.evaluate(() => {
    globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [
      { title: 'Frigoriferi', url: 'https://frigo.test/', content: 'Classe energetica A.' },
    ] });
  });
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'default' }, monthlyLimitEur: 5 }));
  const promette = await app.evaluate(() => /conversazione nuova/.test(globalThis.SN_AUTONOMIA.FRASE_COSTO_4));
  try {
    await modelloFinto(app, [chiamata('c1', 'CERCA_WEB', { query: 'frigorifero' }), { text: 'Ecco.' }]);
    await chiedi(page, 'cerca un frigorifero');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Ecco.' })).toBeVisible({ timeout: 15000 });
    // Conversazione nuova, come dice la frase: la stessa richiesta.
    await chiedi(page, '/clear');
    await modelloFinto(app, [chiamata('t2', ...TETTO), { text: 'Fine del giro.' }]);
    await chiedi(page, 'alza il tetto di spesa a 800 euro');
    await expect(page.locator(CONFIRM_HOST).or(page.locator('.dash-bubble').filter({ hasText: 'Fine del giro.' })).first())
      .toBeVisible({ timeout: 15000 });
    const aperto = await page.locator(CONFIRM_HOST).isVisible();
    if (aperto) await clickConfirm(page, 'cancel');
    expect(aperto || !promette, 'la frase sotto i livelli promette la conversazione nuova, che riceve lo stesso no').toBe(true);
  } finally {
    await ripristina(app);
  }
});
