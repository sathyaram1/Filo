// Gestione → Automazioni: il tetto totale delle verifiche di un lavoro accanto ai bilanci (#2338). Si legge dalla config
// delle routine, si salva da solo nel suo intervallo, ed è in sola lettura per chi non è owner.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';

async function stubCaps(page, initial) {
  await page.evaluate((init) => {
    window.__capsValue = { ...init };
    window.__capsSets = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_caps_get') return { ok: true, ...window.__capsValue };
      if (msg && msg.type === 'automation_caps_set') {
        for (const k of ['cap3', 'cap2', 'cap1', 'tettoVerifiche']) {
          if (msg[k] != null) { window.__capsValue[k] = msg[k]; window.__capsSets.push({ [k]: msg[k] }); }
        }
        return { ok: true, ...window.__capsValue };
      }
      return orig(msg);
    };
  }, initial);
}

test('il tetto delle verifiche sta accanto ai bilanci, si legge dal server e si salva da solo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await apriScheda(page, 'automation');
  const tetto = page.locator('#mgTettoVerifiche');
  await expect(tetto).toBeVisible();
  // Accanto ai bilanci: subito dopo quello degli 1.
  expect(await page.evaluate(() => document.getElementById('mgCap1Block').nextElementSibling.id)).toBe('mgTettoVerificheBlock');
  await expect(tetto).toBeDisabled();
  await expect(page.locator('#mgTettoVerificheSave')).toBeDisabled();

  await stubCaps(page, { cap3: 3, cap2: 1, cap1: 0, tettoVerifiche: 6, fixInstructions: '' });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadCaps());
  await expect(tetto).toBeEnabled();
  await expect(tetto).toHaveValue('6');

  await tetto.fill('9');
  await page.locator('#mgTettoVerificheSave').click();
  await expect(page.locator('#mgTettoVerificheMsg')).toHaveText('Salvato.');
  // Fuori intervallo si riporta dentro (1-50), e lo zero non vale: almeno una verifica.
  await tetto.fill('0');
  await tetto.press('Enter');
  await expect(tetto).toHaveValue('1');
  await tetto.fill('');
  await page.locator('#mgTettoVerificheSave').click();
  await expect(page.locator('#mgTettoVerificheMsg')).toContainText('non salvato');
  expect(await page.evaluate(() => window.__capsSets)).toEqual([{ tettoVerifiche: 9 }, { tettoVerifiche: 1 }]);
  await page.locator('#mgTettoVerificheBlock').screenshot({ path: 'tests/.shots/manage-tetto-verifiche.png' });

  // Un documento senza il campo: vuoto, e si dice.
  await stubCaps(page, { cap3: 3, cap2: 1, cap1: 0, fixInstructions: '' });
  await page.evaluate(() => window.__mgTest.loadCaps());
  await expect(tetto).toHaveValue('');
  await expect(page.locator('#mgTettoVerificheMsg')).toContainText('Non impostato sul server');
});
