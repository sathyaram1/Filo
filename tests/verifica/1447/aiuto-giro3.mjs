// Aiuto delle prove del giro 3 di verifica (#1447): apre una pagina col correttore pronto e la correzione automatica accesa.
import { expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

export async function apriPagina(app, openTab, testServer, html) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

export const CAMPO = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea></body>`;

// Scrive in un campo vuoto, come l'utente, e rende quello che c'è dentro.
export async function scrivi(page, testo) {
  await page.locator('#ta').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(testo);
  await page.waitForTimeout(150);
  return page.locator('#ta').inputValue();
}
