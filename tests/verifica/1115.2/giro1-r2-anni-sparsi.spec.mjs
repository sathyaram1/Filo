// Verifica #1115.2 giro 1, rilievo 2: un anno che la pagina dice per altro (il piè di pagina, «cucina di casa dal 1999»)
// non è l'anno della data scritta nel campo: l'errore di una prenotazione si segna, e la spiegazione non parla di quell'anno.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

async function apri(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    const finto = async () => ({ text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const ocra = (page) => page.locator('.sn-spell-overlay .sn-suggerimento');
const errore = (page) => page.locator('.sn-spell-overlay .sn-errore');

test('r2 modulo di prenotazione con «© 2024» nel piè di pagina: «mercoledì 9 ottobre» si segna', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = `<!doctype html><meta charset="utf-8"><title>Prenota - Trattoria</title><body style="margin:0;padding:20px;font:16px sans-serif">
  <div class="articolo"><h2>Prenota un tavolo</h2>
  <textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:100px;font:20px sans-serif"></textarea>
  <button>Invia</button></div>
  <footer>Trattoria da Mario, via Roma 3. © 2024 Tutti i diritti riservati.</footer></body>`;
  const page = await apri(app, openTab, testServer, html);
  await page.locator('#f').click();
  await page.keyboard.type('vorrei un tavolo per mercoledì 9 ottobre perchè siamo in 4');
  await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
  await expect(ocra(page)).toHaveText(['mercoledì 9 ottobre'], { timeout: 3000 });
});

test('r2 «cucina di casa dal 1999» sopra il modulo: la spiegazione della data sbagliata non parla del 1999', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = `<!doctype html><meta charset="utf-8"><title>Prenota - Trattoria</title><body style="margin:0;padding:20px;font:16px sans-serif">
  <main><p>Cucina di casa dal 1999, con i piatti della nonna e il pane fatto ogni mattina.</p><h2>Prenota un tavolo</h2>
  <textarea id="f" spellcheck="true" lang="it" style="display:block;width:700px;height:100px;font:20px sans-serif"></textarea>
  </main></body>`;
  const page = await apri(app, openTab, testServer, html);
  await page.locator('#f').click();
  await page.keyboard.type('vorrei un tavolo per giovedì 9 ottobre perchè siamo in 4');
  await expect(errore(page)).toHaveText(['perchè'], { timeout: 5000 });
  await expect(ocra(page)).toHaveText(['giovedì 9 ottobre'], { timeout: 3000 });
  const b = await riquadroDelSegno(ocra(page).first());
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page).pannelli;
  await expect(menu).toBeVisible({ timeout: 5000 });
  await expect(menu.locator('.sn-menu-segno')).toContainText('Il 9 ottobre');
  await expect(menu.locator('.sn-menu-segno')).not.toContainText('1999');
});
