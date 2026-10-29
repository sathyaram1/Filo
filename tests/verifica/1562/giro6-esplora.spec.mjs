// Esplorazione del giro 6 di #1562: dove la richiesta di un turno smette di essere il prefisso di quella dopo.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione, extra = {}) {
  await app.evaluate(async (_e, { copione, extra }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...extra,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, tools, onDelta, onToolCall }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const sys = String((messages[0] && messages[0].content) || '');
      if (!(messages[0] && messages[0].role === 'system' && sys.startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic()) && sys.includes('═══ CONTESTO (lo scrive Filo'))) {
        return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__chiamate.push(JSON.parse(JSON.stringify({ messages, tools })));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      if (r.errore) throw new Error(r.errore);
      const calls = r.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      try { if (r.text) onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop' };
    };
  }, { copione, extra });
}

async function scrivi(home, testo, risposta) {
  await home.locator('#input').fill(testo);
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: risposta })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
}

const testo = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join(''));
function primaDifferenza(a, b) {
  for (let i = 0; i < a.messages.length; i++) {
    if (JSON.stringify(a.messages[i]) !== JSON.stringify(b.messages[i])) {
      return { i, di: a.messages.length, prima: testo(a.messages[i]).slice(0, 600), dopo: b.messages[i] ? testo(b.messages[i]).slice(0, 600) : null };
    }
  }
  return null;
}

test('esplora: cancellazione di una chat vecchia dopo un cambio ritoccato', async ({ app, openTab }) => {
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

  // Entro due minuti l'utente ci ripensa: il cambio si fonde col primo e si ritira.
  await pref.bringToFront();
  await pref.locator('#theme').selectOption('light');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme)).toBe('light');
  await home.bringToFront();
  await scrivi(home, 'ok', 'Tre.');

  // Una chat di dieci giorni fa, fuori dal tratto, tolta dalla Cronologia.
  await app.evaluate(async (_e, id) => { await globalThis.SN_FILO_CHATS.remove(id); }, vecchia);
  await scrivi(home, 'e adesso?', 'Quattro.');

  const c = await app.evaluate(() => globalThis.__chiamate);
  console.log('2→3', JSON.stringify(primaDifferenza(c[1], c[2]), null, 1));
  console.log('3→4', JSON.stringify(primaDifferenza(c[2], c[3]), null, 1));
  console.log('domanda 2:', testo(c[1].messages[c[1].messages.length - 1]).slice(0, 800));
});

test('esplora: cancellazione dopo che il taglio dei giorni ha fatto uno scatto', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaModello(app, [{ text: 'Uno.' }, { text: 'Due.' }]);
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
  // Dieci minuti dopo, oltre lo scatto delle sei ore, una chat di dieci giorni fa tolta dalla Cronologia.
  await app.evaluate(async () => {
    globalThis.__spost += 10 * 60000;
    await globalThis.SN_FILO_CHATS.remove('c0c0c0c0-0000-4000-8000-00000000000c');
  });
  await scrivi(home, 'e adesso?', 'Due.');
  const c = await app.evaluate(() => globalThis.__chiamate);
  console.log('primo:', testo(c[0].messages[1]).slice(0, 900));
  console.log('1→2', JSON.stringify(primaDifferenza(c[0], c[1]), null, 1));
});

test('esplora: venti immagini in un messaggio solo', async ({ app }) => {
  test.setTimeout(120_000);
  await preparaModello(app, [{ text: 'Viste.' }, { text: 'Ecco.' }]);
  const c = await app.evaluate(async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const foto = Array.from({ length: 20 }, () => png);
    await globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'guarda queste schermate', threadHistory: [], chatId: 'c-tante', images: foto });
    await globalThis.SN_HANDLE_FILO_CHAT({
      userMessage: 'e la quinta?', chatId: 'c-tante',
      threadHistory: [{ role: 'user', text: 'guarda queste schermate', images: 20 }, { role: 'filo', text: 'Viste.' }],
    });
    return globalThis.__chiamate;
  });
  const n = (m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url').length : 0);
  console.log('foto nel turno:', c[0].messages.map(n), 'dopo:', c[1].messages.map(n));
  const s0 = testo(c[0].messages[0]);
  const s1 = testo(c[1].messages[0]);
  let k = 0;
  while (k < s0.length && s0[k] === s1[k]) k++;
  console.log('system diverge a', k, 'di', s0.length, s1.length, '\nPRIMA:', s0.slice(k - 200, k + 400), '\nDOPO:', s1.slice(k - 200, k + 400));
  console.log('1→2', JSON.stringify(primaDifferenza(c[0], c[1]), null, 1));
});

test('esplora: un turno con strumenti, poi due turni, poi un Riprova e un turno', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaModello(app, [
    { text: 'Guardo.', toolCalls: [{ id: 'l1', name: 'LEGGI_IMPOSTAZIONI', arguments: JSON.stringify({ cerca: 'tema' }) }] },
    { text: 'Hai il tema chiaro.' },
    { text: 'Bene.' },
    { errore: 'servizio non raggiungibile' },
    { text: 'Ripreso.' },
    { text: 'Fine.' },
  ]);
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await scrivi(home, 'che tema ho?', 'Hai il tema chiaro.');
  await scrivi(home, 'grazie', 'Bene.');
  await home.locator('#input').fill('e il carattere?');
  await home.locator('#sendBtn').click();
  const riprova = home.locator('.dash-action-btn', { hasText: 'Riprova' });
  await expect(riprova).toBeVisible({ timeout: 15_000 });
  await riprova.click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ripreso.' })).toBeVisible({ timeout: 15_000 });
  await expect(home.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await scrivi(home, 'ciao', 'Fine.');
  const c = await app.evaluate(() => globalThis.__chiamate);
  for (let k = 0; k + 1 < c.length; k++) console.log(`${k}→${k + 1}`, JSON.stringify(primaDifferenza(c[k], c[k + 1]), null, 1));
});
