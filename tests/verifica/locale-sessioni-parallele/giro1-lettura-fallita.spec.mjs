// Giro 1: cosa mostra il riquadro delle sessioni quando il server NON si legge.
// Il vicino di pannello (i bilanci dei giri) distingue «letto dal server» da
// «non ho potuto leggere» e lo dice; qui si guarda se anche queste tre scelte
// lo fanno, perché una che dice «Account A: in uso» senza aver letto niente
// promette il contrario di quello che l'owner voleva ottenere.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('a lettura fallita il riquadro non spaccia i valori di ripiego per quelli del server', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();

  // Il server non risponde: nessun valore è arrivato.
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') return { ok: false, error: 'rete giù' };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());

  // L'owner deve capire che questi non sono i valori veri: o un avviso, o i
  // campi vuoti. Mostrare «1 sessione, tutti e due gli account in uso» come se
  // venisse dal server è la cosa che non deve succedere.
  const avviso = (await page.locator('#mgMaxSessionsMsg').textContent() || '')
    + (await page.locator('#mgAccountsMsg').textContent() || '')
    + (await page.locator('#mgPriorityAccountMsg').textContent() || '');
  const valore = await page.locator('#mgMaxSessions').inputValue();
  const aInUso = await page.locator('#mgAccountA').isChecked();
  test.fail(true, 'a lettura fallita mostra i valori di ripiego senza dirlo (rilievo del giro 1)');
  expect(avviso.trim() !== '' || valore === '').toBe(true);
  expect(aInUso).toBe(true); // annotato: il punto è l'avviso, non il valore
});

test('«Salvato.» e intanto il campo torna a 1: la seconda porta dello stesso guasto', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();

  // La scrittura va a buon fine; la rilettura che la segue no, e al suo posto
  // tornano i valori di ripiego — indistinguibili da un documento vuoto.
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') return { ok: true, maxSessions: 6, priorityAccount: '', accountAOff: false, accountBOff: false };
      if (msg && msg.type === 'automation_sessions_set') return { ok: true, maxSessions: 1, priorityAccount: '', accountAOff: false, accountBOff: false };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  await expect(page.locator('#mgMaxSessions')).toHaveValue('6');

  await page.locator('#mgMaxSessions').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('12');
  await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');

  // Dice «Salvato.» e mostra 1: nessuna delle due cose è quella che è successa.
  test.fail(true, 'la rilettura fallita si traveste da valore salvato (rilievo del giro 1)');
  await expect(page.locator('#mgMaxSessions')).not.toHaveValue('1');
});
