// #1562 giro 6, rilievo 1: un turno già mandato al modello torna diverso al turno dopo, e la richiesta smette di
// crescere solo in coda. Porte: una cancellazione qualunque rifà quello che Filo aveva scritto davanti ai messaggi
// passati; un messaggio con più di sedici immagini parte intero e torna con sedici.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, { copione }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const sys = String((messages[0] && messages[0].content) || '');
      // La chat ha il CONTESTO dell'utente dopo la parte fissa: il messaggio della home no.
      if (!(messages[0] && messages[0].role === 'system' && sys.startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic()) && sys.includes('═══ CONTESTO (lo scrive Filo'))) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages, tools })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      try { if (r.text) onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text || '', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { copione });
}

async function scrivi(home, testo, risposta) {
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
}

test('r1 una chat di dieci giorni fa tolta dalla Cronologia non riscrive il messaggio in cui Filo aveva detto un cambio poi ritoccato', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaModello(app, [{ text: 'Uno.' }, { text: 'Due.' }, { text: 'Tre.' }, { text: 'Quattro.' }]);
  const vecchia = await app.evaluate(async () => {
    const id = 'c0c0c0c0-0000-4000-8000-00000000000c';
    const fa = (g) => new Date(Date.now() - g * 86400000).toISOString();
    await globalThis.SN_FILO_CHATS.append(id, { role: 'user', text: 'una ricetta di dieci giorni fa', ts: fa(10) });
    await globalThis.SN_FILO_CHATS.append(id, { role: 'filo', text: 'Eccola.', ts: fa(10) });
    return id;
  });
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await scrivi(home, 'ciao', 'Uno.');

  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#theme')).toHaveValue('light');
  await pref.locator('#theme').selectOption('dark');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme)).toBe('dark');
  await home.bringToFront();
  await scrivi(home, 'cosa è cambiato?', 'Due.');

  // Un minuto dopo l'utente ci ripensa dalle Preferenze, poi scrive ancora.
  await pref.bringToFront();
  await pref.locator('#theme').selectOption('light');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme)).toBe('light');
  await home.bringToFront();
  await scrivi(home, 'ok', 'Tre.');

  await app.evaluate(async (_e, id) => { await globalThis.SN_FILO_CHATS.remove(id); }, vecchia);
  await scrivi(home, 'e adesso?', 'Quattro.');

  const [, , tre, quattro] = await app.evaluate(() => globalThis.__chiamate);
  expect(quattro.messages.slice(0, tre.messages.length)).toEqual(tre.messages);
});

test('r1 una cancellazione dopo lo scatto del taglio dei giorni non riscrive il primo messaggio del tratto', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaModello(app, [{ text: 'Uno.' }, { text: 'Due.' }]);
  // L'orologio del main portato a cinque minuti da uno scatto del taglio (ogni sei ore col tetto di tre giorni): il
  // primo messaggio del tratto è delle prime ore dopo il taglio, e prima di lui, la sera, è arrivato un avviso.
  await app.evaluate(async () => {
    const H = 3600000;
    const vero = Date.now.bind(Date);
    const B = Math.ceil((vero() + H) / (6 * H)) * 6 * H;
    globalThis.__spost = B - 5 * 60000 - vero();
    Date.now = () => vero() + globalThis.__spost;
    const T0 = B - 3 * 24 * H;
    const iso = (t) => new Date(t).toISOString();
    const X = 'a1a1a1a1-0000-4000-8000-0000000000a1';
    await globalThis.SN_FILO_CHATS.append(X, { role: 'user', text: 'domanda della sera', ts: iso(T0 - H) });
    await globalThis.SN_FILO_CHATS.append(X, { role: 'filo', text: 'Risposta della sera.', ts: iso(T0 - H + 60000) });
    const T = globalThis.SN_FILO_EVENTI.TIPI;
    await globalThis.SN_IL_FILO.transazione((t) => t.scrivi([t.evento(T.NOTIFICA, { testo: 'La copia di sicurezza è pronta.' }, { autore: 'filo', ts: iso(T0 + 2 * H) })]));
    await globalThis.SN_FILO_CHATS.append(X, { role: 'user', text: 'domanda del mattino', ts: iso(T0 + 7 * H) });
    await globalThis.SN_FILO_CHATS.append(X, { role: 'filo', text: 'Risposta del mattino.', ts: iso(T0 + 7 * H + 60000) });
    const Z = 'c0c0c0c0-0000-4000-8000-00000000000c';
    await globalThis.SN_FILO_CHATS.append(Z, { role: 'user', text: 'una ricetta di dieci giorni fa', ts: iso(B - 10 * 24 * H) });
    await globalThis.SN_FILO_CHATS.append(Z, { role: 'filo', text: 'Eccola.', ts: iso(B - 10 * 24 * H + 60000) });
  });
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await scrivi(home, 'ciao', 'Uno.');
  // Dieci minuti dopo, passato lo scatto, la chat di dieci giorni fa tolta dalla Cronologia.
  await app.evaluate(async () => {
    globalThis.__spost += 10 * 60000;
    await globalThis.SN_FILO_CHATS.remove('c0c0c0c0-0000-4000-8000-00000000000c');
  });
  await scrivi(home, 'e adesso?', 'Due.');

  const [uno, due] = await app.evaluate(() => globalThis.__chiamate);
  expect(due.messages.slice(0, uno.messages.length)).toEqual(uno.messages);
});

test('r1 un messaggio con venti immagini torna al turno dopo com\'era partito', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Pronto.' }, { text: 'Viste.' }, { text: 'Ecco.' }]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await scrivi(home, 'ciao', 'Pronto.');
  const [, foto, dopo] = await app.evaluate(async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'guarda queste schermate', threadHistory: [], chatId: 'c-tante', images: Array.from({ length: 20 }, () => png) });
    await globalThis.SN_HANDLE_FILO_CHAT({
      userMessage: 'e la quinta?', chatId: 'c-tante',
      threadHistory: [{ role: 'user', text: 'guarda queste schermate', images: 20 }, { role: 'filo', text: 'Viste.' }],
    });
    return globalThis.__chiamate;
  });
  const domanda = foto.messages[foto.messages.length - 1];
  expect(domanda.content.filter((p) => p.type === 'image_url')).toHaveLength(20);
  // La domanda delle schermate, nel turno dopo, è la stessa che era partita.
  expect(dopo.messages[foto.messages.length - 1]).toEqual(domanda);
});
