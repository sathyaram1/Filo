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

  // Il fuoco resta sulla spunta che ha appena toccato, e ci resta anche
  //    mentre l'utente va in un'altra scheda a parlare con Filo.
  expect(await chiHaIlFuoco(pagina)).toBe('terminalEnabled');

  // 3. ci ripensa e spegne la modalità terminale parlando con Filo (livello 2:
  //    passa da una conferma che mostra i rischi).
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'no' });
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);

  // 4. torna sulla pagina e cambia solo la SHELL — non ha chiesto di
  //    riaccendere niente.
  // Le shell offerte cambiano col sistema: si prende la prima diversa da
  // quella selezionata adesso.
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

  // L'utente sta scrivendo nel riquadro dello stile: il cursore è lì dentro.
  await pagina.click('#agentStyleText');
  expect(await chiHaIlFuoco(pagina)).toBe('agentStyleText');

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

// ── la pagina Sicurezza: le protezioni dentro lo stesso insieme ─────────────

const SICUREZZA = 'filo://security/security.html';

test('una sotto-opzione toccata non deve riaccendere il rilevamento siti pericolosi', async ({ openTab }) => {
  const pagina = await openTab(SICUREZZA);
  await pagina.waitForSelector('#sec-safebrowse', { timeout: 25_000 });

  // Il rilevamento è acceso: le sue sotto-opzioni si vedono.
  if (!(await pagina.isChecked('#sec-safebrowse'))) {
    await pagina.click('#sec-safebrowse');
    await pagina.waitForTimeout(1200);
  }
  await pagina.click('#sec-safebrowse-network');
  await pagina.waitForTimeout(1200);
  expect(await chiHaIlFuoco(pagina)).toBe('sec-safebrowse-network');

  // L'utente lo spegne parlando con Filo (livello 2, con conferma).
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'navigazione_sicura', valore: 'no' });
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).security?.safeBrowse?.enabled).toBe(false);

  // Poi tocca un'altra SOTTO-opzione del rilevamento nella pagina.
  await pagina.click('#sec-safebrowse-llm');
  await pagina.waitForTimeout(1800);

  expect((await impostazioni(pagina)).security?.safeBrowse?.enabled).toBe(false);
});

test('un sito aggiunto ai fidati non deve rimettere la gestione cookie di prima', async ({ openTab }) => {
  const pagina = await openTab(SICUREZZA);
  await pagina.waitForSelector('#cookie-wl-input', { timeout: 25_000 });

  // I siti fidati si scrivono solo in "Privacy massima": è da lì che si parte.
  await pagina.click('#cookie-mode-privacy');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).security?.cookies?.mode).toBe('privacy');

  // L'utente scrive un sito fidato e lascia il cursore nel campo.
  await pagina.click('#cookie-wl-input');
  await pagina.type('#cookie-wl-input', 'esempio.it');
  expect(await chiHaIlFuoco(pagina)).toBe('cookie-wl-input');

  // Nel mentre cambia la gestione dei cookie parlando con Filo, e conferma.
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'gestione_cookie', valore: 'manuale' });
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).security?.cookies?.mode).toBe('manual');

  // Finisce di aggiungere il sito fidato.
  await pagina.click('#cookie-wl-add-btn');
  await pagina.waitForTimeout(1800);

  expect((await impostazioni(pagina)).security?.cookies?.mode).toBe('manual');
});

// ── il riquadro dello stile dice una cosa e in memoria ce n'è un'altra ──────

test('«normale» scritto nel riquadro: quello che si vede e quello che è salvato devono coincidere', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  // Prima uno stile vero, così c'è qualcosa da cancellare.
  await pagina.click('#agentStyleText');
  await pagina.type('#agentStyleText', 'Rispondi con frasi brevi.');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).agentStyle).toBe('Rispondi con frasi brevi.');

  // Poi l'utente lo sostituisce con la parola «normale» e resta nel riquadro
  // (non clicca altrove: legge quello che ha scritto).
  await pagina.fill('#agentStyleText', 'normale');
  await pagina.waitForTimeout(1500);

  const salvato = (await impostazioni(pagina)).agentStyle;
  const mostrato = await pagina.inputValue('#agentStyleText');
  if (mostrato === salvato) return; // il riquadro mostra quello che c'è: a posto

  // Se il riquadro tiene la parola che l'utente ha appena scritto (e tenerla è
  // giusto: cancellargliela sotto le dita mentre scrive sarebbe peggio), allora
  // lo schermo deve dire che in vigore non c'è nessuno stile. Altrimenti chi
  // chiude la scheda qui se ne va convinto di avere uno stile che non ha.
  expect(salvato).toBe('');
  expect(await pagina.evaluate(() => document.getElementById('agentStylePreset').value)).toBe('');
  await expect(pagina.locator('#agentStyleNote')).toBeVisible();
  expect(await pagina.textContent('#agentStyleNote')).toContain('nessuno stile');
});
