// #525 — giro 3 di verifica, esplorazione. I giri 1 e 2 restano nel ramo e
// ri-provano le loro porte. Qui si cercano porte NUOVE: la ricerca «nei
// contenuti» che il campo invita a fare con Invio, una chat cancellata mentre
// è ancora viva in un'altra scheda, un turno fallito senza risposta, un
// messaggio da diecimila caratteri, una chat riaperta e continuata, la stessa
// chat aperta due volte, e la chat ancora in corso vista da Cronologia.

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

async function stubProvider(app, triage, { fallisci = false } = {}) {
  await app.evaluate(async (_e, { triage, fallisci }) => {
    globalThis.__filoTriage = triage;
    globalThis.__filoFallisci = fallisci;
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
      if (globalThis.__filoFallisci) { const e = new Error('rete assente'); e.code = 'NETWORK'; throw e; }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { triage, fallisci });
}

function turno(app, chatId, userMessage) {
  return app.evaluate(
    (_e, { chatId, userMessage }) =>
      globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId })
        .then((r) => ({ ok: true, r }), (e) => ({ ok: false, error: String(e && e.message || e) })),
    { chatId, userMessage },
  );
}

function chiudi(app, chatId) {
  return app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), chatId);
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

test('Cronologia: Invio nel campo di ricerca — il campo lo invita, e la chat trovata non deve essere smentita', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { zabaione: { tipo: 'conversazione', titolo: 'Il dolce' } });

  await turno(app, 'c-uno', 'Come si fa lo zabaione?');
  await chiudi(app, 'c-uno');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });

  // Il segnaposto del campo dice: «Cerca fra chat e schede… (Invio = cerca nei
  // contenuti)». L'utente scrive e preme Invio.
  await page.locator('#search').fill('zabaione');
  await page.locator('#search').press('Enter');
  await page.waitForTimeout(1500);

  const stato = await page.evaluate(() => ({
    nota: (document.getElementById('searchNote').hidden ? '' : document.getElementById('searchNote').textContent || ''),
    vuoto: (document.getElementById('empty').hidden ? '' : document.getElementById('empty').textContent || ''),
    chat: [...document.querySelectorAll('.arc-chat')].map((e) => e.textContent),
  }));
  console.log('DOPO INVIO:', JSON.stringify(stato));
  // La chat c'è: nessuna scritta in pagina deve dire il contrario.
  expect(stato.chat.length).toBeGreaterThan(0);
  expect(`${stato.nota} ${stato.vuoto}`.toLowerCase()).not.toContain('nessun risultato');
});

test('una chat cancellata da Cronologia mentre è ancora viva in un’altra scheda non deve tornare', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, {});

  const dash = await openTab(DASH);
  await dash.locator('#input').fill('Parlami del Barocco');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 20_000 });

  // La chat è in corso e si vede già in Cronologia. L'utente la cancella da lì,
  // per la sua strada vera: tasto destro, «Elimina la chat», conferma.
  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });
  const cancellata = await app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l[0].id));
  await page.locator('.arc-chat').first().click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Elimina la chat' }).click();
  await expect.poll(
    () => page.evaluate(() => window.SN_CONFIRM_UI._test.state()?.title || null),
    { timeout: 15_000 },
  ).toBe('Elimina la chat');
  await page.evaluate(() => window.SN_CONFIRM_UI._test.click('danger') || window.SN_CONFIRM_UI._test.click('ok'));
  await expect.poll(async () => (await leggiArchivio(app)).length, { timeout: 15_000 }).toBe(0);

  // …poi torna sulla scheda di prima e continua a scrivere.
  await dash.locator('#input').fill('E del Rococò?');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').nth(1)).toBeVisible({ timeout: 20_000 });

  const dopo = await leggiArchivio(app);
  console.log('DOPO:', JSON.stringify(dopo.map((c) => ({ id: c.id, n: c.messages.length, testi: c.messages.map((m) => m.text.slice(0, 30)) }))));
  // Quello che conta: la chat cancellata NON torna. Quello che si scrive dopo
  // è una conversazione nuova, con una targa sua — e senza dentro i messaggi
  // che l'utente aveva appena buttato via.
  expect(dopo.map((c) => c.id)).not.toContain(cancellata);
  expect(JSON.stringify(dopo)).not.toContain('Barocco');
  // E la scheda dice cos'è successo, invece di lasciarlo capire da sé.
  await expect(dash.locator('.dash-bubble-note', { hasText: 'cancellata dalla Cronologia' })).toBeVisible({ timeout: 15_000 });
});

test('un turno fallito senza risposta: la chat chiusa ha comunque nome e tipo', async ({ app }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { colonscopia: { tipo: 'conversazione', titolo: 'Domanda medica' } }, { fallisci: true });

  const esito = await turno(app, 'c-rotto', 'Mi spieghi cos’è una colonscopia?');
  console.log('TURNO:', JSON.stringify(esito).slice(0, 200));

  // Il modello della CHAT è giù, ma quello del classificatore — che è un altro
  // modello, e potrebbe funzionare — no: rimettiamolo in piedi come farebbe la
  // rete tornata.
  await stubProvider(app, { colonscopia: { tipo: 'conversazione', titolo: 'Domanda medica' } });
  await chiudi(app, 'c-rotto');

  await expect.poll(async () => {
    const c = (await leggiArchivio(app)).find((x) => x.id === 'c-rotto');
    return c ? `${c.title}|${c.kind}|${c.messages.length}` : 'niente';
  }, { timeout: 25_000 }).toBe('Domanda medica|conversazione|1');

  const trovate = await cercaComeFilo(app, 'colonscopia');
  expect(((trovate && trovate.output && trovate.output.results) || []).map((r) => r.id)).toContain('c-rotto');
});

test('un messaggio da diecimila caratteri: titolo corto, testo intero, ricercabile fino in fondo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, {});

  const lungo = `${'molto lunga discussione '.repeat(430)}PAROLAFINALE`;
  expect(lungo.length).toBeGreaterThan(10_000);
  await turno(app, 'c-lungo', lungo);
  await chiudi(app, 'c-lungo');

  await expect.poll(async () => {
    const c = (await leggiArchivio(app)).find((x) => x.id === 'c-lungo');
    return c && c.title ? 'pronta' : 'aspetto';
  }, { timeout: 25_000 }).toBe('pronta');

  const c = (await leggiArchivio(app)).find((x) => x.id === 'c-lungo');
  console.log('TITOLO:', JSON.stringify(c.title), 'LUNGHEZZA MESSAGGIO:', c.messages[0].text.length);
  expect([...c.title].length).toBeLessThanOrEqual(81);
  expect(c.messages[0].text.length).toBe(lungo.length);   // niente taglio muto

  // La parola in fondo si trova: la ricerca guarda tutto il testo.
  const trovate = await cercaComeFilo(app, 'PAROLAFINALE');
  expect(((trovate && trovate.output && trovate.output.results) || []).map((r) => r.id)).toContain('c-lungo');

  // …e la pagina non esplode né scrive una riga chilometrica.
  const page = await openTab(ARCHIVE);
  const riga = page.locator('.arc-chat').first();
  await expect(riga).toBeVisible({ timeout: 20_000 });
  const box = await riga.boundingBox();
  console.log('ALTEZZA RIGA:', box && box.height);
  expect(box.height).toBeLessThan(80);
});

test('riaprire una chat, continuarla e chiuderla: titolo e tipo si rifanno sulla conversazione intera', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, {
    Kant: { tipo: 'conversazione', titolo: 'Kant' },
    sveglia: { tipo: 'comando', titolo: 'Sveglia alle 7' },
  });

  // Prima una chat che è solo un comando…
  await turno(app, 'c-ripresa', 'Metti una sveglia alle 7');
  await chiudi(app, 'c-ripresa');
  await expect.poll(async () => {
    const c = (await leggiArchivio(app)).find((x) => x.id === 'c-ripresa');
    return c ? `${c.title}|${c.kind}` : 'niente';
  }, { timeout: 25_000 }).toBe('Sveglia alle 7|comando');

  // …la si riapre da Cronologia e ci si mette a discutere davvero.
  const dash = await openTab(`${DASH}?chat=c-ripresa`);
  await expect(dash.locator('.dash-bubble').first()).toBeVisible({ timeout: 20_000 });
  await dash.locator('#input').fill('A proposito, cosa pensi di Kant?');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').last()).toBeVisible({ timeout: 20_000 });

  // Chiusa di nuovo, non può restare «comando» nascosta sotto l'interruttore.
  await dash.evaluate(() => { window.location.href = 'filo://history/history.html'; });

  await expect.poll(async () => {
    const c = (await leggiArchivio(app)).find((x) => x.id === 'c-ripresa');
    return c ? `${c.kind}|${c.messages.length}` : 'niente';
  }, { timeout: 25_000 }).toBe('conversazione|4');
});

test('la stessa chat aperta due volte: due schede sulla stessa conversazione', async ({ app, openTab, shell }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { Cartesio: { tipo: 'conversazione', titolo: 'Cartesio' } });

  await turno(app, 'c-doppia', 'Parlami di Cartesio');
  await chiudi(app, 'c-doppia');
  await expect.poll(async () => {
    const c = (await leggiArchivio(app)).find((x) => x.id === 'c-doppia');
    return c && c.title ? 'pronta' : 'aspetto';
  }, { timeout: 25_000 }).toBe('pronta');

  const page = await openTab(ARCHIVE);
  const riga = page.locator('.arc-chat').first();
  await expect(riga).toBeVisible({ timeout: 20_000 });
  await riga.click();
  await page.waitForTimeout(800);
  await riga.click();
  await page.waitForTimeout(1500);

  const schede = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return (snap.tabs || snap).map((t) => String(t.url || ''));
  });
  const suQuestaChat = schede.filter((u) => u.includes('chat=c-doppia'));
  console.log('SCHEDE SULLA STESSA CHAT:', suQuestaChat.length, JSON.stringify(schede));
  expect(suQuestaChat.length).toBe(1);
});
