// Verifica #592, giro 5 — le porte che si aprono dalla finestra sorda.
//
// Per non cancellare gli avvisi che ha appena mostrato, una pagina di
// impostazioni adesso IGNORA per un secondo e mezzo ogni annuncio di
// cambiamento, anche quello che non ha scritto lei. Ogni salvataggio automatico
// riapre quella finestra, e il salvataggio automatico parte 400 ms dopo l'ultimo
// tasto: mentre si scrive nel riquadro dello stile la pagina è sorda quasi
// sempre.
//
// Conseguenze: la pagina torna a mostrare valori che non sono più veri (era il
// difetto che il giro 3 aveva chiesto di sistemare a parte), e i due
// salvataggi dell'aspetto — i colori/le misure e il colore delle schede —
// rimandano il loro blocco INTERO senza nessun confronto, quindi una scelta
// fatta a voce viene cancellata.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const OPZIONI = 'filo://options/options.html';
const SICUREZZA = 'filo://security/security.html';

const impostazioni = (page) =>
  page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'get_settings' })).settings);

const eseguiInChat = (page, action) =>
  page.evaluate(async (a) => chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: a }), action);

async function apriPreferenze(openTab) {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window.SN_CONST && window.SN_CONST.AGENT_STYLE_MAX), { timeout: 20_000 });
  await page.waitForSelector('#tok-radius', { timeout: 20_000 });
  return page;
}

test("mentre si scrive lo stile, un colore chiesto a Filo non deve essere cancellato dal ritocco dopo", async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  await pagina.fill('#tok-radius', '11px');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).themeTokens?.radius).toBe('11px');

  // 1. l'utente sta scrivendo il suo stile nel riquadro: il salvataggio
  //    automatico parte da sé mentre scrive.
  const STILE = 'Rispondimi breve e senza giri di parole';
  await pagina.click('#agentStyleText');
  await pagina.type('#agentStyleText', STILE, { delay: 30 });
  await pagina.waitForTimeout(500);

  // Scrivere fa salvare da sé, e ogni salvataggio fa rileggere la pagina: la
  // rilettura non deve mangiare le lettere che l'utente sta ancora battendo.
  expect(await pagina.inputValue('#agentStyleText')).toBe(STILE);
  expect((await impostazioni(pagina)).agentStyle).toBe(STILE);

  // 2. nello stesso momento chiede a Filo un colore d'accento, e Filo lo
  //    applica: in memoria c'è.
  await eseguiInChat(pagina, { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#0055ff' });
  await pagina.waitForTimeout(200);
  expect((await impostazioni(pagina)).themeTokens?.accent).toBe('#0055ff');

  // 3. poi ritocca una misura dell'aspetto.
  await pagina.fill('#tok-radius', '12px');
  await pagina.waitForTimeout(2500);

  const dopo = (await impostazioni(pagina)).themeTokens || {};
  expect(dopo.radius).toBe('12px');
  expect(dopo.accent, 'il colore chiesto a voce è stato cancellato').toBe('#0055ff');
});

test("mentre si scrive lo stile, il colore delle schede chiesto a Filo non deve essere cancellato", async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await pagina.waitForSelector('#tabcol-saturazione_tab', { state: 'attached', timeout: 20_000 });

  await pagina.click('#agentStyleText');
  await pagina.type('#agentStyleText', 'Tono pacato', { delay: 30 });
  await pagina.waitForTimeout(500);

  // Filo spegne il colore delle schede, e l'utente conferma.
  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'colore_tab', valore: 'togli il colore' });
  await pagina.waitForTimeout(200);
  const chiesto = (await impostazioni(pagina)).tabColor || {};
  expect(chiesto.opacita_tab).toBe(0);

  // Poi ritocca un ALTRO parametro dello stesso gruppo.
  await pagina.fill('#tabcol-saturazione_tab', '0.55');
  await pagina.dispatchEvent('#tabcol-saturazione_tab', 'input');
  await pagina.waitForTimeout(2500);

  const dopo = (await impostazioni(pagina)).tabColor || {};
  expect(dopo.opacita_tab, 'il colore delle schede spento a voce è tornato indietro').toBe(0);
});

test('le Opzioni non devono mostrare una chiave API che non è più quella in uso', async ({ openTab }) => {
  const pagina = await openTab(OPZIONI);
  await pagina.waitForSelector('#apiKey', { state: 'attached', timeout: 25_000 });
  if (await pagina.isChecked('#useDefaultModels')) {
    await pagina.uncheck('#useDefaultModels');
    await pagina.waitForTimeout(800);
  }
  await pagina.waitForSelector('#apiKey', { timeout: 25_000 });

  await pagina.click('#apiKey');
  await pagina.type('#apiKey', 'sk-vecchia-1111');
  await pagina.locator('#apiKey').blur();
  await pagina.waitForTimeout(600);

  // Subito dopo, la chiave cambia altrove (Filo in chat, dopo una conferma).
  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'chiave_openrouter', valore: 'sk-nuova-2222' });
  await pagina.waitForTimeout(300);
  expect((await impostazioni(pagina)).apiKeys?.openrouter).toBe('sk-nuova-2222');

  // La pagina che ha quel campo sotto gli occhi deve mostrare quella in uso.
  await expect.poll(
    async () => pagina.$eval('#apiKey', (el) => el.value),
    { timeout: 4000 },
  ).toBe('sk-nuova-2222');
});

test('la pagina Sicurezza non deve mostrare accesa una protezione spenta altrove', async ({ openTab }) => {
  const pagina = await openTab(SICUREZZA);
  await pagina.waitForSelector('#sec-siteblock-blacklist', { state: 'attached', timeout: 25_000 });

  // Il rilevamento dei siti pericolosi acceso da questa pagina.
  await pagina.check('#sec-safebrowse');
  await pagina.waitForTimeout(1200);
  expect((await impostazioni(pagina)).security?.safeBrowse?.enabled).toBe(true);

  // L'utente scrive un sito nel riquadro della lista (il salvataggio parte da
  // sé) e nello stesso momento fa spegnere il rilevamento a Filo, confermando.
  await pagina.click('#sec-siteblock-blacklist');
  await pagina.type('#sec-siteblock-blacklist', 'esempio.it', { delay: 30 });
  await pagina.locator('#sec-siteblock-blacklist').blur();
  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'navigazione_sicura', valore: 'no' });
  await pagina.waitForTimeout(300);
  expect((await impostazioni(pagina)).security?.safeBrowse?.enabled).toBe(false);

  // La pagina che ha quella protezione sotto gli occhi deve dirla spenta.
  await expect.poll(
    async () => pagina.$eval('#sec-safebrowse', (el) => el.checked),
    { timeout: 4000 },
  ).toBe(false);
});
