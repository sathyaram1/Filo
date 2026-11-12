// I contatori della chat e dell'agente (#1463) nell'app vera: i giri e l'esito di un turno, gli strumenti per nome ed
// esito, le reazioni della persona (fermare, riprendere, Continua, Riprova, scrivere mentre lavora), le copie da una
// bolla e le chat che finiscono. Forma e spedizione: tests/unit/contatoriGiornalieri.test.mjs, contatoriInvio.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { home, chiedi } from './helpers/chatFinta.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

// Le ore di oggi sommate, come in contatori-anonimi.spec.mjs: un test che passa da un'ora all'altra legge lo stesso totale.
const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const ore = Object.entries(s.ore || {}).filter(([k]) => k.startsWith(`${g}T`)).map(([, v]) => v);
  const somma = (a, b) => {
    for (const [k, v] of Object.entries(b || {})) {
      if (typeof v === 'number') a[k] = (a[k] || 0) + v;
      else if (v && typeof v === 'object' && !Array.isArray(v)) somma(a[k] || (a[k] = {}), v);
    }
    return a;
  };
  return ore.reduce((tot, o) => somma(tot, o), {});
});
const conto = async (app, campo, chiave) => ((await oggi(app))[campo] || {})[chiave] || 0;
const turni = async (app) => ((await oggi(app)).chatTurni || {})['filo-chat'] || {};
const strumenti = async (app) => ((await oggi(app)).strumenti || {})['filo-chat'] || {};

// Il modello della chat a copione: ogni giro dà le sue chiamate agli strumenti, il testo, un ritardo, o un guasto.
// Il classificatore delle chat finite risponde «comando», le altre chiamate secche niente.
async function copione(app, giri) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await app.evaluate(async (_e, g) => {
    const P = globalThis.SN_PROVIDERS;
    if (!globalThis.__copione_orig) globalThis.__copione_orig = { stream: P.streamCompleteWithFallback, secca: P.completeWithFallback };
    let n = 0;
    const chat = async ({ attempts, onDelta, onToolCall, signal }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      // Come un fornitore vero, lo stop interrompe la chiamata in volo.
      if (giro.ritardoMs) {
        await new Promise((ok, no) => {
          const t = setTimeout(ok, giro.ritardoMs);
          if (signal) signal.addEventListener('abort', () => { clearTimeout(t); no(Object.assign(new Error('fermato'), { name: 'AbortError' })); }, { once: true });
        });
      }
      if (giro.errore) throw Object.assign(new Error('Il fornitore non risponde'), { status: 503 });
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
    P.streamCompleteWithFallback = chat;
    // Senza una scheda che la legga in diretta la chat chiama senza flusso: con gli strumenti è lei.
    P.completeWithFallback = async (o) => {
      if (Array.isArray(o.tools) && o.tools.length) return chat(o);
      const sistema = String((o.messages && o.messages[0] && o.messages[0].content) || '');
      const text = sistema.includes('Classifichi le conversazioni') ? '{"tipo": "comando", "titolo": "Prova dei contatori"}' : '';
      return { model: o.attempts[0].model, provider: o.attempts[0].provider, usage: {}, text, toolCalls: [], finishReason: 'stop' };
    };
  }, giri);
}

test.afterEach(async ({ app }) => {
  await app.evaluate(() => {
    const o = globalThis.__copione_orig;
    if (o) { globalThis.SN_PROVIDERS.streamCompleteWithFallback = o.stream; globalThis.SN_PROVIDERS.completeWithFallback = o.secca; }
  }).catch(() => {});
});

const leggi = (id) => ({ id, name: 'CAPACITA_DETTAGLIO', arguments: JSON.stringify({ ids: ['contatori-anonimi'] }) });

test('un messaggio con gli strumenti conta i giri, ogni strumento col suo esito e le azioni del giro, e la risposta arriva', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await copione(app, [
    { toolCalls: [leggi('c1'), { id: 'c2', name: 'INVENTATO_DAL_MODELLO', arguments: '{}' }, { id: 'c3', name: 'LEGGI_IMPOSTAZIONI', arguments: '{non è json' }] },
    { text: 'Ecco fatto.' },
  ]);
  await chiedi(page, 'quali contatori mandi?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => turni(app), { timeout: 8_000 }).toEqual({ 'risposta|g2': 1 });
  expect(await strumenti(app)).toEqual({
    'CAPACITA_DETTAGLIO|eseguito': 1, 'altro|rifiutato': 1, 'LEGGI_IMPOSTAZIONI|argomenti_errati': 1,
  });
  expect((await oggi(app)).azioniPerGiro).toEqual({ 'filo-chat': { a3_5: 1 } });
  const dentro = JSON.stringify(await app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto()));
  expect(dentro, 'la domanda non entra nei contatori').not.toContain('quali contatori');

  // Lo stesso messaggio da una finestra in incognito non conta niente.
  const prima = await turni(app);
  const r = await app.evaluate(async () => {
    const S = globalThis.__filoStorage;
    try { return await S.runIncognito(() => globalThis.SN_HANDLE_FILO_CHAT({ userMessage: 'in incognito', threadHistory: [] })); } finally { S.resetIncognito(); }
  });
  expect(r && r.text).toBe('Ecco fatto.');
  await new Promise((ok) => setTimeout(ok, 500));
  expect(await turni(app)).toEqual(prima);
});

test('arrivato al tetto dei giri, «Continua» si conta come tale, col turno al tetto', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [...Array.from({ length: 12 }, (_, i) => ({ toolCalls: [leggi(`t${i}`)] })), { text: 'Ripreso.' }]);
  await chiedi(page, 'leggi tutto quello che puoi');
  const continua = page.locator('.dash-continua');
  await expect(continua).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => turni(app), { timeout: 8_000 }).toEqual({ 'tetto_giri|tetto': 1 });
  expect((await strumenti(app))['CAPACITA_DETTAGLIO|eseguito']).toBe(12);
  expect((await oggi(app)).azioniPerGiro).toEqual({ 'filo-chat': { a1: 12 } });
  await continua.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ripreso.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => conto(app, 'chatReazioni', 'continua_tetto_giri'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => turni(app), { timeout: 8_000 }).toEqual({ 'tetto_giri|tetto': 1, 'risposta|g1': 1 });
});

test('fermare prima del testo, riprendere, scrivere mentre lavora e Riprova sono reazioni, coi loro turni', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ ritardoMs: 4000, text: 'Troppo tardi.' }, { text: 'Ripreso.' }]);
  await chiedi(page, 'una domanda lenta');
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(900);
  await page.locator('#stopBtn').click();
  await expect.poll(() => conto(app, 'chatReazioni', 'ferma_prima_del_testo'), { timeout: 8_000 }).toBe(1);
  await expect.poll(() => turni(app), { timeout: 10_000 }).toEqual({ 'fermato|g1': 1 });
  // Fermato, il tasto d'invio offre di riprendere.
  await expect(page.locator('#sendBtn[data-modo="riprendi"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ripreso.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => conto(app, 'chatReazioni', 'riprendi'), { timeout: 8_000 }).toBe(1);

  // Un seguito scritto mentre Filo lavora.
  await copione(app, [{ ritardoMs: 2500, text: 'Risposta col seguito.' }]);
  await chiedi(page, 'un’altra domanda lenta');
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await page.locator('#input').fill('e anche questo');
  await page.locator('#input').press('Enter');
  await expect.poll(() => conto(app, 'chatReazioni', 'seguito_scritto'), { timeout: 8_000 }).toBe(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta col seguito.' }).first()).toBeVisible({ timeout: 20_000 });

  // Un guasto, poi «Riprova» dalla bolla d'errore.
  await copione(app, [{ errore: true }, { text: 'Adesso sì.' }]);
  await chiedi(page, 'questa fallisce');
  const riprova = page.locator('.dash-action-btn', { hasText: 'Riprova' });
  await expect(riprova).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await turni(app))['errore|g1'] || 0, { timeout: 8_000 }).toBe(1);
  await riprova.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Adesso sì.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => conto(app, 'chatReazioni', 'riprova'), { timeout: 8_000 }).toBe(1);
});

test('copiare da una bolla conta il suo ruolo, da tastiera e dal tasto destro, mai il testo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await copione(app, [{ text: 'Una risposta da copiare.' }]);
  await chiedi(page, 'una domanda da copiare');
  const risposta = page.locator('.dash-bubble-filo', { hasText: 'Una risposta da copiare.' });
  await expect(risposta).toBeVisible({ timeout: 15_000 });
  const seleziona = (testo) => page.evaluate((t) => {
    const b = [...document.querySelectorAll('.dash-bubble')].find((x) => x.textContent.includes(t));
    const r = document.createRange();
    r.selectNodeContents(b);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, testo);
  await seleziona('Una risposta da copiare.');
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => conto(app, 'chatCopie', 'risposta'), { timeout: 8_000 }).toBe(1);

  await seleziona('una domanda da copiare');
  await page.locator('.dash-bubble-user', { hasText: 'una domanda da copiare' }).click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Copia').first().click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5_000 }).toContain('una domanda da copiare');
  await expect.poll(() => conto(app, 'chatCopie', 'utente'), { timeout: 8_000 }).toBe(1);
  expect(JSON.stringify(await app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto()))).not.toContain('copiare');
});

test('una chat che finisce si conta una volta, con la via, i messaggi, la durata e il tipo; una risposta tardiva la richiude', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await copione(app, [{ text: 'Fatto.' }]);
  await chiedi(page, 'metti il tema scuro');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 15_000 });
  await page.locator('#input').fill('/clear');
  await page.locator('#input').press('Enter');
  await expect.poll(async () => (await oggi(app)).chatChiuse || {}, { timeout: 15_000 }).toEqual({ chat_nuova: { 'm1|min1|comando': 1 } });
  expect(JSON.stringify(await app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto())), 'il titolo non entra')
    .not.toContain('Prova dei contatori');

  // Una risposta che arriva quando la chat è già finita la richiude: si conta anche quella.
  await copione(app, [{ ritardoMs: 3000, text: 'Arrivo tardi.' }]);
  await chiedi(page, 'una domanda lunga');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_FILO_CHATS.list()).filter((c) => !c.closedAt).length), { timeout: 8_000 }).toBe(1);
  await app.evaluate(async () => {
    const aperta = (await globalThis.SN_FILO_CHATS.list()).find((c) => !c.closedAt);
    await globalThis.SN_CLOSE_FILO_CHAT(aperta.id, { via: 'home' });
  });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Arrivo tardi.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await oggi(app)).chatChiuse || {}, { timeout: 15_000 }).toEqual({
    chat_nuova: { 'm1|min1|comando': 1 }, home: { 'm1|min1|comando': 1 }, risposta_tardiva: { 'm1|min1|comando': 1 },
  });

  // Chiudere di nuovo una chat già chiusa non la conta una seconda volta.
  await page.locator('#input').fill('/clear');
  await page.locator('#input').press('Enter');
  await new Promise((ok) => setTimeout(ok, 1500));
  expect(Object.keys((await oggi(app)).chatChiuse).sort()).toEqual(['chat_nuova', 'home', 'risposta_tardiva']);
  expect((await oggi(app)).chatChiuse.chat_nuova).toEqual({ 'm1|min1|comando': 1 });

  // La scheda che se ne va chiude la sua chat: si conta una volta, anche se a chiuderla arrivano in due.
  await copione(app, [{ text: 'Ultima.' }]);
  await chiedi(page, 'l’ultima domanda');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ultima.' })).toBeVisible({ timeout: 15_000 });
  await testServer.openReady(openTab, '<!doctype html><body><p>altra scheda</p></body>');
  const idHome = await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.view && x.view.webContents.getURL().startsWith('filo://newtab'));
      if (t) return t.id;
    }
    return null;
  });
  expect(idHome).toBeTruthy();
  await shell.evaluate((id) => window.filoShell.tabs.close(id), idHome);
  await expect.poll(async () => ((await oggi(app)).chatChiuse || {}).uscita || {}, { timeout: 15_000 }).toEqual({ 'm1|min1|comando': 1 });
  await new Promise((ok) => setTimeout(ok, 800));
  expect(((await oggi(app)).chatChiuse || {}).uscita).toEqual({ 'm1|min1|comando': 1 });
  const stato = await app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto());
  expect(stato.chiuse, 'nessuna chat resta ad aspettare il tipo').toEqual({});
});
