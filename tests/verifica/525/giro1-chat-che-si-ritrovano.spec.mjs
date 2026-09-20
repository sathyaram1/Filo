// #525 — giro 1 di verifica: le chat con Filo si salvano, si ritrovano, si
// riaprono. Qui si prova a ROMPERLE dal punto di vista di chi le usa.
//
// Le prove del ramo passano dai comandi del main; queste partono dalla pagina
// vera dove possono (la home, la Cronologia), perché è lì che l'utente vive.

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
    const rispondi = ({ attempts, messages }) => {
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
    globalThis.SN_PROVIDERS.completeWithFallback = async (o) => rispondi(o);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => rispondi(o);
  }, { triage });
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

// ─────────────────────────────────────────────────────────────────────────────

test('il cammino vero: si scrive nella home, si torna alla home, la chat è in Cronologia', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, { coscienza: { tipo: 'conversazione', titolo: 'La coscienza' } });

  const dash = await openTab(DASH);
  await dash.locator('#input').fill('Secondo te la coscienza è emergente?');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 20_000 });

  // «/home» è il ritorno alla home: è il gesto che finisce la chat.
  await dash.locator('#input').fill('/home');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 10_000 });

  await expect.poll(async () => {
    const c = (await leggiArchivio(app))[0];
    return c ? `${c.title}|${c.kind}|${c.messages.length}` : 'niente';
  }, { timeout: 20_000 }).toBe('La coscienza|conversazione|2');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  await expect(page.locator('.arc-chat').first()).toContainText('La coscienza');
});

test('un’immagine incollata in chat: la chat riaperta dice che c’era', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, { grafico: { tipo: 'conversazione', titolo: 'Il grafico' } });

  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await turno(app, 'c-immagine', 'Cosa vedi in questo grafico?', { images: [png] });
  await chiudi(app, 'c-immagine');

  const salvate = await leggiArchivio(app);
  const chat = salvate.find((c) => c.id === 'c-immagine');
  expect(chat.messages[0].images).toBe(1);

  // Riaperta: il testo torna. E deve tornare anche il SEGNO che lì c'era
  // un'immagine — senza, rileggendo si legge «cosa vedi in questo grafico?»
  // riferito al nulla, e non si capisce più di cosa si parlasse.
  const dash = await openTab(`${DASH}?chat=c-immagine`);
  await expect(dash.locator('.dash-bubble').first()).toContainText('Cosa vedi in questo grafico?');
  await expect(dash.locator('.dash-thread')).toContainText(/immagin/i);
});

test('l’intervista di benvenuto si rilegge per intero: c’è anche la domanda di apertura', async ({ app, shell }) => {
  test.setTimeout(120_000);
  // Niente `configura`: su un profilo nuovo l'intervista è APERTA, ed è la
  // prima conversazione — quella che il feedback nomina come da rileggere.
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const reply = () => JSON.stringify({ text: 'Piacere! E di cosa ti occupi?', actions: [] });
    P.streamCompleteWithFallback = async ({ attempts }) => ({ text: reply(), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    P.completeWithFallback = async ({ attempts }) => ({ text: reply(), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });

  const deadline = Date.now() + 15_000;
  let page = null;
  while (Date.now() < deadline && !page) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error('nuova scheda non trovata');
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });

  // La domanda di apertura è a schermo: è il primo messaggio dell'intervista.
  const benvenuto = await app.evaluate(() => globalThis.SN_ONBOARDING.WELCOME_MESSAGE);
  const primaFrase = String(benvenuto).split('\n').find((r) => r.trim()).trim().slice(0, 40);

  await page.locator('#input').fill('Mi chiamo Ada');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere!' }).first()).toBeVisible({ timeout: 25_000 });

  await expect.poll(async () => (await leggiArchivio(app)).length, { timeout: 20_000 }).toBe(1);
  const chat = (await leggiArchivio(app))[0];
  const testoSalvato = chat.messages.map((m) => m.text).join('\n');
  // Quello che l'utente vede a schermo deve essere quello che ritrova: la
  // domanda di apertura di Filo fa parte dell'intervista.
  expect(testoSalvato).toContain(primaFrase);
});

test('tastiera: una chat si riapre con Invio e il menu si apre con Shift+F10', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, { coscienza: { tipo: 'conversazione', titolo: 'La coscienza' } });
  await turno(app, 'c-tastiera', 'Secondo te la coscienza è emergente?');
  await chiudi(app, 'c-tastiera');

  const page = await openTab(ARCHIVE);
  const riga = page.locator('.arc-chat').first();
  await expect(riga).toBeVisible();

  // Shift+F10 = il menu del tasto destro, per chi non usa il mouse.
  await riga.focus();
  await riga.press('Shift+F10');
  await expect(page.locator('.arc-ctxmenu')).toBeVisible();
  await expect(page.locator('.arc-ctxmenu')).toContainText('Elimina la chat');
  await page.keyboard.press('Escape');
  await expect(page.locator('.arc-ctxmenu')).toHaveCount(0);

  // Invio = riapertura, come il clic.
  await riga.focus();
  await riga.press('Enter');
  const dash = await (async () => {
    const scadenza = Date.now() + 15_000;
    while (Date.now() < scadenza) {
      const w = app.windows().find((x) => x.url().includes('chat=c-tastiera'));
      if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('la chat non si è riaperta con Invio');
  })();
  await expect(dash.locator('.dash-bubble').first()).toContainText('coscienza');
});

test('due chat che vanno avanti insieme non si cancellano a vicenda', async ({ app }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, {});
  // Due schede di Filo aperte, due turni che partono insieme: l'archivio è
  // una lista sola riscritta per intero a ogni messaggio.
  await app.evaluate(async () => {
    const T = (id, testo) => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: testo, threadHistory: [], chatId: id });
    await Promise.all([
      T('c-par-1', 'Primo discorso'),
      T('c-par-2', 'Secondo discorso'),
      T('c-par-3', 'Terzo discorso'),
    ]);
  });
  const chats = await leggiArchivio(app);
  const ids = chats.map((c) => c.id).sort();
  expect(ids).toEqual(['c-par-1', 'c-par-2', 'c-par-3']);
  for (const c of chats) expect(c.messages.length).toBe(2);
});

test('la ricerca regge caratteri speciali, emoji e una query lunghissima', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, { strana: { tipo: 'conversazione', titolo: 'Roba strana' } });
  await turno(app, 'c-strana', 'Discussione strana con <script>alert(1)</script> e 🙂 e "virgolette" (parentesi) [quadre] *asterischi*');
  await chiudi(app, 'c-strana');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat')).toHaveCount(1);

  const cerca = page.locator('#search');
  // Caratteri che in una regex significherebbero altro.
  await cerca.fill('(parentesi)');
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  await cerca.fill('*asterischi*');
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  await cerca.fill('🙂');
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  // Il testo iniettato resta TESTO, non diventa uno script eseguito.
  await cerca.fill('<script>');
  await expect(page.locator('.arc-chat')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelectorAll('.arc-chat script').length)).toBe(0);

  // Query enorme: niente risultati, ma nessun crollo e un messaggio sensato.
  await cerca.fill('x'.repeat(10_000));
  await expect(page.locator('#chatEmpty')).toBeVisible();
  await expect(page.locator('.arc-chat')).toHaveCount(0);

  // Svuotare la ricerca rimette tutto com'era.
  await cerca.fill('');
  await expect(page.locator('.arc-chat')).toHaveCount(1);
});

test('tema scuro: la sezione delle chat si legge', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, {
    coscienza: { tipo: 'conversazione', titolo: 'La coscienza è emergente?' },
    sveglia: { tipo: 'comando', titolo: 'Sveglia alle sette' },
  });
  await turno(app, 'c-scuro-1', 'Secondo te la coscienza è emergente?');
  await turno(app, 'c-scuro-2', 'Metti una sveglia alle 7');
  await chiudi(app, 'c-scuro-1');
  await chiudi(app, 'c-scuro-2');
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });

  const page = await openTab(ARCHIVE);
  await page.locator('#showCommands').check();
  await expect(page.locator('.arc-chat')).toHaveCount(2);
  await page.screenshot({ path: 'tests/.shots/525-cronologia-chat-scuro.png' });

  // Il titolo di una chat «comando» resta leggibile: attenuato non vuol dire
  // invisibile sul fondo scuro.
  const contrasto = await page.evaluate(() => {
    const leggi = (s) => (s.match(/\d+(\.\d+)?/g) || []).map(Number);
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const riga = document.querySelector('.arc-chat[data-kind="comando"] .arc-chat-title');
    const fg = leggi(getComputedStyle(riga).color);
    let el = riga, bg = null;
    while (el && !bg) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) bg = leggi(c);
      el = el.parentElement;
    }
    if (!bg) bg = [255, 255, 255];
    const a = lum(fg.slice(0, 3)), b = lum(bg.slice(0, 3));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrasto).toBeGreaterThan(3);
});

test('cancellare una chat non la fa tornare indietro da un’altra scheda', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await configura(app);
  await stubProvider(app, { coscienza: { tipo: 'conversazione', titolo: 'La coscienza' } });
  await turno(app, 'c-cancellata', 'Secondo te la coscienza è emergente?');
  await chiudi(app, 'c-cancellata');

  // La chat è aperta in una home, e intanto la si cancella dalla Cronologia.
  const dash = await openTab(`${DASH}?chat=c-cancellata`);
  await expect(dash.locator('.dash-bubble').first()).toBeVisible();
  await app.evaluate(() => globalThis.SN_FILO_CHATS.remove('c-cancellata'));
  expect((await leggiArchivio(app)).length).toBe(0);

  // Si continua a scrivere nella home rimasta aperta: la chat cancellata
  // «per sempre» non deve risorgere a metà, con dentro solo la coda.
  await dash.locator('#input').fill('E il libero arbitrio?');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble')).toHaveCount(4, { timeout: 20_000 });

  await expect.poll(async () => {
    const chats = await leggiArchivio(app);
    if (!chats.length) return 'nessuna';
    return `${chats.length} chat, ${chats[0].messages.length} messaggi`;
  }, { timeout: 15_000 }).not.toBe('1 chat, 2 messaggi');
});
