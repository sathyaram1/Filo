// Verifica #592, giro 4 — i gruppi che il giro 3 aveva nominato senza provare,
// e il prezzo della rilettura nuova.
//
// Il giro 3 ha chiuso cinque porte (modalità terminale + shell, le due chiavi
// API, la voce, il rilevamento siti pericolosi, i cookie): la pagina manda al
// salvataggio solo le manopole che l'utente ha toccato davvero, e si rilegge
// quando qualcosa cambia altrove. Nella stessa critica c'era un elenco di
// gruppi con la STESSA forma, non provati: «i colori delle schede e i colori,
// i font e le misure dell'aspetto nelle Preferenze, che la pagina rimanda
// interi a ogni ritocco senza nessun confronto; l'archiviazione automatica; le
// notifiche; i modelli per funzione nelle Opzioni».
//
// Qui si provano quelli (tengono), e si guarda cosa la rilettura porta via: il
// testo che l'utente sta ancora sistemando e che per contratto NON è stato
// salvato — lo stile oltre il tetto, una misura scritta male che aspetta la
// correzione. Quello sparisce dallo schermo al primo tocco su un altro campo.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const OPZIONI = 'filo://options/options.html';

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

// ── l'aspetto: i colori, i font e le misure ────────────────────────────────

test('un colore chiesto a Filo non deve tornare indietro quando si tocca un ALTRO valore dell\'aspetto', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  // 1. l'utente mette a mano il raggio degli angoli.
  await pagina.fill('#tok-radius', '11px');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).themeTokens?.radius).toBe('11px');

  // 2. poi chiede a Filo un colore d'accento. Filo lo applica subito e la
  //    pagina resta aperta com'era.
  await eseguiInChat(pagina, { type: 'IMPOSTA_ESTETICA', token: 'accent', valore: '#0055ff' });
  await pagina.waitForTimeout(2000);
  expect((await impostazioni(pagina)).themeTokens?.accent).toBe('#0055ff');

  // 3. torna sulla pagina e ritocca il raggio. Non ha chiesto di disfare
  //    niente: il colore che ha chiesto a voce deve restare.
  await pagina.fill('#tok-radius', '12px');
  await pagina.waitForTimeout(2000);

  const dopo = (await impostazioni(pagina)).themeTokens || {};
  expect(dopo.radius).toBe('12px');
  expect(dopo.accent).toBe('#0055ff');
});

test('un colore delle schede chiesto a Filo non deve tornare indietro quando si tocca un altro parametro', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);
  await pagina.waitForSelector('#tabcol-saturazione_tab', { timeout: 20_000 });

  await pagina.fill('#tabcol-saturazione_tab', '0.7');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).tabColor?.saturazione_tab).toBeCloseTo(0.7, 5);

  // «colore delle tab: nessuno» mette l'opacità a 0.
  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'colore_tab', valore: 'nessuno' });
  await pagina.waitForTimeout(2000);
  expect((await impostazioni(pagina)).tabColor?.opacita_tab).toBe(0);

  await pagina.fill('#tabcol-saturazione_tab', '0.8');
  await pagina.waitForTimeout(2000);

  const dopo = (await impostazioni(pagina)).tabColor || {};
  expect(dopo.saturazione_tab).toBeCloseTo(0.8, 5);
  expect(dopo.opacita_tab).toBe(0);
});

// ── l'archiviazione automatica e i modelli ─────────────────────────────────

test('le ore di inattività toccate non devono riaccendere l\'archiviazione spenta altrove', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  await pagina.check('#autoArchiveEnabled');
  await pagina.waitForTimeout(1500);
  expect((await impostazioni(pagina)).autoArchive?.enabled).toBe(true);

  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'archiviazione_automatica', valore: 'no' });
  await pagina.waitForTimeout(2000);
  expect((await impostazioni(pagina)).autoArchive?.enabled).toBe(false);

  await pagina.fill('#autoArchiveIdleHours', '9');
  await pagina.locator('#autoArchiveIdleHours').blur();
  await pagina.waitForTimeout(2000);

  const dopo = (await impostazioni(pagina)).autoArchive || {};
  expect(Number(dopo.idleHours)).toBe(9);
  expect(dopo.enabled).toBe(false);
});

test('il limite di spesa toccato non deve rimettere i modelli predefiniti spenti altrove', async ({ openTab }) => {
  const opzioni = await openTab(OPZIONI);
  await opzioni.waitForSelector('#useDefaultModels', { timeout: 20_000 });

  await opzioni.check('#useDefaultModels');
  await opzioni.waitForTimeout(1500);
  expect((await impostazioni(opzioni)).useDefaultModels).toBe(true);

  await eseguiInChat(opzioni, { type: 'IMPOSTA_PREFERENZA', chiave: 'modelli_predefiniti', valore: 'no' });
  await opzioni.waitForTimeout(2000);
  expect((await impostazioni(opzioni)).useDefaultModels).toBe(false);

  await opzioni.fill('#monthlyLimit', '7');
  await opzioni.locator('#monthlyLimit').blur();
  await opzioni.waitForTimeout(2000);

  const dopo = await impostazioni(opzioni);
  expect(Number(dopo.monthlyLimitEur)).toBe(7);
  expect(dopo.useDefaultModels).toBe(false);
});

// ── quello che l'utente sta ancora sistemando ──────────────────────────────
//
// Il tetto dello stile promette un rifiuto spiegato e nessun taglio: è
// l'utente che accorcia e sceglie cosa tenere. Perché possa farlo, il testo
// deve restare dov'è finché non lo tocca lui.

test('lo stile oltre il tetto deve restare nel riquadro: è l\'utente che lo accorcia', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  const lungo = 'Parla come un capitano di mare. '.repeat(30); // 960 caratteri
  await pagina.fill('#agentStyleText', lungo);
  await pagina.waitForTimeout(2500);

  // Il rifiuto è spiegato, in memoria non entra niente: giusto.
  await expect(pagina.locator('#agentStyleError')).toBeVisible();
  expect((await impostazioni(pagina)).agentStyle || '').toBe('');
  expect(await pagina.inputValue('#agentStyleText')).toBe(lungo);

  // Adesso l'utente scende nell'aspetto e ritocca una misura, come farebbe
  // chiunque stia sistemando le preferenze. Quel ritocco non c'entra niente
  // con lo stile che deve ancora accorciare.
  await pagina.fill('#tok-radius', '10px');
  await pagina.waitForTimeout(2500);

  expect(await pagina.inputValue('#agentStyleText')).toBe(lungo);
  await expect(pagina.locator('#agentStyleError')).toBeVisible();
});

test('lo stile oltre il tetto deve restare nel riquadro anche se Filo cambia un\'altra impostazione', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  const lungo = 'Rispondi come un notaio del Settecento. '.repeat(20);
  await pagina.fill('#agentStyleText', lungo);
  await pagina.waitForTimeout(2500);
  expect(await pagina.inputValue('#agentStyleText')).toBe(lungo);

  // L'utente va a chiedere a Filo di spegnere l'archiviazione automatica, e
  // torna sulle Preferenze per accorciare lo stile.
  await pagina.evaluate(() => document.getElementById('agentStyleText').blur());
  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'archiviazione_automatica', valore: 'no' });
  await pagina.waitForTimeout(2500);

  expect(await pagina.inputValue('#agentStyleText')).toBe(lungo);
  await expect(pagina.locator('#agentStyleError')).toBeVisible();
});

test('una misura scritta male resta sullo schermo per essere corretta', async ({ openTab }) => {
  const pagina = await apriPreferenze(openTab);

  // Si scrive una misura senza unità: non è valida, la pagina lo dice e TIENE
  // il testo «così l'utente può correggerlo».
  await pagina.fill('#tok-radius', '14');
  await pagina.locator('#tok-radius').blur();
  await pagina.waitForTimeout(1200);
  expect(await pagina.inputValue('#tok-radius')).toBe('14');

  // Mentre ci pensa, chiede a Filo di spegnere l'archiviazione automatica.
  await eseguiInChat(pagina, { type: 'IMPOSTA_PREFERENZA', chiave: 'archiviazione_automatica', valore: 'no' });
  await pagina.waitForTimeout(2500);

  // Il testo da correggere deve essere ancora lì.
  expect(await pagina.inputValue('#tok-radius')).toBe('14');
});

test('una riga di modello appena cominciata non deve sparire dalle Opzioni', async ({ openTab }) => {
  const opzioni = await openTab(OPZIONI);
  await opzioni.waitForSelector('#addModelRow', { timeout: 20_000 });
  // Il registro si vede solo con i modelli predefiniti spenti.
  await opzioni.uncheck('#useDefaultModels');
  await opzioni.waitForTimeout(1500);

  const quante = await opzioni.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').count();
  await opzioni.click('#addModelRow');
  const riga = opzioni.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').nth(quante);
  await riga.locator('.sn-model-id').fill('un/modello-nuovo');
  await opzioni.waitForTimeout(1200);

  // Mentre pensa al soprannome da dargli, chiede a Filo di spegnere il blocco
  // dei popup. La riga che sta compilando non c'entra niente.
  await eseguiInChat(opzioni, { type: 'IMPOSTA_PREFERENZA', chiave: 'blocco_popup', valore: 'no' });
  await opzioni.waitForTimeout(2500);

  expect(await opzioni.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').count())
    .toBe(quante + 1);
  expect(await riga.locator('.sn-model-id').inputValue()).toBe('un/modello-nuovo');
});

test('i siti scritti male nella blacklist restano sullo schermo per essere corretti', async ({ openTab }) => {
  const sicurezza = await openTab('filo://security/security.html');
  await sicurezza.waitForSelector('#sec-siteblock-blacklist', { timeout: 20_000 });

  const scritto = 'esempio.test\nnon un dominio!!\naltro.test';
  await sicurezza.fill('#sec-siteblock-blacklist', scritto);
  await sicurezza.locator('#sec-siteblock-blacklist').blur();
  await sicurezza.waitForTimeout(1500);
  // La riga sbagliata viene scartata dal salvataggio ma resta scritta, con
  // l'avviso che dice quale: è così che l'utente la corregge.
  expect(await sicurezza.inputValue('#sec-siteblock-blacklist')).toContain('non un dominio!!');

  await eseguiInChat(sicurezza, { type: 'IMPOSTA_PREFERENZA', chiave: 'protezione_ip', valore: 'no' });
  await sicurezza.waitForTimeout(2500);

  expect(await sicurezza.inputValue('#sec-siteblock-blacklist')).toContain('non un dominio!!');
});

// ── il canale delle pagine web ─────────────────────────────────────────────
//
// Lo stile dell'agente adesso non passa più da una pagina web. Ma la guardia
// su quel canale è un elenco di DUE nomi vietati, non un elenco di quello che
// è lecito: tutto il resto passa ancora, compresa la modalità terminale, che è
// il permesso che dà a Filo la shell della macchina.

test('dal canale delle pagine web non deve passare la modalità terminale né le difese', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/newtab.html');
  const prima = await impostazioni(page);
  expect(prima.terminal?.enabled).toBe(false);
  expect(prima.security?.safeBrowse?.enabled).toBe(true);

  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    {
      type: 'update_settings',
      settings: {
        terminal: { enabled: true, shell: 'bash' },
        monthlyLimitEur: 9999,
        models: { filo_chat: 'attaccante/modello' },
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
  expect(Number(dopo.monthlyLimitEur)).toBe(5);
  expect(dopo.models?.filo_chat).not.toBe('attaccante/modello');

  // Controprova: dalla pagina interna la stessa scrittura passa, quindi il
  // test sopra non è verde per un motivo qualsiasi.
  await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: 'update_settings', settings: { terminal: { enabled: true } } },
    { url: 'filo://preferences/preferences.html' },
  ));
  expect((await impostazioni(page)).terminal?.enabled).toBe(true);
});

// ── il segnaposto dello stile dentro una memoria ───────────────────────────

test('il segnaposto dello stile non deve sopravvivere dentro una memoria', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const profilo = `Va in bici. ${C.AGENT_STYLE_SLOT} Beve tè.`;
    // Il messaggio di sistema della chat è tutto uno: parte immutabile (dove
    // sta il segnaposto) più contesto (dove stanno le memorie).
    const sistema = C.PROMPTS.filoChat({
      profilo, preferenze: '', lezioni: '', stato: '', history: '', files: '', modelName: 'x',
    });
    const msgs = C.injectAgentStyle([{ role: 'system', content: sistema }], C.ACTIONS.FILO_CHAT, 'Tono asciutto.');
    const testo = msgs[0].content;
    return { recinti: testo.split(C.AGENT_STYLE_OPEN).length - 1 };
  });
  // Il recinto dello stile deve comparire UNA volta sola, nel suo posto.
  expect(r.recinti).toBe(1);
});
