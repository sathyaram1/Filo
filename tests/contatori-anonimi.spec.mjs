// I contatori giornalieri anonimi (#969) nell'app vera: una chiamata ai modelli conta un uso con l'attesa e i guasti,
// un messaggio di chat coi suoi giri conta uno, l'incognito non conta; l'interruttore delle Preferenze e la richiesta
// a Filo li spengono e buttano quello che aspettava; la pagina Privacy li racconta; l'owner vede le installazioni.
// La forma del documento e la spedizione: tests/unit/contatoriInvio.test.mjs; le regole: contatoriRegole.motore-vero.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  return s.giorni[globalThis.SN_CONTATORI.giornoDi(Date.now())] || null;
});
const statoContatori = (app) => app.evaluate(async () => globalThis.SN_CONTATORI_MAIN.letto());

// Il router finto nel main, al posto della rete: risponde in streaming e no, o rifiuta coi crediti finiti.
async function routerFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: T.registry,
      models: { ...T.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
    });
    globalThis.__routerRifiuta = false;
    if (!globalThis.__fetchVeroContatori) {
      globalThis.__fetchVeroContatori = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
          const endpoints = [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['max_tokens', 'reasoning', 'tools'], max_completion_tokens: 65536 }];
          return new Response(JSON.stringify({ data: { endpoints } }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (!u.includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVeroContatori(url, init);
        if (globalThis.__routerRifiuta) {
          return new Response(JSON.stringify({ error: { code: 402, message: 'Insufficient credits', metadata: { provider_name: 'DeepInfra' } } }), { status: 402, headers: { 'content-type': 'application/json' } });
        }
        await new Promise((r) => setTimeout(r, 30));
        const body = JSON.parse(init.body);
        if (body.stream) {
          const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco fatto.' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    }
  });
}

// Una spiegazione chiesta come la chiede una pagina: `incognito` la fa partire da una finestra in incognito.
const spiega = (app, testo, { incognito = false } = {}) => app.evaluate(async (_e, { testo, incognito }) => {
  const H = globalThis.__filoHandlers;
  const Storage = globalThis.__filoStorage;
  const C = globalThis.SN_CONST;
  const fai = () => H.handleStream({
    action: C.ACTIONS.EXPLAIN, payload: { messages: [{ role: 'user', content: testo }] }, origin: 'test', onDelta: () => {},
  }).then(() => 'ok', (e) => e.code || e.status || e.message);
  if (!incognito) return fai();
  try { return await Storage.runIncognito(fai); } finally { Storage.resetIncognito(); }
}, { testo, incognito });

test('una chiamata vera conta un uso con l’attesa, un rifiuto conta il suo guasto, l’incognito non conta', async ({ app }) => {
  test.setTimeout(60_000);
  await routerFinto(app);
  expect(await spiega(app, 'cos’è un fotone, prima volta')).toBe('ok');
  await expect.poll(async () => (await oggi(app))?.uso?.explain?.n || 0, { timeout: 5_000 }).toBe(1);
  const fasce = (await oggi(app)).uso.explain.fasce;
  expect(Object.values(fasce).reduce((a, n) => a + n, 0), 'l’attesa della risposta arrivata è in una fascia').toBe(1);

  expect(await spiega(app, 'cos’è un fotone, in incognito', { incognito: true })).toBe('ok');
  await app.evaluate(() => globalThis.__routerRifiuta = true);
  await spiega(app, 'cos’è un fotone, in incognito e senza crediti', { incognito: true });
  await new Promise((r) => setTimeout(r, 300));
  expect((await oggi(app)).uso.explain.n, 'quello che passa da una finestra in incognito non si conta').toBe(1);
  expect((await oggi(app)).errori.explain || {}).toEqual({});

  expect(await spiega(app, 'cos’è un fotone, senza crediti')).not.toBe('ok');
  await expect.poll(async () => (await oggi(app))?.uso?.explain?.n || 0, { timeout: 5_000 }).toBe(2);
  const errori = Object.entries((await oggi(app)).errori.explain);
  expect(errori).toHaveLength(1);
  const [chiave, n] = errori[0];
  expect(chiave.split('|').slice(1)).toEqual(['DeepInfra', 'crediti']);
  expect(n).toBe(1);
});

test('un messaggio di chat coi suoi giri è un uso solo, e la risposta arriva come sempre', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await expect(home.locator('#input')).toBeVisible();
  await routerFinto(app);
  const prima = (await oggi(app))?.uso?.['filo-chat']?.n || 0;
  await home.locator('#input').fill('che tempo fa domani?');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await oggi(app))?.uso?.['filo-chat']?.n || 0, { timeout: 5_000 }).toBe(prima + 1);
  const u = (await oggi(app)).uso['filo-chat'];
  expect(Object.values(u.fasce).reduce((a, n) => a + n, 0)).toBe(prima + 1);
});

test('Preferenze: i contatori sono accesi di serie, spenti buttano quello che aspettava e non contano più', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await routerFinto(app);
  expect(await spiega(app, 'una parola qualunque')).toBe('ok');
  await expect.poll(async () => (await oggi(app))?.uso?.explain?.n || 0, { timeout: 5_000 }).toBe(1);

  const pref = await openTab('filo://preferences/preferences.html#sec-contatori');
  const casella = pref.locator('#contatoriAttivi');
  await casella.scrollIntoViewIfNeeded();
  await expect(casella).toBeChecked({ timeout: 8_000 });
  await expect(pref.locator('#sec-contatori')).toContainText('Niente testi, indirizzi o nomi di file');
  mkdirSync(SHOTS, { recursive: true });
  await pref.locator('#sec-contatori').screenshot({ path: `${SHOTS}/contatori-preferenze-chiaro.png` });

  await casella.uncheck();
  await expect.poll(async () => (await impostazioni(app)).contatori.attivi, { timeout: 5_000 }).toBe(false);
  await expect.poll(async () => Object.keys((await statoContatori(app)).giorni).length, { timeout: 5_000 }).toBe(0);
  expect(await spiega(app, 'un’altra parola qualunque')).toBe('ok');
  await new Promise((r) => setTimeout(r, 300));
  expect(Object.keys((await statoContatori(app)).giorni), 'spenti, una chiamata non si conta').toEqual([]);
  expect(await app.evaluate(() => globalThis.SN_CONTATORI_MAIN.controlla())).toBe('spenti');

  await casella.check();
  await expect.poll(async () => (await impostazioni(app)).contatori.attivi, { timeout: 5_000 }).toBe(true);
  expect(await spiega(app, 'una terza parola qualunque')).toBe('ok');
  await expect.poll(async () => (await oggi(app))?.uso?.explain?.n || 0, { timeout: 5_000 }).toBe(1);

  await pref.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
  await pref.reload();
  await pref.locator('#contatoriAttivi').scrollIntoViewIfNeeded();
  await pref.locator('#sec-contatori').screenshot({ path: `${SHOTS}/contatori-preferenze-scuro.png` });

  // Dal link della sezione alla pagina Privacy, che dice cosa esce e come si spengono.
  await pref.locator('#contatoriPrivacy').click();
  await expect.poll(() => pref.url(), { timeout: 8_000 }).toContain('transparency/transparency.html?doc=privacy');
  await expect(pref.locator('body')).toContainText('Si spengono', { timeout: 8_000 });
  await expect(pref.locator('body')).toContainText('Manda i contatori anonimi');
});

test('«spegni i contatori» in chat li spegne, butta quello che aspettava, e le Preferenze aperte seguono', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  const pref = await openTab('filo://preferences/preferences.html#sec-contatori');
  await expect(pref.locator('#contatoriAttivi')).toBeChecked({ timeout: 8_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const giri = [
      { toolCalls: [{ id: 'c1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'contatori', valore: false }) }] },
      { text: 'Spenti.' },
    ];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = giri[Math.min(n, giri.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
    // Un giorno raccolto prima, che spegnendo deve sparire.
    globalThis.SN_CONTATORI_MAIN.apri(C.ACTIONS.HELP).fine(true);
  });
  await expect.poll(async () => (await oggi(app))?.uso?.help?.n || 0, { timeout: 5_000 }).toBe(1);

  await chat.bringToFront();
  await chat.locator('#input').fill('spegni i contatori anonimi');
  await chat.locator('#sendBtn').click();
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Spenti.' })).toBeVisible({ timeout: 10_000 });
  // Chiesto in chiaro da chi usa Filo, dentro la sua richiesta: Filo lo fa, e lo dice sotto il messaggio.
  await expect(chat.locator('body')).toContainText('Ha cambiato un\'impostazione', { timeout: 5_000 });
  await expect.poll(async () => (await impostazioni(app)).contatori.attivi, { timeout: 5_000 }).toBe(false);
  await expect.poll(async () => Object.keys((await statoContatori(app)).giorni).length, { timeout: 5_000 }).toBe(0);
  await expect(pref.locator('#contatoriAttivi')).not.toBeChecked({ timeout: 5_000 });
});

test('la pagina dell’owner mostra le installazioni attive di ieri e del mese, e un trattino se non le legge', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  // Chi non è owner riceve un no, anche se chiede dalla pagina giusta.
  const negato = await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.CONTATORI_INSTALLAZIONI }, { isShell: true }, 'filo://credits/owner.html'));
  expect(negato).toMatchObject({ ok: false, error: 'not_admin' });
  const daUnSito = await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.CONTATORI_INSTALLAZIONI }, {}, 'https://esempio.test/'));
  expect(daUnSito).toMatchObject({ ok: false, code: 'forbidden' });

  await app.evaluate(() => {
    const C = globalThis.SN_CONTATORI_MAIN;
    globalThis.__installazioniVere = C.installazioni;
    globalThis.__chiamateInstallazioni = 0;
    C.installazioni = async () => {
      globalThis.__chiamateInstallazioni += 1;
      if (globalThis.__installazioniGuaste) throw new Error('contatori 403 PERMISSION_DENIED');
      return { ieri: { giorno: '2026-10-15', n: 1, completo: true }, mese: { mese: '2026-10', n: 1234, completo: true } };
    };
    // L'owner per finta: la porta chiede solo che isAdmin dica sì.
    const ga = process.getBuiltinModule('module').createRequire(process.cwd() + '/src/main/main.js')('./auth/google-auth');
    globalThis.__isAdminVero = ga.isAdmin;
    globalThis.__getIdTokenVero = ga.getIdToken;
    ga.isAdmin = () => true;
    ga.getIdToken = async () => 'token-finto';
  });
  try {
    const page = await openTab('filo://credits/owner.html');
    await page.waitForFunction(() => { const s = document.getElementById('ownerSection'); return s && !s.hidden; }, null, { timeout: 15_000 });
    const riquadri = page.locator('#ownerInstallazioni .sn-wallet-numero');
    await expect(riquadri).toHaveCount(2, { timeout: 10_000 });
    await expect(riquadri.nth(0).locator('.sn-wallet-numero-valore')).toHaveText('1');
    await expect(riquadri.nth(0).locator('.sn-wallet-numero-nome')).toHaveText('installazione attiva ieri');
    await expect(riquadri.nth(1).locator('.sn-wallet-numero-valore')).toHaveText('1.234');
    await expect(riquadri.nth(1).locator('.sn-wallet-numero-nome')).toHaveText('installazioni attive a ottobre');
    await expect(riquadri.nth(0)).toHaveAttribute('title', /15 ott/);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/contatori-owner-chiaro.png`, fullPage: true });

    // Il tasto destro copia il numero; «Rileggi» chiede di nuovo, e un guasto è un trattino che dice perché.
    await riquadri.nth(1).click({ button: 'right' });
    await expect(page.locator('.sn-wallet-ctx .sn-select-option')).toHaveText(['Copia il numero', 'Rileggi']);
    await app.evaluate(() => { globalThis.__installazioniGuaste = true; });
    await page.locator('.sn-wallet-ctx .sn-select-option', { hasText: 'Rileggi' }).click();
    await expect(riquadri.nth(1).locator('.sn-wallet-numero-valore')).toHaveText('—', { timeout: 5_000 });
    await expect(riquadri.nth(1).locator('.sn-wallet-numero-nota')).toHaveText('non letti');
    const meseDiOggi = new Date().toLocaleDateString('it-IT', { month: 'long' });
    await expect(riquadri.nth(1).locator('.sn-wallet-numero-nome')).toHaveText(`installazioni attive a ${meseDiOggi}`);
    await expect(riquadri.nth(1)).toHaveAttribute('title', /npm run regole:pubblica/);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { theme: 'dark' } }));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#ownerInstallazioni .sn-wallet-numero').length === 2, null, { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/contatori-owner-scuro-guasto.png`, fullPage: true });
  } finally {
    await app.evaluate(() => {
      globalThis.SN_CONTATORI_MAIN.installazioni = globalThis.__installazioniVere;
      const ga = process.getBuiltinModule('module').createRequire(process.cwd() + '/src/main/main.js')('./auth/google-auth');
      ga.isAdmin = globalThis.__isAdminVero;
      ga.getIdToken = globalThis.__getIdTokenVero;
    });
  }
});
