// Gestione → Automazioni, le tre scelte su come partono le sessioni delle
// routine. Qui stanno le guardie che devono reggere per sempre; le prove del
// giro di verifica che le ha fatte nascere vivono altrove e non le sostituiscono.
//
// Quello che difendono: la pagina non mostra MAI un valore che non ha letto, e
// dice quale account resta quando il prioritario è escluso.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apri(openTab, risposte) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate((r) => {
    window.__risposte = r;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') return window.__risposte.get;
      if (msg && msg.type === 'automation_sessions_set') return window.__risposte.set;
      return orig(msg);
    };
  }, risposte);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

test('impostazioni non lette: nessun valore inventato, e la pagina lo dice', async ({ openTab }) => {
  const page = await apri(openTab, { get: { ok: false, error: 'rete giù' }, set: { ok: true } });

  // Il campo resta vuoto invece di mostrare il valore di partenza come se
  // venisse dal server: è quello che fanno anche i bilanci, poco più sotto.
  await expect(page.locator('#mgMaxSessions')).toHaveValue('');
  for (const id of ['#mgMaxSessionsMsg', '#mgPriorityAccountMsg', '#mgAccountsMsg']) {
    await expect(page.locator(id)).toContainText('Non ho potuto leggere dal server');
  }
  // Nessuna pillola accesa: «si alternano» sarebbe una risposta, e non l'abbiamo.
  expect(await page.locator('input[name="mgPriorityAccount"]:checked').count()).toBe(0);
  // E nessun avviso che dipende da uno stato che non conosciamo.
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
  await expect(page.locator('#mgPriorityWarn')).toBeHidden();
});

test('scritto ma non riletto: lo dice, e non spegne la scelta appena salvata', async ({ openTab }) => {
  const page = await apri(openTab, {
    get: { ok: true, letto: true, maxSessions: 6, priorityAccount: '', accountAOff: false, accountBOff: false },
    // La scrittura è andata; la rilettura che la segue no, quindi tornano solo
    // i campi scritti.
    set: { ok: true, letto: false, maxSessions: 12 },
  });
  await expect(page.locator('#mgMaxSessions')).toHaveValue('6');

  await page.locator('#mgMaxSessions').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('12');
  await page.locator('#mgMaxSessionsSave').click();

  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('Salvato');
  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('non l\'ho potuto rileggere');
  // Il numero appena salvato resta al suo posto: tornare a 1 direbbe che la
  // scrittura non è avvenuta, e invece è avvenuta.
  await expect(page.locator('#mgMaxSessions')).toHaveValue('12');
});

test('escluso il prioritario, la pagina dice quale account resta', async ({ openTab }) => {
  const page = await apri(openTab, {
    get: { ok: true, letto: true, maxSessions: 1, priorityAccount: 'A', accountAOff: true, accountBOff: false },
    set: { ok: true },
  });
  await expect(page.locator('#mgPriorityWarn')).toBeVisible();
  await expect(page.locator('#mgPriorityWarn')).toHaveText("L'account A è escluso: le sessioni partono da B.");
  // L'avviso dell'altro caso non si accende per sbaglio.
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
});

test('esclusi tutti e due: parla solo l\'avviso che non parte niente', async ({ openTab }) => {
  const page = await apri(openTab, {
    get: { ok: true, letto: true, maxSessions: 1, priorityAccount: 'A', accountAOff: true, accountBOff: true },
    set: { ok: true },
  });
  await expect(page.locator('#mgAccountsWarn')).toBeVisible();
  // «Le sessioni partono da B» sarebbe falso: da B non parte più niente.
  await expect(page.locator('#mgPriorityWarn')).toBeHidden();
});

test('priorità che vale ancora: nessun avviso di troppo', async ({ openTab }) => {
  const page = await apri(openTab, {
    get: { ok: true, letto: true, maxSessions: 3, priorityAccount: 'B', accountAOff: true, accountBOff: false },
    set: { ok: true },
  });
  await expect(page.locator('#mgMaxSessions')).toHaveValue('3');
  await expect(page.locator('#mgPriorityWarn')).toBeHidden();
  await expect(page.locator('#mgAccountsWarn')).toBeHidden();
});
