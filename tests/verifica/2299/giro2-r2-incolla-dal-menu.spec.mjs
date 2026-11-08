// #2299, verifica giro 2, rilievo 2: il testo incollato con «Incolla» del tasto destro di Filo in una casella di un sito
// riceve subito i suoi segni, anche se l'utente ci ha messo un paio di secondi a scegliere la voce.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu, menuDi } from '../../helpers/menuContestuale.mjs';
import { segniDi } from '../../helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:40px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="width:600px;height:160px;font:20px monospace"></textarea>
</body>`;

test('r2 il testo incollato dal tasto destro di Filo riceve subito i segni', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: false },
    });
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  await app.evaluate(({ clipboard }) => clipboard.writeText('oggi quseta e domani '));

  await page.locator('#ta').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu-paste-main').first()).toBeVisible();
  // L'utente legge il menu prima di scegliere.
  await page.waitForTimeout(2000);
  await menuDi(page).locator('.sn-menu-paste-main').first().click();
  await expect(page.locator('#ta')).toHaveValue('oggi quseta e domani ');
  await expect(segniDi(page, '.sn-spell-overlay .sn-errore')).toHaveText(['quseta'], { timeout: 5000 });
});
