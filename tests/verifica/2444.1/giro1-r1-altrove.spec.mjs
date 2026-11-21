// Verifica #2444.1 giro 1: il tasto destro dato prima che Filo sia pronto, e poi l'utente fa altro FUORI dalla pagina
// (clic su un'altra scheda) o la scorre con la rotella: il menu non deve comparire dopo sulla voce di prima.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const trattieniImpostazioni = (app) => app.evaluate(() => {
  const S = globalThis.SN_STORAGE;
  const vera = S.getSettings;
  let apri;
  const cancello = new Promise((r) => { apri = r; });
  S.getSettings = function (...a) {
    if (/handlers[\\/]storage\.js/.test(new Error().stack || '')) return cancello.then(() => vera.apply(S, a));
    return vera.apply(S, a);
  };
  globalThis.__apriImpostazioni = () => { S.getSettings = vera; apri(); };
});
const apriImpostazioni = (app) => app.evaluate(() => globalThis.__apriImpostazioni());
const pronta = (page) => page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });

test('r1 tasto destro, poi clic su un\'altra scheda prima che Filo sia pronto: tornando, nessun menu aperto', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const altra = await openTab('filo://history/history.html');
  await altra.waitForLoadState('domcontentloaded');
  await trattieniImpostazioni(app);
  const page = await openTab('filo://preferences/preferences.html');
  const etichetta = page.locator('label', { has: page.locator('#tabPreviewEnabled') });
  await expect(etichetta).toBeVisible({ timeout: 10_000 });
  await etichetta.click({ button: 'right' });
  const schede = shell.locator('#tabs .tab:not(.active)');
  await schede.last().click();
  // L'utente è davvero altrove: la scheda delle Preferenze non è più quella in primo piano.
  await expect.poll(() => page.evaluate(() => document.visibilityState), { timeout: 5_000 }).toBe('hidden');
  await expect(menuDi(page).principale).toHaveCount(0);
  await apriImpostazioni(app);
  await pronta(page);
  await page.waitForTimeout(1_000);
  await shell.locator('#tabs .tab').last().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/2444.1-r1-altra-scheda.png' }).catch(() => {});
  await expect(menuDi(page).principale).toHaveCount(0);
});
