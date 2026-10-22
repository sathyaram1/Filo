// Verifica #1447 giro 1, rilievo 1: un campo che ha già il cursore quando la pagina si apre (la chat di casa di Filo,
// una pagina col campo in autofocus) non viene corretto da sé finché non si esce e si rientra.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';

async function prepara(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: false, automatica: true },
    });
  });
}

test('r1 nella chat di casa, aperta e scritta subito, «perchè » e «marco » si correggono', async ({ app, openTab }) => {
  await prepara(app);
  const page = await openTab('filo://dashboard/dashboard.html');
  const input = page.locator('#input');
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id), { timeout: 8000 }).toBe('input');
  await page.waitForTimeout(2500);
  await page.keyboard.type('Domani vedo marco perchè ');
  await expect.poll(() => input.inputValue(), { timeout: 4000 }).toBe('Domani vedo Marco perché ');
});

test('r1 in una pagina col campo già col cursore, scritta subito, «perchè » si corregge', async ({ app, openTab, testServer }) => {
  await prepara(app);
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body>
    <textarea id="ta" lang="it" autofocus style="width:600px;height:100px"></textarea></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('ta');
  await page.keyboard.type('Ciao marco perchè ');
  await expect.poll(() => page.locator('#ta').inputValue(), { timeout: 4000 }).toBe('Ciao Marco perché ');
});
