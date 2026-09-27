// Gestione aperta prima di essere riconosciuti, poi «Accedi» dal banner: la scheda Automazioni si sblocca
// e deve mostrare i valori del server, non quelli di partenza della pagina.
import { test, expect } from './fixtures/electron.mjs';

test('accesso dal banner: le impostazioni sbloccate sono quelle lette dal server', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#mgBanner')).toBeVisible();
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_signin') return { ok: true };
      if (t === 'auth_status') return { ok: true, isAdmin: true };
      if (t === 'automation_get') return { ok: true, enabled: false, autoApprove: { user: false }, proberWhenIdle: false, routinesEnabled: false };
      if (t === 'automation_caps_get') return { ok: true, cap3: 7, cap2: 3, cap1: 1, cap0: 0, fixInstructions: 'Istruzioni del server', giroStretto: true };
      if (t === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: 4, priorityAccount: 'B', accountAOff: false, accountBOff: false };
      if (t === 'support_models_get') return { ok: true, models: { judgeTimeoutMs: 120000 } };
      return orig(msg);
    };
  });
  await page.locator('#mgSignIn').click();
  await expect(page.locator('#mgBanner')).toBeHidden();
  await expect(page.locator('#mgCap3')).toBeEnabled();

  await expect(page.locator('#mgRoutinesState')).toHaveText('Off');
  await expect(page.locator('#mgProberIdle')).not.toBeChecked();
  await expect(page.locator('#mgAutoApproveUser')).not.toBeChecked();
  await expect(page.locator('#mgCap3')).toHaveValue('7');
  await expect(page.locator('#mgFixInstructions')).toHaveValue('Istruzioni del server');
  await expect(page.locator('#mgGiroStretto')).toBeChecked();
  await expect(page.locator('#mgMaxSessions')).toHaveValue('4');
  await expect(page.locator('#mgMaxSessionsMsg')).not.toContainText('Non ho potuto leggere');
  await expect(page.locator('#mgJudgeTimeout')).toHaveValue('120');
});
