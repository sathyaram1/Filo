// Una pagina delle impostazioni aperta da prima non deve disfare quello che è
// cambiato altrove.
//
// Preferenze, Opzioni e Sicurezza salvano da sole a ogni tocco, senza pulsante
// "Salva". Finché rimandavano l'INTERO blocco letto all'apertura, bastava
// toccare un campo qualunque per riscrivere sopra tutto il resto con valori
// vecchi. Il danno peggiore non era estetico:
//   • la modalità terminale, cioè il permesso che dà a Filo la shell, spenta
//     parlando con Filo (con tanto di conferma) si riaccendeva cambiando il
//     tema in una pagina Preferenze rimasta aperta;
//   • la chiave OpenRouter cambiata in chat tornava quella di prima al primo
//     clic su una spunta della pagina Opzioni;
//   • lo stile dell'agente confermato o tolto in chat tornava indietro.
//
// La regola: una pagina manda solo i campi che l'utente ha toccato lei.

import { test, expect } from './fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const OPZIONI = 'filo://options/options.html';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

// Un'azione di Filo già confermata dall'utente.
const confermaInChat = (page, action) =>
  page.evaluate(async (a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

async function apriPreferenze(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 20_000 });
  return page;
}

test('la modalità terminale spenta a voce non si riaccende cambiando il tema', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  await pagina.check('#terminalEnabled');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(true);

  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'no' });
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);

  await pagina.selectOption('#theme', 'dark');
  await pagina.waitForTimeout(1500);

  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);
});

test('lo stile confermato in chat resta anche se poi tocchi un altro campo delle Preferenze', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await pagina.fill('#agentStyleText', 'Stile scritto a mano.');
  await expect(pagina.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 8_000 });

  const nuovo = 'Dammi del lei e sii molto sintetico.';
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: nuovo });
  expect((await impostazioni(pagina)).agentStyle).toBe(nuovo);

  await pagina.selectOption('#theme', 'dark');
  await pagina.waitForTimeout(1500);

  expect((await impostazioni(pagina)).agentStyle).toBe(nuovo);
});

test('la chiave API cambiata in chat non torna quella di prima toccando le Opzioni', async ({ openTab }) => {
  const opzioni = await openTab(OPZIONI);
  await opzioni.waitForSelector('#apiKey', { state: 'attached', timeout: 20_000 });
  if (await opzioni.isChecked('#useDefaultModels')) {
    await opzioni.uncheck('#useDefaultModels');
    await opzioni.waitForTimeout(800);
  }
  await opzioni.waitForSelector('#apiKey', { timeout: 20_000 });

  await opzioni.click('#apiKey');
  await opzioni.type('#apiKey', 'sk-or-v1-CHIAVE-DI-PROVA-0001');
  await opzioni.locator('#apiKey').blur();
  await opzioni.waitForTimeout(1500);
  expect((await impostazioni(opzioni)).apiKeys?.openrouter).toBe('sk-or-v1-CHIAVE-DI-PROVA-0001');

  await confermaInChat(opzioni,
    { type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-or-v1-CHIAVE-NUOVA-0002' });
  expect((await impostazioni(opzioni)).apiKeys?.openrouter).toBe('sk-or-v1-CHIAVE-NUOVA-0002');

  await opzioni.click('#openWeightsOnly');
  await opzioni.waitForTimeout(1500);

  expect((await impostazioni(opzioni)).apiKeys?.openrouter).toBe('sk-or-v1-CHIAVE-NUOVA-0002');
});

test('quello che tocchi tu si salva lo stesso: la regola non spegne il salvataggio', async ({ openTab }) => {
  // Controprova. Senza questa, i test sopra sarebbero verdi anche con la
  // pagina che non salva più niente.
  const pagina = await apriPreferenze(openTab);
  await pagina.selectOption('#theme', 'dark');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).theme).toBe('dark');

  await pagina.fill('#agentStyleText', 'Rispondi corto.');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).agentStyle).toBe('Rispondi corto.');

  await pagina.check('#terminalEnabled');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(true);
});

test('una pagina aperta si rilegge da sola quando l\'impostazione cambia altrove', async ({ openTab }) => {
  // Non basta non disfare: la pagina non deve nemmeno mostrare un valore che
  // non è più vero, se no la spunta dice una cosa e Filo ne fa un'altra.
  const pagina = await apriPreferenze(openTab);
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'si' });
  await expect(pagina.locator('#terminalEnabled')).toBeChecked({ timeout: 8_000 });

  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'Tono squillante.' });
  await expect(pagina.locator('#agentStyleText')).toHaveValue('Tono squillante.', { timeout: 8_000 });
});

// #592 (giro 3) — la stessa porta, un passo più in là: il campo ACCANTO,
// dentro lo stesso gruppo. Modalità terminale e shell sono un gruppo solo, le
// due chiavi API sono un gruppo solo, velocità e tono della voce sono un
// gruppo solo. Finché il confronto si fermava al gruppo, toccare un pezzo
// rimandava anche il fratello col valore vecchio, e il permesso della shell
// spento un minuto prima tornava acceso.

test('la shell cambiata nella pagina non riaccende la modalità terminale spenta a voce', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  await pagina.check('#terminalEnabled');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(true);

  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'no' });
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);

  // Le shell offerte cambiano col sistema: si prende la prima diversa.
  const altra = await pagina.evaluate(() => {
    const sel = document.getElementById('terminalShell');
    const opt = [...sel.options].find((o) => o.value !== sel.value);
    return opt ? opt.value : '';
  });
  expect(altra).not.toBe('');
  await pagina.selectOption('#terminalShell', altra);
  await pagina.waitForTimeout(1800);

  const dopo = (await impostazioni(pagina)).terminal || {};
  expect(dopo.shell).toBe(altra);
  expect(dopo.enabled).toBe(false);
});

test('la chiave Tavily scritta nella pagina non rimette la chiave OpenRouter di prima', async ({ openTab }) => {
  const opzioni = await openTab(OPZIONI);
  await opzioni.waitForSelector('#apiKey', { state: 'attached', timeout: 25_000 });
  if (await opzioni.isChecked('#useDefaultModels')) {
    await opzioni.uncheck('#useDefaultModels');
    await opzioni.waitForTimeout(800);
  }
  await opzioni.waitForSelector('#apiKey', { timeout: 25_000 });

  await opzioni.click('#apiKey');
  await opzioni.type('#apiKey', 'sk-or-v1-VECCHIA-0001');
  await opzioni.locator('#apiKey').blur();
  await opzioni.waitForTimeout(1500);
  expect((await impostazioni(opzioni)).apiKeys?.openrouter).toBe('sk-or-v1-VECCHIA-0001');

  // Il cursore resta dentro l'ALTRO campo mentre la chiave cambia in chat.
  await opzioni.click('#apiKeyTavily');
  await opzioni.type('#apiKeyTavily', 'tvly-NUOVA-0002');
  await confermaInChat(opzioni,
    { type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-or-v1-NUOVA-0002' });
  await opzioni.waitForTimeout(1200);

  await opzioni.locator('#apiKeyTavily').blur();
  await opzioni.waitForTimeout(1800);

  const chiavi = (await impostazioni(opzioni)).apiKeys || {};
  expect(chiavi.tavily).toBe('tvly-NUOVA-0002');
  expect(chiavi.openrouter).toBe('sk-or-v1-NUOVA-0002');
});
