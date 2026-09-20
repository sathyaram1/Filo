// #525 — giro 3, seconda tornata: la chiusura dell'app (che il feedback
// nomina fra i modi di finire una chat), i comandi con lo slash che compaiono
// nella stessa conversazione, e la chat ancora in corso vista da Cronologia.

import { test, expect } from '../../fixtures/electron.mjs';

const ARCHIVE = 'filo://archive/archive.html';
const DASH = 'filo://dashboard/dashboard.html';

async function configura(app) {
  await app.evaluate(async () => {
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
    });
  });
}

async function stubProvider(app, triage) {
  await app.evaluate(async (_e, { triage }) => {
    globalThis.__filoTriage = triage;
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) {
        for (const [ago, risposta] of Object.entries(globalThis.__filoTriage || {})) {
          if (joined.includes(ago)) return { ...base, text: JSON.stringify(risposta) };
        }
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Senza etichetta' }) };
      }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { triage });
}

function turno(app, chatId, userMessage) {
  return app.evaluate(
    (_e, { chatId, userMessage }) =>
      globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId }),
    { chatId, userMessage },
  );
}

function leggiArchivio(app) {
  return app.evaluate(() => globalThis.SN_FILO_CHATS.list());
}

function cercaComeFilo(app, query) {
  return app.evaluate(
    (_e, q) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: q }),
    query,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

test('Filo chiuso di colpo: alla partenza dopo la chat appesa prende nome e tipo', async ({ app }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { Leopardi: { tipo: 'conversazione', titolo: 'Leopardi' } });

  // Una chat in corso: nessuno l'ha chiusa (l'app è morta con la chat aperta).
  await turno(app, 'c-appesa', 'Parlami di Leopardi');
  const prima = (await leggiArchivio(app)).find((c) => c.id === 'c-appesa');
  expect(prima.closedAt).toBeFalsy();

  // La partenza successiva la raccoglie.
  await app.evaluate(() => globalThis.SN_SWEEP_FILO_CHATS());

  await expect.poll(async () => {
    const c = (await leggiArchivio(app)).find((x) => x.id === 'c-appesa');
    return c ? `${c.title}|${c.kind}` : 'niente';
  }, { timeout: 25_000 }).toBe('Leopardi|conversazione');

  const trovate = await cercaComeFilo(app, 'Leopardi');
  expect(((trovate && trovate.output && trovate.output.results) || []).map((r) => r.id)).toContain('c-appesa');
});

test('un comando con lo slash detto nella stessa chat si ritrova rileggendola', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { Manzoni: { tipo: 'conversazione', titolo: 'Manzoni' } });

  const dash = await openTab(DASH);
  await dash.locator('#input').fill('Parlami di Manzoni');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 20_000 });

  // In mezzo alla discussione l'utente chiede l'elenco dei comandi: Filo
  // risponde a schermo, dentro la stessa conversazione.
  await dash.locator('#input').fill('/help');
  await dash.locator('#input').press('Enter');
  await dash.waitForTimeout(1000);
  const aSchermo = await dash.evaluate(() => [...document.querySelectorAll('.dash-bubble')].map((b) => b.textContent));
  console.log('A SCHERMO:', JSON.stringify(aSchermo.map((t) => t.slice(0, 50))));
  // Filo ha risposto a schermo, dentro questa conversazione.
  expect(aSchermo.some((t) => t.includes('lista comandi'))).toBeTruthy();

  await dash.locator('#input').fill('E dei Promessi Sposi?');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').nth(1)).toBeVisible({ timeout: 20_000 });

  // Si torna alla home: la chat è finita e si rilegge da Cronologia.
  await dash.evaluate(() => { window.location.href = 'filo://history/history.html'; });
  await expect.poll(async () => {
    const c = (await leggiArchivio(app))[0];
    return c && c.closedAt ? 'chiusa' : 'aperta';
  }, { timeout: 25_000 }).toBe('chiusa');

  const c = (await leggiArchivio(app))[0];
  const testi = c.messages.map((m) => `${m.role}: ${m.text}`);
  console.log('IN ARCHIVIO:', JSON.stringify(testi.map((t) => t.slice(0, 60)), null, 1));
  // Quello che l'utente ha letto a schermo dev'esserci: una riga che c'era e
  // che rileggendo non c'è più è una riga persa.
  expect(testi.join('\n')).toContain('lista comandi');
});

test('la chat ancora in corso, vista da Cronologia', async ({ app, openTab, shell }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, {});

  const dash = await openTab(DASH);
  await dash.locator('#input').fill('Discutiamo di Epicuro');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 20_000 });

  const page = await openTab(ARCHIVE);
  const righe = page.locator('.arc-chat');
  await expect(righe.first()).toBeVisible({ timeout: 20_000 });
  const testo = await righe.first().textContent();
  console.log('RIGA DELLA CHAT IN CORSO:', JSON.stringify(testo));
  // Si vede per quello che è: non una chat finita con una data, ma una
  // conversazione aperta adesso.
  expect(testo).toContain('In corso');

  const prima = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return (snap.tabs || snap).map((t) => String(t.url || ''));
  });

  // Cliccandola NON si apre una seconda vista della stessa conversazione viva:
  // si torna dov'è aperta.
  await righe.first().click();
  await page.waitForTimeout(1500);
  const dopo = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const lista = snap.tabs || snap;
    return {
      urls: lista.map((t) => String(t.url || '')),
      attiva: String((lista.find((t) => t.id === snap.activeId) || {}).url || ''),
    };
  });
  console.log('SCHEDE PRIMA:', JSON.stringify(prima), 'DOPO:', JSON.stringify(dopo));
  expect(dopo.urls).toEqual(prima);                       // nessuna scheda in più
  expect(dopo.attiva).toContain('dashboard');             // e siamo dove la chat è aperta
});

test('senza nemmeno una chat di comando, l’interruttore dei comandi non si mostra', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { Epicuro: { tipo: 'conversazione', titolo: 'Epicuro' } });

  await turno(app, 'c-sola-conv', 'Discutiamo di Epicuro');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-sola-conv'));
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).kind || '', { timeout: 25_000 }).toBe('conversazione');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });
  const visibile = await page.evaluate(() => {
    const el = document.getElementById('showCommandsLabel');
    return { attributo: el.hasAttribute('hidden'), aSchermo: el.getBoundingClientRect().height > 0, testo: el.textContent.trim() };
  });
  console.log('INTERRUTTORE COMANDI:', JSON.stringify(visibile));
  // La pagina lo vuole nascosto (mette l'attributo): deve esserlo davvero.
  expect(visibile.aSchermo).toBe(false);
});

test('una chat senza titolo generato non scrive due volte la stessa frase', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  // Nessun classificatore: la chat prende il primo messaggio come titolo. È il
  // caso di chi non ha (ancora) un modello per il titolo — e di ogni chat
  // mentre è ancora in corso.
  await app.evaluate(async () => {
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      if (joined.includes('Classifichi le conversazioni')) throw new Error('niente modello');
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: JSON.stringify({ text: 'Va bene.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  });

  await turno(app, 'c-senza-titolo', 'Discutiamo di Epicuro e del piacere');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-senza-titolo'));
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).title || '', { timeout: 25_000 }).not.toBe('');

  const page = await openTab(ARCHIVE);
  const riga = page.locator('.arc-chat').first();
  await expect(riga).toBeVisible({ timeout: 20_000 });
  const parti = await riga.evaluate((el) => ({
    titolo: el.querySelector('.arc-chat-title').textContent,
    estratto: el.querySelector('.arc-chat-excerpt').textContent,
  }));
  console.log('RIGA:', JSON.stringify(parti));
  // La riga non deve dire due volte la stessa cosa, una accanto all'altra.
  expect(parti.estratto).not.toBe(parti.titolo);
});

test('Cronologia con chat e senza schede chiuse: «Svuota archivio» dice cosa fa', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, {});

  await turno(app, 'c-sola', 'Una chat e nessuna scheda chiusa');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-sola'));
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).title || '', { timeout: 25_000 }).not.toBe('');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'tests/.shots/525-giro3-cronologia-chiaro.png', fullPage: true });

  // Il bottone c'è, in cima a una pagina piena di chat. Premuto, deve fare
  // qualcosa o dire perché no: non restare muto.
  await page.locator('#clear').click();
  await page.waitForTimeout(1200);
  const stato = await page.evaluate(() => ({
    popup: !!document.querySelector('.sn-confirm, .sn-modal, dialog[open]'),
    nota: document.getElementById('searchNote').hidden ? '' : document.getElementById('searchNote').textContent,
  }));
  console.log('SVUOTA ARCHIVIO SENZA SCHEDE:', JSON.stringify(stato));
  expect(stato.popup || stato.nota).toBeTruthy();
});
