// #525 — giro 2 di verifica. Il giro 1 aveva trovato sei porte (l'intervista
// senza la domanda di apertura, l'immagine sparita, la domanda riprovata due
// volte, due turni che si mangiavano un messaggio, il manifesto che prometteva
// troppo, la Cronologia ferma): quelle le ri-prova il giro 1, che resta nel
// ramo. Qui si cercano porte NUOVE, dalle parti che il primo giro non aveva
// toccato: la scheda chiusa col suo tasto, la risposta che arriva dopo la
// chiusura, l'incognito, l'intervista rifatta, la ricerca contro il filtro dei
// comandi, e il testo di qualcun altro rimesso a schermo.

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

// Il provider finto. `triage` mappa una parola della conversazione alla
// risposta del classificatore. `lento: true` tiene ferma la RISPOSTA DI CHAT
// finché il test non la libera con `liberaRisposta`: serve a riprodurre la
// risposta che arriva quando la chat è già stata chiusa.
async function stubProvider(app, triage, { lento = false } = {}) {
  await app.evaluate(async (_e, { triage, lento }) => {
    globalThis.__filoTriage = triage;
    globalThis.__filoAttesa = null;
    if (lento) {
      globalThis.__filoAttesa = new Promise((r) => { globalThis.__filoLibera = r; });
    }
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
      if (globalThis.__filoAttesa) await globalThis.__filoAttesa;
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { triage, lento });
}

function turno(app, chatId, userMessage, extra) {
  return app.evaluate(
    (_e, { chatId, userMessage, extra }) =>
      globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId, ...(extra || {}) }),
    { chatId, userMessage, extra: extra || null },
  );
}

function chiudi(app, chatId) {
  return app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), chatId);
}

function leggiArchivio(app) {
  return app.evaluate(() => globalThis.SN_FILO_CHATS.list());
}

// Quello che Filo trova quando l'utente dice «riprendi la discussione di ieri»:
// l'azione vera, non una scorciatoia sullo store.
function cercaComeFilo(app, query) {
  return app.evaluate(
    (_e, q) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: q }),
    query,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

test('la scheda della home chiusa col suo tasto: la chat non resta senza nome', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { spinoza: { tipo: 'conversazione', titolo: 'Spinoza' } });

  const dash = await openTab(DASH);
  await dash.locator('#input').fill('Parlami di Spinoza');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 20_000 });

  // Chiudere la scheda È il modo più naturale di finire una chat: non tutti
  // tornano alla home prima di andarsene.
  const id = await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const t = (snap.tabs || snap).find((x) => String(x.url || '').includes('dashboard'));
    return t && t.id;
  });
  expect(id).toBeTruthy();
  await shell.evaluate((tabId) => window.filoShell.tabs.close(tabId), id);

  await expect.poll(async () => {
    const c = (await leggiArchivio(app))[0];
    return c ? `${c.title}|${c.kind}|${c.messages.length}` : 'niente';
  }, { timeout: 25_000 }).toBe('Spinoza|conversazione|2');

  // E in Cronologia si legge il titolo generato, non la domanda com'era
  // scritta.
  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toContainText('Spinoza');

  // …e Filo la ritrova, che è l'altra metà di ciò che il feedback chiede.
  const trovate = await cercaComeFilo(app, 'Spinoza');
  const risultati = (trovate && trovate.output && trovate.output.results) || [];
  expect(risultati.length).toBeGreaterThan(0);
});

test('la home portata su un altro indirizzo: la chat che resta indietro ha un nome', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { Hume: { tipo: 'conversazione', titolo: 'Hume' } });

  const dash = await openTab(DASH);
  await dash.locator('#input').fill('Parlami di Hume');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 20_000 });

  // Stessa scheda, un altro indirizzo: la chat di prima è finita comunque.
  await dash.evaluate(() => { window.location.href = 'filo://history/history.html'; });

  await expect.poll(async () => {
    const c = (await leggiArchivio(app))[0];
    return c ? `${c.title}|${c.kind}` : 'niente';
  }, { timeout: 25_000 }).toBe('Hume|conversazione');
});

test('la risposta che arriva dopo la chiusura: la chat resta ritrovabile da Filo', async ({ app }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { coscienza: { tipo: 'conversazione', titolo: 'La coscienza' } }, { lento: true });

  // L'utente chiede, si stufa di aspettare e chiude la chat (torna alla home,
  // o chiude la scheda) mentre Filo sta ancora scrivendo.
  const inVolo = turno(app, 'c-tardi', 'Secondo te la coscienza è emergente?');
  await expect.poll(async () => {
    const c = (await leggiArchivio(app)).find((x) => x.id === 'c-tardi');
    return c ? c.messages.length : 0;
  }, { timeout: 20_000 }).toBe(1);
  await chiudi(app, 'c-tardi');

  // …e la risposta arriva dopo.
  await app.evaluate(() => { globalThis.__filoLibera(); });
  await inVolo;
  await expect.poll(async () => {
    const c = (await leggiArchivio(app)).find((x) => x.id === 'c-tardi');
    return c ? c.messages.length : 0;
  }, { timeout: 20_000 }).toBe(2);

  // Niente si è perso: ci sono tutte e due le battute. Ma la chat deve anche
  // ESSERE UNA CHAT FINITA — il feedback chiede che Filo la ritrovi («riprendi
  // la discussione di ieri sulla coscienza»), e Filo guarda solo le chat
  // chiuse. Se resta aperta, per lui quella conversazione non esiste.
  const trovate = await cercaComeFilo(app, 'coscienza');
  const risultati = (trovate && trovate.output && trovate.output.results) || [];
  expect(risultati.map((r) => r.id)).toContain('c-tardi');
});

test('incognito: una chat fatta in incognito non resta sul disco', async ({ app }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, { segreto: { tipo: 'conversazione', titolo: 'Il segreto' } });

  const out = await app.evaluate(async () => {
    const DiskStorage = globalThis.__filoStorage;
    await DiskStorage.runIncognito(async () => {
      await globalThis.SN_HANDLE_FILO_CHAT({
        userMessage: 'Questo è il mio segreto, non scriverlo da nessuna parte',
        threadHistory: [], chatId: 'c-incognito',
      });
      await globalThis.SN_CLOSE_FILO_CHAT('c-incognito');
    });
    const dentro = await DiskStorage.runIncognito(async () => (await DiskStorage.get('filo_chats')).filo_chats);
    DiskStorage.resetIncognito();
    return {
      suDisco: (await DiskStorage.get('filo_chats')).filo_chats || [],
      dentroIncognito: (dentro || []).length,
      dopoIlReset: await DiskStorage.runIncognito(async () => ((await DiskStorage.get('filo_chats')).filo_chats || []).length),
    };
  });

  // Dentro la sessione incognito la chat c'è (serve a chi la sta facendo)…
  expect(out.dentroIncognito).toBe(1);
  // …ma sul disco non ne resta traccia, e la sessione dopo non la vede.
  expect(JSON.stringify(out.suDisco)).not.toContain('segreto');
  expect(out.dopoIlReset).toBe(0);
});

test('rifare l’intervista di benvenuto: due conversazioni distinte, non una mischiata', async ({ app }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, {});

  const ids = await app.evaluate(async () => {
    const Onb = globalThis.SN_ONBOARDING;
    const Mem = globalThis.SN_FILO_MEMORY;
    const fresca = Onb.appendTurn(
      { ...Onb.emptyState(), startedAt: '2026-01-01T10:00:00.000Z' },
      { role: 'filo', text: Onb.WELCOME_MESSAGE },
    );
    await Mem.setOnboarding(fresca);
    const primo = Onb.chatId(await Mem.getOnboarding());
    await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'Mi chiamo Ada', threadHistory: [], chatId: primo });
    await globalThis.SN_CLOSE_FILO_CHAT(primo);

    // «Rifai la presentazione», dalle Preferenze.
    const ripartita = Onb.appendTurn(
      Onb.restart(await Mem.getOnboarding(), '2026-02-02T10:00:00.000Z'),
      { role: 'filo', text: Onb.WELCOME_MESSAGE },
    );
    await Mem.setOnboarding(ripartita);
    const secondo = Onb.chatId(await Mem.getOnboarding());
    await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'Mi chiamo Bruno', threadHistory: [], chatId: secondo });
    await globalThis.SN_CLOSE_FILO_CHAT(secondo);
    return { primo, secondo };
  });

  expect(ids.primo).not.toBe(ids.secondo);
  const chats = await leggiArchivio(app);
  const uno = chats.find((c) => c.id === ids.primo);
  const due = chats.find((c) => c.id === ids.secondo);
  // Due interviste, due chat: chi rilegge la prima non ci trova dentro la
  // seconda, e tutte e due restano «conversazione».
  expect(uno.messages.map((m) => m.text).join(' ')).toContain('Ada');
  expect(uno.messages.map((m) => m.text).join(' ')).not.toContain('Bruno');
  expect(due.messages.map((m) => m.text).join(' ')).toContain('Bruno');
  expect(uno.kind).toBe('conversazione');
  expect(due.kind).toBe('conversazione');
});

test('cercare una parola detta solo in una chat di comando: la pagina non dice che non c’è niente', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, {
    zabaione: { tipo: 'comando', titolo: 'Sveglia per lo zabaione' },
    coscienza: { tipo: 'conversazione', titolo: 'La coscienza' },
  });

  await turno(app, 'c-cmd', 'Metti una sveglia per lo zabaione');
  await chiudi(app, 'c-cmd');
  await turno(app, 'c-talk', 'Secondo te la coscienza è emergente?');
  await chiudi(app, 'c-talk');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat')).toHaveCount(1);

  await page.locator('#search').fill('zabaione');
  // La parola c'è, in una chat che esiste e non è stata buttata. Dire
  // «Nessuna chat per "zabaione"» è falso: la chat c'è, è solo sotto il
  // filtro — e ritrovare una chat finita sotto il filtro per sbaglio è il
  // motivo per cui i comandi si conservano.
  await expect.poll(
    async () => (await page.locator('#chatEmpty').textContent()) || '',
    { timeout: 10_000 },
  ).not.toMatch(/Nessuna chat per/i);
});

test('il testo di qualcun altro, rimesso a schermo da una chat riaperta, resta testo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, { veleno: { tipo: 'conversazione', titolo: 'Il veleno' } });

  const veleno = '<img src=x onerror="window.__bucato=1">'
    + '[link](javascript:window.__bucato=2) <script>window.__bucato=3</script>';
  await turno(app, 'c-veleno', `Che ne pensi di questo veleno? ${veleno}`);
  await chiudi(app, 'c-veleno');

  const dash = await openTab(`${DASH}?chat=c-veleno`);
  await expect(dash.locator('.dash-bubble').first()).toContainText('veleno');
  await dash.waitForTimeout(600);
  expect(await dash.evaluate(() => window.__bucato)).toBeUndefined();
  // Né il markdown di Filo deve produrre un link che esegue codice.
  expect(await dash.locator('a[href^="javascript:"]').count()).toBe(0);
});
