// Verifica #592, giro 2 — quante porte porta allo stesso stato sbagliato.
//
// Trovato: con la pagina Preferenze aperta, un cambio fatto altrove (Filo in
// chat, con la conferma dell'utente) viene riscritto dai valori che la pagina
// si era letta all'apertura, appena si tocca un campo qualunque. Prima di
// scrivere il rilievo si conta: lo stile è l'unica cosa che si perde, o la
// pagina riporta indietro anche il resto?
//
// Il caso che conta di più è la modalità terminale: è l'altra preferenza di
// livello 2 della pagina, quella che dà a Filo la shell. Se una pagina vecchia
// la può riaccendere, la conferma che l'aveva spenta non è servita a niente.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

const confermaInChat = (page, action) =>
  page.evaluate(async (a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

async function apriPreferenze(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 15_000 });
  return page;
}

test('una pagina Preferenze aperta da prima non deve riaccendere la modalità terminale', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  // 1. l'utente accende la modalità terminale dalla pagina.
  await pagina.check('#terminalEnabled');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(true);

  // 2. ci ripensa e la spegne parlando con Filo (livello 2: passa da una
  //    conferma). La pagina è ancora aperta, con la spunta accesa.
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'no' });
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);

  // 3. torna sulla pagina e cambia il TEMA — niente a che vedere col terminale.
  await pagina.selectOption('#theme', 'dark');
  await pagina.waitForTimeout(1500);

  // La shell deve restare spenta: nessuno ha chiesto di riaccenderla.
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);
});
