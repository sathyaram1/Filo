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

// ── Quello che la pagina NON ha salvato non si butta via ────────────────────
//
// Rileggere la pagina quando qualcosa cambia altrove è la cura giusta, ma la
// rilettura riscrive tutti i campi con quello che c'è in memoria. Sullo schermo
// però c'è anche roba che in memoria non c'è, e non per sbaglio: è quella che
// la pagina si tiene apposta perché l'utente la sistemi. Uno stile più lungo
// del tetto (che il tetto promette di non accorciare da sé), una misura scritta
// senza unità, una riga della lista dei siti bloccati scritta male. Rileggendo
// spariva tutto, insieme all'avviso che diceva perché (#592, giro 4).

test('lo stile oltre il tetto resta nel riquadro quando cambia un\'altra impostazione', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  const lungo = 'Parla come un capitano di mare. '.repeat(30); // ben oltre il tetto
  await pagina.fill('#agentStyleText', lungo);
  await pagina.waitForTimeout(2000);
  await expect(pagina.locator('#agentStyleError')).toBeVisible();
  expect((await impostazioni(pagina)).agentStyle || '').toBe('');

  // L'utente esce dal riquadro e chiede a Filo tutt'altro.
  await pagina.evaluate(() => document.getElementById('agentStyleText').blur());
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'archiviazione_automatica', valore: 'no' });
  await pagina.waitForTimeout(2500);

  // Il testo che deve ancora accorciare è ancora lì, e l'avviso pure.
  expect(await pagina.inputValue('#agentStyleText')).toBe(lungo);
  await expect(pagina.locator('#agentStyleError')).toBeVisible();
});

test('una misura dell\'aspetto scritta male resta sullo schermo per essere corretta', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await pagina.waitForSelector('#tok-radius', { timeout: 20_000 });

  await pagina.fill('#tok-radius', '14'); // manca l'unità
  await pagina.locator('#tok-radius').blur();
  await pagina.waitForTimeout(1200);
  expect(await pagina.inputValue('#tok-radius')).toBe('14');

  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'archiviazione_automatica', valore: 'no' });
  await pagina.waitForTimeout(2500);

  expect(await pagina.inputValue('#tok-radius')).toBe('14');
});

test('una riga di modello appena cominciata non sparisce dalle Opzioni', async ({ openTab }) => {
  const opzioni = await openTab(OPZIONI);
  await opzioni.waitForSelector('#addModelRow', { state: 'attached', timeout: 25_000 });
  if (await opzioni.isChecked('#useDefaultModels')) {
    await opzioni.uncheck('#useDefaultModels');
  }
  await opzioni.waitForSelector('#addModelRow', { timeout: 25_000 });
  await opzioni.waitForTimeout(1200);

  const righe = () => opzioni.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
  const quante = await righe().count();
  await opzioni.click('#addModelRow');
  await righe().nth(quante).locator('.sn-model-id').fill('un/modello-nuovo');
  await opzioni.waitForTimeout(1200);

  // Il soprannome non c'è ancora, quindi la riga non è in memoria: giusto.
  await confermaInChat(opzioni, { type: 'IMPOSTA_PREFERENZA', chiave: 'blocco_popup', valore: 'no' });
  await opzioni.waitForTimeout(2500);

  expect(await righe().count()).toBe(quante + 1);
  expect(await righe().nth(quante).locator('.sn-model-id').inputValue()).toBe('un/modello-nuovo');
});

test('le righe scartate dalla lista dei siti bloccati restano scritte', async ({ openTab }) => {
  const sicurezza = await openTab('filo://security/security.html');
  await sicurezza.waitForSelector('#sec-siteblock-blacklist', { timeout: 25_000 });

  const scritto = 'esempio.test\nnon un dominio!!\naltro.test';
  await sicurezza.fill('#sec-siteblock-blacklist', scritto);
  await sicurezza.locator('#sec-siteblock-blacklist').blur();
  await sicurezza.waitForTimeout(1500);
  expect(await sicurezza.inputValue('#sec-siteblock-blacklist')).toContain('non un dominio!!');

  await confermaInChat(sicurezza, { type: 'IMPOSTA_PREFERENZA', chiave: 'protezione_ip', valore: 'no' });
  await sicurezza.waitForTimeout(2500);

  expect(await sicurezza.inputValue('#sec-siteblock-blacklist')).toContain('non un dominio!!');
});

// ── Il canale delle pagine web scrive solo quello che gli è permesso ────────

test('da un\'origine web passa solo il modello di dettatura, niente altro', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  const prima = await impostazioni(page);
  expect(prima.terminal?.enabled).toBe(false);

  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    {
      type: 'update_settings',
      settings: {
        terminal: { enabled: true, shell: 'bash' },
        monthlyLimitEur: 9999,
        models: { filo_chat: 'attaccante/modello', transcribe_audio: 'dettatura' },
        security: {
          safeBrowse: { enabled: false },
          cookies: { mode: 'manual' },
          fingerprint: { mode: 'off' },
          adblock: { enabled: false },
          siteBlock: { enabled: false },
          protectIpLeak: false,
          blockPopups: false,
        },
      },
    },
    { url: 'https://sito-ostile.example/pagina.html' },
  ));

  const dopo = await impostazioni(page);
  expect(dopo.terminal?.enabled).toBe(false);
  expect(dopo.security?.safeBrowse?.enabled).toBe(true);
  expect(dopo.security?.cookies?.mode).toBe('default');
  expect(dopo.security?.fingerprint?.mode).toBe('default');
  expect(dopo.security?.adblock?.enabled).toBe(true);
  expect(dopo.security?.siteBlock?.enabled).toBe(true);
  expect(dopo.security?.protectIpLeak).toBe(true);
  expect(dopo.security?.blockPopups).toBe(true);
  expect(Number(dopo.monthlyLimitEur)).toBe(Number(prima.monthlyLimitEur));
  expect(dopo.models?.filo_chat).toBe(prima.models?.filo_chat);
  // L'unica cosa che un content script fa davvero: scegliere il modello di
  // dettatura dal menu del tasto destro.
  expect(dopo.models?.transcribe_audio).toBe('dettatura');

  // Controprova: dalla pagina interna la stessa scrittura passa.
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'update_settings', settings: { terminal: { enabled: true } } },
    { url: 'filo://preferences/preferences.html' },
  ));
  expect((await impostazioni(page)).terminal?.enabled).toBe(true);
});

// ── Il salvataggio dell'aspetto, e la pagina che non deve restare sorda ─────
//
// I colori e le misure si salvano come una mappa intera, perché chi manca è
// tornato al predefinito. Per un po' la pagina è rimasta sorda per un secondo e
// mezzo dopo ogni suo salvataggio, per non cancellare i propri avvisi: in quella
// finestra rimandava la mappa com'era all'apertura, e un colore chiesto a Filo
// spariva del tutto (#592, giro 5). Adesso la mappa riparte da quello che c'è in
// memoria e la pagina si rilegge sempre.

test('un colore chiesto a Filo sopravvive al ritocco di una misura appena dopo un salvataggio', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await pagina.waitForSelector('#tok-radius', { timeout: 20_000 });

  await pagina.fill('#tok-radius', '11px');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).themeTokens?.radius).toBe('11px');

  // La pagina salva (una spunta qualunque) e nello stesso istante Filo applica
  // un colore d'accento.
  await pagina.uncheck('#showHomeMessage');
  await confermaInChat(pagina, { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#0055ff' });
  await pagina.waitForTimeout(300);
  expect((await impostazioni(pagina)).themeTokens?.accent).toBe('#0055ff');

  // Poi l'utente ritocca la misura: il colore che ha chiesto a voce resta.
  await pagina.fill('#tok-radius', '12px');
  await pagina.waitForTimeout(2500);
  const dopo = (await impostazioni(pagina)).themeTokens || {};
  expect(dopo.radius).toBe('12px');
  expect(dopo.accent).toBe('#0055ff');
});

test('il colore delle schede spento a voce non torna accesso ritoccando la saturazione', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await pagina.waitForSelector('#tabcol-saturazione_tab', { state: 'attached', timeout: 20_000 });

  await pagina.uncheck('#showHomeMessage');
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'colore_tab', valore: 'togli il colore' });
  await pagina.waitForTimeout(300);
  expect((await impostazioni(pagina)).tabColor?.opacita_tab).toBe(0);

  await pagina.fill('#tabcol-saturazione_tab', '0.55');
  await pagina.dispatchEvent('#tabcol-saturazione_tab', 'input');
  await pagina.waitForTimeout(2500);
  expect((await impostazioni(pagina)).tabColor?.opacita_tab).toBe(0);
});

test('il permesso della shell si rilegge anche subito dopo un salvataggio della pagina', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  await pagina.check('#terminalEnabled');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(true);

  // La pagina salva e nello stesso istante il permesso viene spento a voce.
  await pagina.uncheck('#showHomeMessage');
  await confermaInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'modalita_terminale', valore: 'no' });
  await pagina.waitForTimeout(300);
  expect((await impostazioni(pagina)).terminal?.enabled).toBe(false);

  // Chi ha quel permesso sotto gli occhi deve vederlo spento.
  await expect.poll(
    async () => pagina.$eval('#terminalEnabled', (el) => el.checked),
    { timeout: 5000 },
  ).toBe(false);
});
