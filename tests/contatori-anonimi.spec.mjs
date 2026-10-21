// I contatori giornalieri anonimi (#969) nell'app vera: una chiamata ai modelli conta un uso con l'attesa e i guasti,
// un messaggio di chat coi suoi giri conta uno, l'incognito non conta; l'interruttore delle Preferenze e la richiesta
// a Filo li spengono e buttano quello che aspettava; la pagina Privacy li racconta; l'owner vede le installazioni.
// La forma del documento e la spedizione: tests/unit/contatoriInvio.test.mjs; le regole: contatoriRegole.motore-vero.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';
import { iconaDellaBarra } from './helpers/barra.mjs';

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
    // Un'impostazione riuscita chiude il turno (#1130): la frase va scritta insieme.
    const giri = [
      { text: 'Spenti.', toolCalls: [{ id: 'c1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'contatori', valore: false }) }] },
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
    { type: globalThis.SN_MSG.MSG.CONTATORI_INSTALLAZIONI }, { isShell: true }, 'filo://manage/manage.html'));
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
    const page = await openTab(`${GESTIONE}#utenti`);
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
    await ricaricaSu(page, 'utenti');
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

// Un uso è quello che la persona chiede, non ogni chiamata: l'anticipo alla selezione e i blocchi di una traduzione
// non sono usi a sé (#969 giro 1).
const PAGINA_PAROLE = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">Il teorema di Pitagora vale per tutti i triangoli rettangoli del piano.</p>
<p id="p2">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie.</p>
</body>`;

async function fornitoreCheConta(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = { spiega: 0, traduci: 0 };
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      if (t.includes('ha selezionato un testo')) { globalThis.__chiamate.spiega += 1; return { text: 'Spiegazione di prova', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} }; }
      globalThis.__chiamate.traduci += 1;
      await new Promise((r) => setTimeout(r, 50));
      // Come il modello: rimanda i blocchi tradotti, coi separatori al loro posto.
      const prompt = [...messages].reverse().find((m) => typeof m.content === 'string')?.content || '';
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf('\n<<<FINE_TESTO_IN_PAGINA>>>');
      const blocco = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const text = blocco.split(/\n?@@@SN_SEP@@@\n?/).map((x) => `IT ${x}`).join('\n@@@SN_SEP@@@\n');
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

function puntoDellaParola(page, id, parola) {
  return page.evaluate(([i, w]) => {
    const nodo = document.getElementById(i).firstChild;
    const da = nodo.textContent.indexOf(w);
    const r = document.createRange();
    r.setStart(nodo, da);
    r.setEnd(nodo, da + w.length);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, [id, parola]);
}

const usiOggi = async (app, funzione) => ((await oggi(app))?.uso?.[funzione]?.n) || 0;

test('selezionare senza aprire Spiega non conta usi; aprirla sulla risposta già pronta ne conta uno', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitoreCheConta(app);
  const page = await testServer.openReady(openTab, PAGINA_PAROLE, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });

  for (const [id, parola] of [['p1', 'Pitagora'], ['p2', 'fotosintesi']]) {
    const p = await puntoDellaParola(page, id, parola);
    await page.mouse.dblclick(p.x, p.y);
    await page.waitForTimeout(900);
  }
  await expect.poll(() => app.evaluate(() => globalThis.__chiamate.spiega), { timeout: 5000 }).toBe(2);
  await page.waitForTimeout(3500);
  expect(await usiOggi(app, 'explain'), 'le spiegazioni preparate e mai aperte non sono usi').toBe(0);

  // Aperta col tasto destro: la risposta era già pronta, nessuna chiamata nuova, un uso con un'attesa da nulla.
  const p = await puntoDellaParola(page, 'p2', 'fotosintesi');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menuDi(page).locator('.sn-menu .sn-menu-inline-explain')).toContainText('Spiegazione di prova', { timeout: 10_000 });
  expect(await app.evaluate(() => globalThis.__chiamate.spiega)).toBe(2);
  await expect.poll(() => usiOggi(app, 'explain'), { timeout: 5000 }).toBe(1);
  expect((await oggi(app)).uso.explain.fasce).toEqual({ ms500: 1 });
});

test('tradurre una pagina lunga è un uso, non uno per blocco', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitoreCheConta(app);
  const paragrafi = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} ${'the quick brown fox jumps over the lazy dog '.repeat(25)}</p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><meta charset="utf-8"><body>${paragrafi}</body></html>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await (await iconaDellaBarra(app, 'translate')).click();
  await expect(page.locator('p').last()).toHaveText(/^IT /, { timeout: 20_000 });
  const chiamate = await app.evaluate(() => globalThis.__chiamate.traduci);
  expect(chiamate, 'la pagina è abbastanza lunga da partire a più blocchi').toBeGreaterThan(2);
  await expect.poll(() => usiOggi(app, 'translate-page'), { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(1000);
  expect(await usiOggi(app, 'translate-page')).toBe(1);
});
