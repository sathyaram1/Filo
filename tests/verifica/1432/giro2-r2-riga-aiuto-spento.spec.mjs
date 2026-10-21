// Verifica #1432, giro 2, rilievo 2: con l'Aiuto spento in Preferenze l'icona Aiuto portata nella riga del tasto destro
// resta accesa e dice «Aiuto», mentre nella barra è spenta e dice perché. È la stessa icona: spenta anche lì.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = '<!doctype html><title>Sito</title><body style="margin:0;padding:40px;font:16px sans-serif"><h1>Un sito</h1><p>Testo.</p></body>';
const DALLE_PREFERENZE = { tab: { id: 5, url: 'filo://preferences/preferences.html' }, url: 'filo://preferences/preferences.html' };

test('r2 Aiuto spento in Preferenze: l\'icona Aiuto nella riga del tasto destro è spenta e dice perché', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SITO);
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'help', target: 'primary', beforeId: 'translate' }, {}));
  await app.evaluate(async (_e, da) => globalThis.SN_HANDLE_MESSAGE({ type: 'update_settings', settings: { featureFlags: { help: false } } }, da), DALLE_PREFERENZE);
  await page.waitForTimeout(500);
  await page.locator('h1').click({ button: 'right' });
  const nelMenu = menuDi(page).locator('.sn-menu [data-sn-icon-id="help"]');
  await expect(nelMenu).toBeVisible({ timeout: 8_000 });
  await expect(nelMenu).toHaveClass(/sn-menu-btn-disabled/);
  await expect(nelMenu).toHaveAttribute('aria-label', 'Aiuto spento in Preferenze');
});
