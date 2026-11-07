// Verifica #2096 giro 1: il tasto destro sulle voci delle pagine delle impostazioni. «Rimetti di serie» rimette il
// valore e la pagina lo mostra; su una chiave dell'utente non la cancella con un clic senza ritorno.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

test('Preferenze: Rimetti di serie su un interruttore lo rimette acceso, a schermo e nelle impostazioni', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ homeSistema: { ora: false, batteria: true, rete: true, bluetooth: true, volume: true } }); });
  const page = await openTab('filo://preferences/preferences.html');
  const ora = page.locator('#homeSisOra');
  await expect(ora).not.toBeChecked({ timeout: 10_000 });
  await ora.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Rimetti di serie')).toBeVisible();
  await expect(menu.voce('Spiega cosa fa')).toBeVisible();
  await menu.voce('Rimetti di serie').click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).homeSistema.ora)).toBe(true);
  await expect(ora).toBeChecked();
});

test('Modelli: il tasto destro sulla chiave OpenRouter non la cancella con un clic senza ritorno', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'sk-or-v1-chiave-mia' } }); });
  const page = await openTab('filo://options/options.html');
  const campo = page.locator('#apiKey');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await campo.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Chiedi a Filo')).toBeVisible();
  if (await menu.voce('Rimetti di serie').count()) {
    await menu.voce('Rimetti di serie').click();
    await page.waitForTimeout(1500);
  }
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter)).toBe('sk-or-v1-chiave-mia');
});

test('Sicurezza: Rimetti di serie sull\'elenco dei siti bloccati non svuota quello che l\'utente ha scritto senza chiedere', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ security: { ...s.security, siteBlock: { ...s.security.siteBlock, blacklist: ['casino.example', 'scommesse.example'] } } });
  });
  const page = await openTab('filo://security/security.html');
  const campo = page.locator('#sec-siteblock-blacklist');
  await expect(campo).toBeAttached({ timeout: 10_000 });
  await campo.scrollIntoViewIfNeeded().catch(() => {});
  await campo.click({ button: 'right', force: true });
  const menu = menuDi(page);
  await expect(menu.voce('Chiedi a Filo')).toBeVisible();
  if (await menu.voce('Rimetti di serie').count()) {
    await menu.voce('Rimetti di serie').click();
    await page.waitForTimeout(1500);
  }
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.siteBlock.blacklist)).toEqual(['casino.example', 'scommesse.example']);
});
