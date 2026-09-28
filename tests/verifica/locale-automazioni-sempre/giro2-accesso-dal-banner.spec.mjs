// Gestione aperta da non owner, accesso dal banner: la scheda Automazioni si sblocca coi valori veri del server.
// Il server finto sta nella pagina (window.__srv) e rifiuta come ownerOnly finché l'accesso non c'è.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apriDaNonOwner(openTab, stato, esitoAccesso = true) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ st, esitoAccesso }) => {
    const srv = window.__srv = Object.assign({
      admin: false, accessi: 0, letture: 0,
      enabled: true, routinesEnabled: false, proberWhenIdle: false,
      autoApprove: { owner: true, user: false, local: true, worker: true, verifier: true, residuo: true, prober: false, claude: true, filo: true },
      cap3: 6, cap2: 3, cap1: 1, cap0: 0, fixInstructions: 'Istruzioni vere del server', giroStretto: true,
      maxSessions: 3, priorityAccount: 'B', accountAOff: true, accountBOff: false, judgeTimeoutMs: 150000,
    }, st);
    const rifiuto = { ok: false, code: 'not_admin', error: 'Operazione riservata agli amministratori' };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, isAdmin: srv.admin };
      if (t === 'auth_signin') {
        srv.accessi++;
        await new Promise((r) => setTimeout(r, 150));
        if (esitoAccesso) srv.admin = true;
        return { ok: esitoAccesso };
      }
      const letture = ['automation_get', 'automation_caps_get', 'automation_sessions_get', 'support_models_get'];
      if (letture.includes(t)) {
        if (!srv.admin) return rifiuto;
        srv.letture++;
        if (t === 'automation_get') return { ok: true, enabled: srv.enabled, autoApprove: { ...srv.autoApprove }, proberWhenIdle: srv.proberWhenIdle, routinesEnabled: srv.routinesEnabled };
        if (t === 'automation_caps_get') return { ok: true, cap3: srv.cap3, cap2: srv.cap2, cap1: srv.cap1, cap0: srv.cap0, fixInstructions: srv.fixInstructions, giroStretto: srv.giroStretto };
        if (t === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: srv.maxSessions, priorityAccount: srv.priorityAccount, accountAOff: srv.accountAOff, accountBOff: srv.accountBOff };
        return { ok: true, models: { judgeTimeoutMs: srv.judgeTimeoutMs } };
      }
      if (t === 'automation_caps_set') {
        if (!srv.admin) return rifiuto;
        for (const k of ['cap3', 'cap2', 'cap1', 'cap0']) if (msg[k] != null) srv[k] = msg[k];
        if (typeof msg.fixInstructions === 'string') srv.fixInstructions = msg.fixInstructions;
        if (typeof msg.giroStretto === 'boolean') srv.giroStretto = msg.giroStretto;
        return { ok: true, cap3: srv.cap3, cap2: srv.cap2, cap1: srv.cap1, cap0: srv.cap0, fixInstructions: srv.fixInstructions, giroStretto: srv.giroStretto };
      }
      return orig(msg);
    };
  }, { st: stato || {}, esitoAccesso });
  await page.locator('.mg-tab[data-tab="automation"]').click();
  return page;
}

test('accesso dal banner: la scheda si sblocca e mostra i valori letti dal server', async ({ openTab }) => {
  const page = await apriDaNonOwner(openTab);
  await expect(page.locator('#mgBanner')).toBeVisible();
  await expect(page.locator('#mgCap3')).toBeDisabled();

  await page.locator('#mgSignIn').click();

  await expect(page.locator('#mgBanner')).toBeHidden();
  await expect(page.locator('#mgCap3')).toBeEnabled();
  await expect(page.locator('#mgRoutinesState')).toHaveText('Off');
  await expect(page.locator('#mgAutoState')).toHaveText('On');
  await expect(page.locator('#mgProberIdle')).not.toBeChecked();
  await expect(page.locator('#mgAutoApproveUser')).not.toBeChecked();
  await expect(page.locator('#mgAutoApproveProber')).not.toBeChecked();
  await expect(page.locator('#mgAutoApproveOwner')).toBeChecked();
  await expect(page.locator('#mgCap3')).toHaveValue('6');
  await expect(page.locator('#mgCap2')).toHaveValue('3');
  await expect(page.locator('#mgCap1')).toHaveValue('1');
  await expect(page.locator('#mgCap0')).toHaveValue('0');
  await expect(page.locator('#mgFixInstructions')).toHaveValue('Istruzioni vere del server');
  await expect(page.locator('#mgGiroStretto')).toBeChecked();
  await expect(page.locator('#mgMaxSessions')).toHaveValue('3');
  await expect(page.locator('input[name="mgPriorityAccount"][value="B"]')).toBeChecked();
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
  await expect(page.locator('#mgAccountB')).toBeChecked();
  await expect(page.locator('#mgJudgeTimeout')).toHaveValue('150');
  for (const sel of ['#mgMaxSessionsMsg', '#mgPriorityAccountMsg', '#mgAccountsMsg', '#mgGiroStrettoMsg']) {
    await expect(page.locator(sel), sel).not.toContainText('server');
  }

  // Dopo l'accesso si cambia e si salva, a routine spente.
  await page.locator('#mgCap2').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgCap2Msg')).toHaveText('Salvato.');
  expect(await page.evaluate(() => window.__srv.cap2)).toBe(5);
});

test('accesso annullato: i campi restano bloccati, nessun valore inventato diventa modificabile', async ({ openTab }) => {
  const page = await apriDaNonOwner(openTab, {}, false);
  await page.locator('#mgSignIn').click();
  await expect.poll(() => page.evaluate(() => window.__srv.accessi)).toBe(1);
  await page.waitForTimeout(500);
  await expect(page.locator('#mgBanner')).toBeVisible();
  for (const sel of ['#mgCap3', '#mgFixInstructions', '#mgMaxSessions', '#mgJudgeTimeout', '#mgProberIdle', '#mgRoutinesToggle']) {
    await expect(page.locator(sel), sel).toBeDisabled();
  }
});

test('doppio clic su Accedi: una lettura sola arriva e i valori sono quelli veri', async ({ openTab }) => {
  const page = await apriDaNonOwner(openTab);
  await page.locator('#mgSignIn').click();
  await page.locator('#mgSignIn').click({ force: true }).catch(() => {});
  await expect(page.locator('#mgCap3')).toBeEnabled();
  await expect(page.locator('#mgCap3')).toHaveValue('6');
  await expect(page.locator('#mgFixInstructions')).toHaveValue('Istruzioni vere del server');
  await expect(page.locator('#mgRoutinesState')).toHaveText('Off');
});
