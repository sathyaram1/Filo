// Giro 1 di verifica locale: le tre scelte su come partono le sessioni delle
// routine (Gestione → Automazioni). Prova dal punto di vista dell'owner: scelgo
// il numero di sessioni, l'account prioritario, escludo e riattivo un account.
//
// Lo stub sostituisce il SERVER (doc config/routines): tiene i campi e risponde
// come il main, così si vede cosa lascia davvero la pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

/**
 * Finto doc config/routines. `__sessionsSets` raccoglie ciò che la pagina MANDA:
 * è la prova che la scelta esce dalla pagina e arriva dove il server la legge.
 */
async function stubSessions(page, doc = {}, opts = {}) {
  await page.evaluate(([init, o]) => {
    window.__sessionsDoc = Object.assign({}, init);
    window.__sessionsSets = [];
    window.__sessionsFail = !!o.fail;
    window.__sessionsDelay = o.delay || null;   // [msPerChiamata] a turno
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__sessionsDoc));
      }
      if (msg && msg.type === 'automation_sessions_set') {
        const patch = {};
        for (const k of ['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']) {
          if (msg[k] != null) patch[k] = msg[k];
        }
        window.__sessionsSets.push(patch);
        if (Array.isArray(window.__sessionsDelay) && window.__sessionsDelay.length) {
          const ms = window.__sessionsDelay.shift();
          await new Promise((r) => setTimeout(r, ms));
        }
        if (window.__sessionsFail) return { ok: false, error: 'server giù' };
        // Come il main: gli stessi controlli, e un valore storto non si scrive.
        const esito = window.SN_ROUTINE_SESSIONI.valida(patch);
        if (!esito.ok) return { ok: false, error: esito.testo };
        Object.assign(window.__sessionsDoc, esito.valori);
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__sessionsDoc));
      }
      return orig(msg);
    };
  }, [doc, opts]);
}

async function apriAutomazioni(openTab, doc = {}, opts = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await stubSessions(page, doc, opts);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

// Cambia un interruttore come farebbe un click dell'utente.
const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);

// La pillola dell'account prioritario: si clicca l'etichetta, come l'utente
// (il radio vero è nascosto sotto di essa).
const pillola = (page, valore) => page.locator('.mg-auto-choice-item')
  .filter({ has: page.locator(`input[name="mgPriorityAccount"][value="${valore}"]`) });

// Scrive nel campo numerico passando dalla tastiera: `fill()` rifiuta tutto ciò
// che numero non è, e proprio quei casi sono il motivo della prova.
async function scriviNumero(page, testo) {
  await page.locator('#mgMaxSessions').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  if (testo) await page.keyboard.type(testo);
}

test('il cammino dell\'owner: scelgo le sessioni, l\'account prioritario, escludo e riattivo', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab);

  // Senza campi sul documento: una sessione, si alternano, tutti e due in uso.
  await expect(page.locator('#mgMaxSessions')).toHaveValue('1');
  await expect(page.locator('input[name="mgPriorityAccount"][value=""]')).toBeChecked();
  await expect(page.locator('#mgAccountA')).toBeChecked();
  await expect(page.locator('#mgAccountB')).toBeChecked();
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();

  // 1) Quante sessioni in parallelo.
  await page.locator('#mgMaxSessions').fill('5');
  await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  await expect.poll(() => page.evaluate(() => window.__sessionsDoc.maxSessions)).toBe(5);

  // 2) Prima l'account B.
  await pillola(page, 'B').click();
  await expect.poll(() => page.evaluate(() => window.__sessionsDoc.priorityAccount)).toBe('B');
  await expect(page.locator('#mgPriorityAccountMsg')).toHaveText('Salvato.');

  // 3) Escludo l'account A, e lo riattivo (si può togliere ciò che si aggiunge).
  await cambia(page, 'mgAccountA', false);
  await expect.poll(() => page.evaluate(() => window.__sessionsDoc.accountAOff)).toBe(true);
  await cambia(page, 'mgAccountA', true);
  await expect.poll(() => page.evaluate(() => window.__sessionsDoc.accountAOff)).toBe(false);
  await expect(page.locator('#mgAccountA')).toBeChecked();

  // Le tre scelte convivono: nessuna ha cancellato le altre.
  expect(await page.evaluate(() => window.__sessionsDoc)).toMatchObject({
    maxSessions: 5, priorityAccount: 'B', accountAOff: false,
  });
});

test('le scelte tornano su come le ho lasciate riaprendo la pagina', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab, { maxSessions: 7, priorityAccount: 'A', accountBOff: true });
  await expect(page.locator('#mgMaxSessions')).toHaveValue('7');
  await expect(page.locator('input[name="mgPriorityAccount"][value="A"]')).toBeChecked();
  await expect(page.locator('#mgAccountA')).toBeChecked();
  await expect(page.locator('#mgAccountB')).not.toBeChecked();
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
});

test('escludere tutti e due gli account lo dice, e riattivarne uno lo toglie', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab);
  await cambia(page, 'mgAccountA', false);
  await expect.poll(() => page.evaluate(() => window.__sessionsDoc.accountAOff)).toBe(true);
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
  await cambia(page, 'mgAccountB', false);
  await expect(page.locator('#mgAccountsWarn')).toBeVisible();
  await expect(page.locator('#mgAccountsWarn')).toHaveText(/nessun account/i);
  await cambia(page, 'mgAccountB', true);
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
});

test('un numero storto non si salva e lo dice, senza toccare quello che c\'era', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab, { maxSessions: 4 });
  for (const scritto of ['0', '21', '3.5', '', '   ', '-2', '999999', 'e', '1e3']) {
    await scriviNumero(page, scritto);
    await page.locator('#mgMaxSessionsSave').click();
    await expect(page.locator('#mgMaxSessionsMsg')).toContainText('Non salvato.', { timeout: 3000 });
    expect(await page.evaluate(() => window.__sessionsDoc.maxSessions)).toBe(4);
  }
  // Un numero buono dopo tutti quelli storti passa lo stesso.
  await scriviNumero(page, '20');
  await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  expect(await page.evaluate(() => window.__sessionsDoc.maxSessions)).toBe(20);
});

test('«tre» scritto a parole non passa per campo vuoto', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab, { maxSessions: 2 });
  await page.locator('#mgMaxSessions').click();
  await page.keyboard.type('tre');
  await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('Non salvato.');
  expect(await page.evaluate(() => window.__sessionsDoc.maxSessions)).toBe(2);
});

test('diecimila caratteri nel campo non salvano niente e non bloccano la pagina', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab, { maxSessions: 3 });
  await page.evaluate(() => {
    const el = document.getElementById('mgMaxSessions');
    el.value = '9'.repeat(10000);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('Non salvato.');
  expect(await page.evaluate(() => window.__sessionsDoc.maxSessions)).toBe(3);
  // La pagina risponde ancora: l'altra strada funziona subito dopo.
  await cambia(page, 'mgAccountB', false);
  await expect.poll(() => page.evaluate(() => window.__sessionsDoc.accountBOff)).toBe(true);
});

test('Invio nel campo salva come il pulsante (strade equivalenti)', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab);
  await page.locator('#mgMaxSessions').fill('9');
  await page.locator('#mgMaxSessions').press('Enter');
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  expect(await page.evaluate(() => window.__sessionsDoc.maxSessions)).toBe(9);
});

test('se il salvataggio fallisce la pagina non mostra una scelta mai arrivata', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab, { maxSessions: 2 }, { fail: true });
  await cambia(page, 'mgAccountA', false);
  await expect(page.locator('#mgAccountsMsg')).toContainText('NON è cambiata');
  await expect(page.locator('#mgAccountA')).toBeChecked();
  await page.locator('input[name="mgPriorityAccount"][value="A"]').check();
  await expect(page.locator('#mgPriorityAccountMsg')).toContainText('NON è cambiata');
  await expect(page.locator('input[name="mgPriorityAccount"][value=""]')).toBeChecked();
});

test('due clic in fretta sullo stesso interruttore non lasciano la pagina a mentire', async ({ openTab }) => {
  // La prima risposta arriva DOPO la seconda: è il caso che scambia lo stato.
  const page = await apriAutomazioni(openTab, {}, { delay: [400, 0] });
  await cambia(page, 'mgAccountA', false);
  await cambia(page, 'mgAccountA', true);
  await page.waitForTimeout(900);
  const doc = await page.evaluate(() => window.__sessionsDoc.accountAOff === true);
  const ui = await page.locator('#mgAccountA').isChecked();
  // Quello che si vede deve essere quello che c'è sul server.
  expect(ui).toBe(!doc);
});

test('le scelte restano manovrabili anche a routine spente', async ({ openTab }) => {
  const page = await apriAutomazioni(openTab);
  await expect(page.locator('#mgMaxSessions')).toBeEnabled();
  await expect(page.locator('#mgAccountA')).toBeEnabled();
  await expect(page.locator('input[name="mgPriorityAccount"][value="A"]')).toBeEnabled();
});

test('da non-admin le scelte sono in sola lettura', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#mgMaxSessions')).toBeDisabled();
  await expect(page.locator('#mgAccountA')).toBeDisabled();
  await expect(page.locator('#mgAccountB')).toBeDisabled();
  await expect(page.locator('input[name="mgPriorityAccount"][value="B"]')).toBeDisabled();
});
