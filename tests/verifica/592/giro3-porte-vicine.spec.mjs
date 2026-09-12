// Verifica #592, giro 3 — la porta del giro 2, riprovata da dentro.
//
// Al giro 2 il danno era: una pagina di impostazioni rimasta aperta rimandava
// tutto il suo blocco a ogni tocco e riportava indietro quello che era
// cambiato altrove (modalità terminale riaccesa, chiave API tornata quella di
// prima, stile rimesso). Adesso la pagina manda solo i campi che l'utente ha
// toccato e si rilegge quando arriva un annuncio di cambiamento.
//
// Qui si guarda cosa resta di quella porta:
//   • la rilettura si salta quando il fuoco è dentro un campo — e un campo
//     resta col fuoco addosso per sempre, anche dopo che l'utente è andato in
//     un'altra scheda: basta aver cambiato un menu a tendina;
//   • il confronto "toccato / non toccato" guarda i campi UNO A UNO, ma
//     alcuni campi sono INSIEMI (modalità terminale + shell; chiave
//     OpenRouter + chiave Tavily; voce + velocità + tono). Toccare un pezzo
//     rimanda anche i fratelli, col valore vecchio.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const OPZIONI = 'filo://options/options.html';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

const confermaInChat = (page, action) =>
  page.evaluate(async (a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

const chiHaIlFuoco = (page) =>
  page.evaluate(() => (document.activeElement ? document.activeElement.id || document.activeElement.tagName : 'niente'));

async function apriPreferenze(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 20_000 });
  return page;
}

// ── modalità terminale: il fratello dentro lo stesso insieme ────────────────

test('la shell toccata non deve riaccendere la modalità terminale spenta altrove', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  // 1. l'utente accende la modalità terminale dalla pagina.
  await pagina.check('#terminalEnabled');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(true);

  // 2. cambia il tema. Da qui in poi il fuoco resta su quella tendina: è
  //    l'ultimo elemento che ha toccato, e ci resta anche passando ad
  //    un'altra scheda.
  await pagina.selectOption('#theme', 'dark');
  await pagina.waitForTimeout(1200);
  expect(await chiHaIlFuoco(pagina)).toBe('theme');

  // 3. ci ripensa e spegne la modalità terminale parlando con Filo (livello 2:
  //    passa da una conferma che mostra i rischi).
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'no' });
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);

  // 4. torna sulla pagina e cambia solo la SHELL — non ha chiesto di
  //    riaccendere niente.
  await pagina.selectOption('#terminalShell', 'cmd');
  await pagina.waitForTimeout(1800);

  const dopo = (await impostazioni(pagina)).terminal || {};
  expect(dopo.shell).toBe('cmd');
  expect(dopo.enabled).toBe(false);
});

// ── le due chiavi API: due segreti dentro lo stesso insieme ─────────────────

test('la chiave Tavily toccata non deve rimettere la chiave OpenRouter di prima', async ({ openTab }) => {
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

  // L'utente comincia a scrivere l'ALTRA chiave e lascia il cursore lì dentro.
  await opzioni.click('#apiKeyTavily');
  await opzioni.type('#apiKeyTavily', 'tvly-NUOVA-0002');
  expect(await chiHaIlFuoco(opzioni)).toBe('apiKeyTavily');

  // Nel mentre cambia la chiave OpenRouter parlando con Filo, e conferma.
  await confermaInChat(opzioni,
    { type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-or-v1-NUOVA-0002' });
  await opzioni.waitForTimeout(1200);
  expect((await impostazioni(opzioni)).apiKeys?.openrouter).toBe('sk-or-v1-NUOVA-0002');

  // Finisce di scrivere la chiave Tavily e esce dal campo: è l'unico campo che
  // ha toccato.
  await opzioni.locator('#apiKeyTavily').blur();
  await opzioni.waitForTimeout(1800);

  const chiavi = (await impostazioni(opzioni)).apiKeys || {};
  expect(chiavi.tavily).toBe('tvly-NUOVA-0002');
  expect(chiavi.openrouter).toBe('sk-or-v1-NUOVA-0002');
});

// ── la voce: tre manopole dentro lo stesso insieme ──────────────────────────

test('la voce scelta nella pagina non deve rimettere la velocità di lettura di prima', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  // Il blocco della lettura ad alta voce esiste solo se la pagina lo mostra.
  const ttsC = await pagina.locator('#ttsRate').count();
  test.skip(!ttsC, 'la pagina non espone le manopole della lettura ad alta voce');

  await pagina.selectOption('#theme', 'dark');
  await pagina.waitForTimeout(1200);
  expect(await chiHaIlFuoco(pagina)).toBe('theme');

  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'velocita_voce', valore: '1.6' });
  await pagina.waitForTimeout(1200);
  const rateDopoChat = (await impostazioni(pagina)).tts?.rate;
  expect(rateDopoChat).toBeCloseTo(1.6, 2);

  // L'utente tocca il TONO nella pagina: un'altra manopola, non la velocità.
  await pagina.evaluate(() => {
    const el = document.getElementById('ttsPitch');
    el.value = String((parseFloat(el.value) || 1) === 1.2 ? 0.9 : 1.2);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pagina.waitForTimeout(1800);

  expect((await impostazioni(pagina)).tts?.rate).toBeCloseTo(1.6, 2);
});
