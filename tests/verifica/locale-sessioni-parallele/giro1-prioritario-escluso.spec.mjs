// Giro 1: l'account scelto come prioritario viene escluso. È lo scenario che
// l'owner ha descritto (un account lo uso anche per altro), e sullo schermo
// restano due controlli che dicono il contrario: la pillola «Prima A» accesa e
// l'interruttore «Account A» spento, senza una riga che dica quale account
// userà davvero la prossima sessione.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('escluso l\'account prioritario, la pagina dice quale account resta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();

  await page.evaluate(() => {
    window.__doc = { priorityAccount: 'A', accountAOff: true };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
      }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());

  // Lo stato contraddittorio c'è davvero: «Prima A» acceso e A escluso.
  await expect(page.locator('input[name="mgPriorityAccount"][value="A"]')).toBeChecked();
  await expect(page.locator('#mgAccountA')).not.toBeChecked();

  // Da qualche parte deve comparire che la scelta «Prima A» ora non vale.
  const testi = (await page.locator('#mgAccountsWarn').textContent() || '')
    + (await page.locator('#mgPriorityAccountMsg').textContent() || '');
  const avvisato = await page.locator('#mgAccountsWarn').isVisible() || /escluso|non vale|ignorat/i.test(testi);
  test.fail(true, 'la pagina non segnala che il prioritario è escluso (rilievo del giro 1)');
  expect(avvisato).toBe(true);
});
