// #525 — giro 5. I giri 3 e 4 hanno chiuso, una per volta, le porte delle
// «righe che l'utente ha letto e che nell'archivio non c'erano»: prima le
// risposte ai comandi con lo slash, poi il terminale. Tutte e due scrivono
// adesso nella chat — ma la scrivono PER NOME, chiedendo «qual è la chat di
// adesso?» nel momento in cui la riga è pronta, non in quello in cui l'utente
// l'ha provocata.
//
// Qui si prova cosa succede quando fra le due cose l'utente se ne va: un
// comando che ci mette qualche secondo, e intanto si torna alla home. La riga
// arriva dopo, e la conversazione a cui appartiene non è più «quella di
// adesso».

import { test, expect } from '../../fixtures/electron.mjs';

const DASH = 'filo://dashboard/dashboard.html';
const ARCHIVE = 'filo://archive/archive.html';

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, { extra }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...extra,
    });
  }, { extra });
}

async function stubProvider(app) {
  await app.evaluate(async () => {
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) {
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Una chiacchierata' }) };
      }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });
}

const leggiArchivio = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list());

// ─────────────────────────────────────────────────────────────────────────────

test('terminale: un comando che finisce dopo il ritorno alla home', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await configura(app, { terminal: { enabled: true } });
  await stubProvider(app);

  const dash = await openTab(DASH);
  await dash.locator('#input').fill('Parlami di Kant');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 30_000 });

  // Un comando che ci mette qualche secondo: è il motivo per cui il terminale
  // esiste (un build, un npm install, un download). La riga del comando e la
  // riga dell'esito devono essere distinguibili, quindi l'esito lo compone la
  // shell: «ESIT» + «O-TARDIVO».
  await dash.locator('#input').fill('/sleep 5; echo "ESIT""O-TARDIVO"');
  await dash.locator('#input').press('Enter');
  await dash.waitForTimeout(900);

  // L'utente se ne va prima che finisca. È il gesto più normale del mondo:
  // «parte, intanto faccio altro».
  await dash.locator('#input').fill('/home');
  await dash.locator('#input').press('Enter');
  await dash.waitForTimeout(500);
  const statoSubito = await dash.evaluate(() => document.body.dataset.state);
  console.log('STATO DOPO IL RITORNO ALLA HOME:', statoSubito);

  // Adesso il comando finisce: gli si dà tutto il tempo.
  await dash.waitForTimeout(12_000);

  const chats = await leggiArchivio(app);
  console.log('ARCHIVIO:', JSON.stringify(chats.map((c) => ({
    id: c.id.slice(0, 8),
    titolo: c.title,
    chiusa: !!c.closedAt,
    testi: (c.messages || []).map((m) => `${m.role}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 50)}`),
  })), null, 1));

  const statoDopo = await dash.evaluate(() => document.body.dataset.state);
  console.log('STATO DELLA PAGINA QUANDO IL COMANDO FINISCE:', statoDopo);

  // L'esito appartiene alla conversazione in cui il comando è stato dato.
  const conEsito = chats.find((c) => (c.messages || []).some((m) => String(m.text).includes('ESITO-TARDIVO')));
  const conComando = chats.find((c) => (c.messages || []).some((m) => String(m.text).includes('sleep 5')));
  console.log('CHAT CON IL COMANDO:', conComando && conComando.id.slice(0, 8),
    '· CHAT CON L’ESITO:', conEsito ? conEsito.id.slice(0, 8) : 'DA NESSUNA PARTE');
  expect(conEsito, 'l’esito del comando non è in nessuna chat').toBeTruthy();
  expect(conEsito && conEsito.id).toBe(conComando && conComando.id);
});

test('«/pulisci»: il resoconto arriva quando sei già tornato alla home', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await configura(app);
  await stubProvider(app);
  const dash = await openTab(DASH);
  // Il riordino delle schede è un giro che legge tutte le schede aperte e le
  // fa valutare a un modello: qualche secondo è la norma. Qui lo rallentiamo
  // dalla pagina, senza toccare il codice che stiamo provando.
  await dash.evaluate(() => {
    window.SN_CONFIRM_UI = { confirm: async () => true };
    const vero = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, cb) => {
      if (msg && msg.type === 'run_tab_triage') {
        setTimeout(() => { if (typeof cb === 'function') cb({ ok: true, archived: 2 }); }, 6000);
        return undefined;
      }
      return vero(msg, cb);
    };
  });
  await dash.locator('#input').fill('Parlami di Epicuro');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 30_000 });

  await dash.locator('#input').fill('/pulisci');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => dash.evaluate(() => document.body.innerText), { timeout: 20_000 })
    .toContain('Riordino in corso');

  // Torno alla home mentre Filo sta ancora riordinando: la conversazione di
  // Epicuro è finita.
  await dash.evaluate(() => {
    const b = document.getElementById('backHome') || document.querySelector('[data-action="home"]');
    if (b) b.click();
  });
  await dash.locator('#input').fill('/home');
  await dash.locator('#input').press('Enter');
  await dash.waitForTimeout(800);
  const statoSubito = await dash.evaluate(() => document.body.dataset.state);
  console.log('STATO SUBITO DOPO IL RITORNO ALLA HOME:', statoSubito);
  expect(statoSubito).toBe('home');

  // Adesso arriva il resoconto.
  await dash.waitForTimeout(12_000);
  const statoDopo = await dash.evaluate(() => ({
    stato: document.body.dataset.state,
    bolle: [...document.querySelectorAll('.dash-bubble')].map((b) => b.textContent.trim().slice(0, 60)),
  }));
  console.log('STATO QUANDO ARRIVA IL RESOCONTO:', JSON.stringify(statoDopo, null, 1));

  const chats = await leggiArchivio(app);
  console.log('ARCHIVIO:', JSON.stringify(chats.map((c) => ({
    id: c.id.slice(0, 8),
    titolo: c.title,
    chiusa: !!c.closedAt,
    testi: (c.messages || []).map((m) => `${m.role}: ${String(m.text).replace(/\s+/g, ' ').slice(0, 50)}`),
  })), null, 1));

  // L'utente è tornato alla home: ci deve restare.
  expect(statoDopo.stato).toBe('home');
  // E il resoconto appartiene alla conversazione in cui il comando è stato
  // dato, non a una chat nuova che l'utente non ha mai fatto.
  expect(chats.length, `chat in archivio: ${chats.length}`).toBe(1);
});

test('rinomina: input limite e tastiera', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await configura(app);
  await stubProvider(app);

  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({
    userMessage: 'Discutiamo di Leibniz e delle monadi', threadHistory: [], chatId: 'c-rinomina',
  }));
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-rinomina'));
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).title || '', { timeout: 30_000 })
    .toBe('Una chiacchierata');

  const page = await openTab(ARCHIVE);
  const riga = page.locator('.arc-chat').first();
  await expect(riga).toBeVisible({ timeout: 20_000 });

  // 1) Titolo da diecimila caratteri: si accorcia, non rompe la riga.
  await riga.click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  await page.locator('.arc-chat-rename').fill('L'.repeat(10_000));
  await page.locator('.arc-chat-rename').press('Enter');
  await page.waitForTimeout(800);
  const dopoLungo = (await leggiArchivio(app))[0];
  console.log('TITOLO DOPO 10.000 CARATTERI:', dopoLungo.title.length, JSON.stringify(dopoLungo.title.slice(0, 40)));
  expect(dopoLungo.title.length).toBeLessThan(200);

  const sborda = await page.evaluate(() => {
    const r = document.querySelector('.arc-chat');
    const t = r.querySelector('.arc-chat-title');
    const d = r.querySelector('.arc-chat-date');
    return {
      rigaLarghezza: r.getBoundingClientRect().width,
      titoloDestra: t.getBoundingClientRect().right,
      dataSinistra: d.getBoundingClientRect().left,
      sborda: t.getBoundingClientRect().right > r.getBoundingClientRect().right,
    };
  });
  console.log('LA RIGA CON UN TITOLO LUNGO:', JSON.stringify(sborda));
  expect(sborda.sborda).toBe(false);

  // 2) Un titolo di HTML: resta testo.
  await riga.click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  await page.locator('.arc-chat-rename').fill('<img src=x onerror="window.__bucato=1">ciao');
  await page.locator('.arc-chat-rename').press('Enter');
  await page.waitForTimeout(800);
  const bucato = await page.evaluate(() => !!window.__bucato);
  const titoloHtml = await page.locator('.arc-chat-title').first().textContent();
  console.log('TITOLO HTML:', JSON.stringify(titoloHtml), '· BUCATO:', bucato);
  expect(bucato).toBe(false);

  // 3) Il campo svuotato vale come rinuncia: il titolo resta.
  await riga.click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  await page.locator('.arc-chat-rename').fill('    ');
  await page.locator('.arc-chat-rename').press('Enter');
  await page.waitForTimeout(800);
  const dopoVuoto = (await leggiArchivio(app))[0];
  console.log('TITOLO DOPO IL CAMPO SVUOTATO:', JSON.stringify(dopoVuoto.title.slice(0, 40)));
  expect(dopoVuoto.title.trim().length).toBeGreaterThan(0);

  // 4) Solo tastiera: Shift+F10 apre il menu, le frecce lo percorrono, Invio
  //    sceglie. Parità piena col mouse.
  await riga.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.locator('.arc-ctxmenu')).toBeVisible({ timeout: 10_000 });
  const vociTastiera = await page.evaluate(() =>
    [...document.querySelectorAll('.arc-ctxmenu .sn-select-option')].map((o) => o.textContent.trim()));
  console.log('MENU DA TASTIERA:', JSON.stringify(vociTastiera));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  const campoDaTastiera = await page.locator('.arc-chat-rename').count();
  console.log('IL CAMPO DI RINOMINA SI APRE DA TASTIERA:', campoDaTastiera);
  expect(campoDaTastiera).toBe(1);
});

test('due Cronologia aperte: quello che si cambia di qua si vede di là', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await configura(app);
  await stubProvider(app);

  await app.evaluate(() => globalThis.SN_HANDLE_FILO_CHAT({
    userMessage: 'Discutiamo di Hume', threadHistory: [], chatId: 'c-due-pagine',
  }));
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-due-pagine'));
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).closedAt || '', { timeout: 30_000 })
    .not.toBe('');

  const uno = await openTab(ARCHIVE);
  const due = await openTab(ARCHIVE);
  await expect(uno.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });
  await expect(due.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });

  // Rinomino nella prima.
  await uno.locator('.arc-chat').first().click({ button: 'right' });
  await uno.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  await uno.locator('.arc-chat-rename').fill('Hume e la causalità');
  await uno.locator('.arc-chat-rename').press('Enter');
  await uno.waitForTimeout(1200);

  const titoloAltrove = await due.locator('.arc-chat-title').first().textContent();
  console.log('TITOLO NELLA SECONDA PAGINA:', JSON.stringify(titoloAltrove));
  expect(titoloAltrove.trim()).toBe('Hume e la causalità');

  // E sposto fra i comandi nella seconda: la prima se ne accorge.
  await due.locator('.arc-chat').first().click({ button: 'right' });
  await due.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Sposta fra i comandi' }).click();
  await due.waitForTimeout(1200);
  const statoPrimaPagina = await uno.evaluate(() => ({
    righe: [...document.querySelectorAll('.arc-chat')].length,
    interruttore: !document.getElementById('showCommandsLabel').hidden,
    testo: (document.getElementById('showCommandsText') || {}).textContent || '',
  }));
  console.log('LA PRIMA PAGINA DOPO LO SPOSTAMENTO:', JSON.stringify(statoPrimaPagina));
  expect(statoPrimaPagina.interruttore).toBe(true);
  expect(statoPrimaPagina.testo).toContain('(1)');
});
