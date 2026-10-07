// Gestione → Automazioni a routine spente: ogni impostazione si cambia e arriva al server finto.
// Il server finto sta nella pagina (window.__srv) e risponde come il main: stato vero, non risposte fisse.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const SHOTS = process.env.FILO_VERIFICA_SHOTS || '';

async function apri(openTab, iniziale) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate((st) => {
    const srv = window.__srv = Object.assign({
      enabled: false, routinesEnabled: false, proberWhenIdle: true,
      autoApprove: { owner: true, user: true, local: true, worker: true, verifier: true, residuo: true, prober: true, claude: true, filo: true },
      cap3: 5, cap2: 4, cap1: 2, cap0: 0, fixInstructions: '', giroStretto: false,
      maxSessions: 2, priorityAccount: '', accountAOff: false, accountBOff: false,
      judgeTimeoutMs: 60000, scritture: [],
    }, st);
    const auto = () => ({ ok: true, enabled: srv.enabled, autoApprove: { ...srv.autoApprove }, proberWhenIdle: srv.proberWhenIdle, routinesEnabled: srv.routinesEnabled });
    const caps = () => ({ ok: true, cap3: srv.cap3, cap2: srv.cap2, cap1: srv.cap1, cap0: srv.cap0, fixInstructions: srv.fixInstructions, giroStretto: srv.giroStretto });
    const sess = () => ({ ok: true, letto: true, maxSessions: srv.maxSessions, priorityAccount: srv.priorityAccount, accountAOff: srv.accountAOff, accountBOff: srv.accountBOff });
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, isAdmin: true };
      if (t === 'automation_get') return auto();
      if (t === 'automation_set') {
        srv.scritture.push(t);
        if (typeof msg.enabled === 'boolean') srv.enabled = msg.enabled;
        if (typeof msg.routinesEnabled === 'boolean') srv.routinesEnabled = msg.routinesEnabled;
        if (typeof msg.proberWhenIdle === 'boolean') srv.proberWhenIdle = msg.proberWhenIdle;
        if (msg.autoApprove) Object.assign(srv.autoApprove, msg.autoApprove);
        return auto();
      }
      if (t === 'automation_caps_get') return caps();
      if (t === 'automation_caps_set') {
        srv.scritture.push(t);
        for (const k of ['cap3', 'cap2', 'cap1', 'cap0']) if (msg[k] != null) srv[k] = msg[k];
        if (typeof msg.fixInstructions === 'string') srv.fixInstructions = msg.fixInstructions;
        if (typeof msg.giroStretto === 'boolean') srv.giroStretto = msg.giroStretto;
        return caps();
      }
      if (t === 'automation_sessions_get') return sess();
      if (t === 'automation_sessions_set') {
        srv.scritture.push(t);
        for (const k of ['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']) if (msg[k] !== undefined) srv[k] = msg[k];
        return sess();
      }
      if (t === 'support_models_get') return { ok: true, models: { judgeTimeoutMs: srv.judgeTimeoutMs } };
      if (t === 'support_models_update') {
        srv.scritture.push(t);
        if (msg.judgeTimeoutMs != null) srv.judgeTimeoutMs = msg.judgeTimeoutMs;
        return { ok: true, models: { judgeTimeoutMs: srv.judgeTimeoutMs } };
      }
      return orig(msg);
    };
  }, iniziale || {});
  await page.evaluate(async () => {
    window.__mgTest.setAdmin(true);
    await Promise.all([window.__mgTest.loadAutoMode(), window.__mgTest.loadCaps(), window.__mgTest.loadSessions(), window.__mgTest.loadJudgeTimeout()]);
  });
  return page;
}

async function scrivi(page, sel, valore) {
  await page.locator(sel).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(String(valore));
}

const srv = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__srv)));

test('routine e automatica spente: ogni impostazione della scheda si cambia e si salva', async ({ openTab }) => {
  const page = await apri(openTab, { routinesEnabled: false, enabled: false });
  await expect(page.locator('#mgRoutinesState')).toHaveText('Off');
  await expect(page.locator('#mgAutoState')).toHaveText('Off');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/automazioni-spente.png`, fullPage: true });

  // I quattro bilanci: due col pulsante, due con Invio.
  await scrivi(page, '#mgCap3', 7); await page.locator('#mgCap3Save').click();
  await expect(page.locator('#mgCap3Msg')).toHaveText('Salvato.');
  await scrivi(page, '#mgCap2', 3); await page.locator('#mgCap2Save').click();
  await expect(page.locator('#mgCap2Msg')).toHaveText('Salvato.');
  await scrivi(page, '#mgCap1', 1); await page.keyboard.press('Enter');
  await expect(page.locator('#mgCap1Msg')).toHaveText('Salvato.');
  await scrivi(page, '#mgCap0', 2); await page.keyboard.press('Enter');
  await expect(page.locator('#mgCap0Msg')).toHaveText('Salvato.');

  // Le istruzioni per chi corregge.
  await page.locator('#mgFixInstructions').fill('Correggi solo i rilievi interni, <b>niente</b> altro 🧵');
  await page.locator('#mgFixInstructionsSave').click();
  await expect(page.locator('#mgFixInstructionsMsg')).toHaveText('Salvato.');

  // Interruttori: giro stretto, esplorazione, un mittente dell'auto-approvazione.
  await page.locator('#mgGiroStrettoSwitch').click();
  await expect(page.locator('#mgGiroStrettoMsg')).toHaveText('Salvato.');
  await page.locator('#mgProberIdleBlock .mg-switch').click();
  await page.locator('label:has(#mgAutoApproveUser)').click();

  // Sessioni: quante, prioritario, account.
  await scrivi(page, '#mgMaxSessions', 4); await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  await page.locator('label.mg-auto-choice-item:has(input[value="B"])').click();
  await expect(page.locator('#mgPriorityAccountMsg')).toHaveText('Salvato.');
  await page.locator('label:has(#mgAccountA)').click();
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');

  // Timeout dei giudici.
  await scrivi(page, '#mgJudgeTimeout', 120); await page.locator('#mgJudgeTimeoutSave').click();
  await expect(page.locator('#mgJudgeTimeoutMsg')).toHaveText('Salvato.');

  const s = await srv(page);
  expect(s).toMatchObject({
    cap3: 7, cap2: 3, cap1: 1, cap0: 2,
    fixInstructions: 'Correggi solo i rilievi interni, <b>niente</b> altro 🧵',
    giroStretto: true, proberWhenIdle: false, maxSessions: 4, priorityAccount: 'B',
    accountAOff: true, judgeTimeoutMs: 120000,
    routinesEnabled: false, enabled: false,
  });
  expect(s.autoApprove.user).toBe(false);
  // Il testo con markup resta testo: nessun <b> è diventato un elemento.
  expect(await page.locator('#panel-automation b').count()).toBe(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/automazioni-salvate.png`, fullPage: true });

  // Riletti dal server (riapertura della scheda): i valori salvati restano.
  await page.evaluate(() => Promise.all([window.__mgTest.loadCaps(), window.__mgTest.loadSessions(), window.__mgTest.loadAutoMode(), window.__mgTest.loadJudgeTimeout()]));
  await expect(page.locator('#mgCap3')).toHaveValue('7');
  await expect(page.locator('#mgCap0')).toHaveValue('2');
  await expect(page.locator('#mgFixInstructions')).toHaveValue('Correggi solo i rilievi interni, <b>niente</b> altro 🧵');
  await expect(page.locator('#mgGiroStretto')).toBeChecked();
  await expect(page.locator('#mgMaxSessions')).toHaveValue('4');
  await expect(page.locator('#mgJudgeTimeout')).toHaveValue('120');
});

test('spegnere le routine dalla scheda non blocca niente, e riaccese i valori restano', async ({ openTab }) => {
  const page = await apri(openTab, { routinesEnabled: true, enabled: true });
  await expect(page.locator('#mgRoutinesState')).toHaveText('On');
  await page.locator('#mgRoutinesSwitch').click();
  await expect(page.locator('#mgRoutinesState')).toHaveText('Off');
  await expect(page.locator('#mgRoutinesMsg')).toContainText('Salvato');
  await page.locator('#mgAutoSwitch').click();
  await expect(page.locator('#mgAutoState')).toHaveText('Off');

  for (const sel of ['#mgCap3', '#mgCap2', '#mgCap1', '#mgCap0', '#mgFixInstructions', '#mgGiroStretto', '#mgProberIdle',
    '#mgMaxSessions', '#mgAccountA', '#mgAccountB', '#mgJudgeTimeout', '#mgAutoApproveOwner', '#mgAutoApproveFilo']) {
    await expect(page.locator(sel), sel).toBeEnabled();
  }

  await scrivi(page, '#mgCap2', 9); await page.keyboard.press('Enter');
  await expect(page.locator('#mgCap2Msg')).toHaveText('Salvato.');
  await page.locator('#mgFixInstructions').fill('   ');
  await page.locator('#mgFixInstructionsSave').click();
  await expect(page.locator('#mgFixInstructionsMsg')).toContainText('Salvato');

  await page.locator('#mgRoutinesSwitch').click();
  await expect(page.locator('#mgRoutinesState')).toHaveText('On');
  await page.evaluate(() => window.__mgTest.loadCaps());
  await expect(page.locator('#mgCap2')).toHaveValue('9');
  expect((await srv(page)).cap2).toBe(9);
});

test('istruzioni troppo lunghe a routine spente: rifiuto col numero, niente taglio muto', async ({ openTab }) => {
  const page = await apri(openTab, { routinesEnabled: false });
  const max = await page.evaluate(() => window.SN_CONST.AUTOMATION.FIX_INSTRUCTIONS_MAX || 8000);
  await page.locator('#mgFixInstructions').fill('x'.repeat(max + 10));
  await page.locator('#mgFixInstructionsSave').click();
  await expect(page.locator('#mgFixInstructionsMsg')).toContainText(String(max + 10));
  expect((await srv(page)).fixInstructions).toBe('');
  await page.locator('#mgFixInstructions').fill('x'.repeat(max));
  await page.locator('#mgFixInstructionsSave').click();
  await expect(page.locator('#mgFixInstructionsMsg')).toHaveText('Salvato.');
  expect((await srv(page)).fixInstructions.length).toBe(max);
});
