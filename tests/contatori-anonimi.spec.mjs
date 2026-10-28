// I contatori anonimi (#969, #1461) nell'app vera: usi dei modelli, azioni, avvio, impostazioni, ricerche, errori visti
// e conferme si contano nell'ora in corso, l'incognito no; Preferenze e chat li spengono e buttano quello che aspettava;
// la pagina Privacy li racconta; l'owner vede le installazioni. Forma e spedizione: tests/unit/contatoriInvio.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { menuDi } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno } from './helpers/segniDelCorrettore.mjs';
import { GESTIONE, ricaricaSu } from './helpers/gestione.mjs';
import { barraPage, comandaBarra, menuAperto, premiNellaBarra } from './helpers/barra.mjs';

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
// Le ore di oggi sommate: un test che passa da un'ora all'altra legge lo stesso totale.
const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const ore = Object.entries(s.ore || {}).filter(([k]) => k.startsWith(`${g}T`)).map(([, v]) => v);
  if (!ore.length) return null;
  const somma = (a, b) => {
    for (const [k, v] of Object.entries(b || {})) {
      if (typeof v === 'number') a[k] = (a[k] || 0) + v;
      else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) a[k] = v.map((x, i) => x + ((a[k] || [])[i] || 0));
      else if (Array.isArray(v)) a[k] = [...new Set([...(a[k] || []), ...v])];
      else if (v && typeof v === 'object') somma(a[k] || (a[k] = {}), v);
    }
    return a;
  };
  return ore.reduce((tot, o) => somma(tot, o), {});
});
const quante = (fasce) => Object.values(fasce || {}).reduce((a, n) => a + n, 0);
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
        // I numeri che il router dichiara (#1464): in coda allo streaming, come fa lui.
        const usage = globalThis.__usoRouter || null;
        if (body.stream) {
          const fine = usage ? `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [], usage })}\n\n` : '';
          const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' }, ...(usage ? { finish_reason: 'stop' } : {}) }] })}\n\n${fine}data: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco fatto.' }, finish_reason: 'stop' }], usage: usage || {} }), { status: 200, headers: { 'content-type': 'application/json' } });
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
  const { visto, fine } = (await oggi(app)).uso.explain;
  expect(quante(visto), 'l’attesa della prima risposta è in una fascia').toBe(1);
  expect(quante(fine), 'e anche quella della fine').toBe(1);

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
  expect(quante(u.visto)).toBe(prima + 1);
});

// #1464 — dalla risposta del router fino all'ora che parte: i numeri della chiamata, mai il testo.
test('una risposta della chat porta nell’ora contesto, cache, ragionamento, uscita, ripiego, spesa e chiamate per uso', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  await expect(home.locator('#input')).toBeVisible();
  await routerFinto(app);
  await app.evaluate(() => {
    globalThis.__usoRouter = {
      prompt_tokens: 9000, completion_tokens: 700, cost: 0.0042,
      prompt_tokens_details: { cached_tokens: 6000 }, completion_tokens_details: { reasoning_tokens: 300 },
    };
  });
  await home.locator('#input').fill('quanto fa due più due? scrivilo a mario.rossi@example.com');
  await home.locator('#sendBtn').click();
  await expect(home.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => Object.keys((await oggi(app))?.chiamate?.['filo-chat'] || {}).length, { timeout: 5_000 }).toBe(1);
  const o = await oggi(app);
  const resti = (campo) => Object.entries(o[campo]['filo-chat']).map(([k, n]) => [k.split('|').slice(1).join('|'), n]);
  const modelli = new Set(['contesto', 'cache', 'ragionamento', 'uscita', 'ripieghi', 'spesa'].flatMap((c) => Object.keys(o[c]['filo-chat']).map((k) => k.split('|')[0])));
  expect([...modelli], 'un modello solo, col suo nome del router').toHaveLength(1);
  expect([...modelli][0]).toMatch(/^[a-z0-9-]+\/[a-z0-9.:-]+$/);
  const n = o.uso['filo-chat'].n;
  expect(resti('contesto')).toEqual([['t16k', n]]);
  expect(resti('cache'), 'seimila su novemila: fra metà e tre quarti').toEqual([['q75', n]]);
  expect(resti('ragionamento')).toEqual([['r1k', n]]);
  expect(resti('uscita')).toEqual([['o1k|stop', n]]);
  expect(resti('ripieghi'), 'ha risposto il primo della catena, senza ricominciare').toEqual([['t1|no', n]]);
  expect(resti('spesa')[0][0]).toBe('router');
  expect(Math.round(resti('spesa')[0][1])).toBe(420 * n);
  expect(o.chiamate['filo-chat']).toEqual({ c1: n });

  // I due documenti dell'ora passano la validazione, e non portano niente di quello che si è scritto.
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_CONTATORI;
    const s = await globalThis.SN_CONTATORI_MAIN.letto();
    const k = C.oraDi(Date.now());
    const base = { pseudonimo: 'a'.repeat(20), chiave: k, app: '0.2.249', os: 'win', dati: s.ore[k] };
    const ora = C.documento(base);
    const chiamate = C.documentoChiamate(base);
    return { ora: C.valida(ora), chiamate: C.validaChiamate(chiamate), vuote: C.senzaChiamate(chiamate), testo: JSON.stringify([ora, chiamate]) };
  });
  expect(esito.ora.ok, esito.ora.motivo).toBe(true);
  expect(esito.chiamate.ok, esito.chiamate.motivo).toBe(true);
  expect(esito.vuote).toBe(false);
  expect(esito.testo).not.toMatch(/mario|due più due|Ecco fatto/);
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
  await expect.poll(async () => Object.keys((await statoContatori(app)).ore).length, { timeout: 5_000 }).toBe(0);
  expect(await spiega(app, 'un’altra parola qualunque')).toBe('ok');
  await new Promise((r) => setTimeout(r, 300));
  expect(Object.keys((await statoContatori(app)).ore), 'spenti, una chiamata non si conta').toEqual([]);
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
    // Un'ora raccolta prima, che spegnendo deve sparire.
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
  await expect.poll(async () => Object.keys((await statoContatori(app)).ore).length, { timeout: 5_000 }).toBe(0);
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
    // Una copia sola: sotto le cinque il numero non si mostra (#1462).
    await expect(riquadri.nth(0).locator('.sn-wallet-numero-valore')).toHaveText('meno di 5');
    await expect(riquadri.nth(0).locator('.sn-wallet-numero-nome')).toHaveText('installazioni attive ieri');
    await expect(riquadri.nth(0)).toHaveAttribute('title', /Meno di cinque: il numero esatto non si mostra/);
    await expect(riquadri.nth(1).locator('.sn-wallet-numero-valore')).toHaveText('1.234');
    await expect(riquadri.nth(1).locator('.sn-wallet-numero-nome')).toHaveText('installazioni attive a ottobre');
    await expect(riquadri.nth(0)).toHaveAttribute('title', /15 ott/);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/contatori-owner-chiaro.png`, fullPage: true });

    // Il tasto destro copia il numero; «Rileggi» chiede di nuovo, e un guasto è un trattino che dice perché.
    await riquadri.nth(1).click({ button: 'right' });
    await expect(page.locator('.sn-wallet-ctx .sn-select-option')).toHaveText(['Copia il numero', 'Apri i contatori', 'Rileggi']);
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
    // Il numero si apre sulla scheda Contatori, dove le stesse copie stanno per giorno e per ora.
    await app.evaluate(() => { globalThis.__installazioniGuaste = false; });
    await ricaricaSu(page, 'utenti');
    await page.locator('#ownerInstallazioni .sn-wallet-numero').nth(0).click();
    await expect(page.locator('#panel-contatori')).toHaveClass(/mg-panel--active/, { timeout: 5_000 });
    await expect(page.locator('.mg-tab[data-tab="contatori"]')).toHaveClass(/mg-tab--active/);
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
  expect((await oggi(app)).uso.explain.visto).toEqual({ ms500: 1 });
  // Le due spiegazioni preparate in anticipo, e una sola aperta: l'altra è il costo di prepararle.
  expect((await oggi(app)).anticipi.explain).toEqual({ preparati: 2, aperti: 1 });
});

test('tradurre una pagina lunga è un uso, non uno per blocco', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await fornitoreCheConta(app);
  const paragrafi = Array.from({ length: 12 }, (_, i) => `<p>Paragraph ${i} ${'the quick brown fox jumps over the lazy dog '.repeat(25)}</p>`).join('');
  const page = await testServer.openReady(openTab, `<!doctype html><html lang="en"><meta charset="utf-8"><body>${paragrafi}</body></html>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await premiNellaBarra(app, 'translate');
  await expect(page.locator('p').last()).toHaveText(/^IT /, { timeout: 20_000 });
  const chiamate = await app.evaluate(() => globalThis.__chiamate.traduci);
  expect(chiamate, 'la pagina è abbastanza lunga da partire a più blocchi').toBeGreaterThan(2);
  await expect.poll(() => usiOggi(app, 'translate-page'), { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(1000);
  expect(await usiOggi(app, 'translate-page')).toBe(1);
});

// ── Le misure in più (#1461) ────────────────────────────────────────────────
const schedaDavanti = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  return w ? w._filoTabs.activeId : null;
});

// La chat che risponde con le azioni date, giro dopo giro, come il router vero.
async function chatCheFa(app, giri) {
  await app.evaluate(async (_e, g) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}

test('l’avvio, una scheda nuova e una ricarica contano la loro attesa, fino alla pagina visibile e caricata', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await expect.poll(async () => (await oggi(app))?.azioni?.avvio?.n || 0, { timeout: 15_000 }).toBe(1);
  const avvio = (await oggi(app)).azioni.avvio;
  expect(quante(avvio.visto), 'l’avvio fino alla finestra visibile').toBe(1);
  expect(quante(avvio.fine), 'e fino alla prima scheda caricata').toBe(1);

  await shell.keyboard.press('Control+t');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });
  await expect.poll(async () => (await oggi(app))?.azioni?.['new-tab']?.n || 0, { timeout: 10_000 }).toBe(1);
  expect(quante((await oggi(app)).azioni['new-tab'].fine), 'la scheda nuova fino alla pagina caricata').toBe(1);

  // Una scheda aperta col suo indirizzo (un collegamento, Filo) non è il gesto «scheda nuova».
  await openTab(testServer.html('<!doctype html><title>da ricaricare</title><p>ciao</p>'));
  expect((await oggi(app)).azioni['new-tab'].n).toBe(1);
  const id = await schedaDavanti(app);
  await shell.evaluate((i) => window.filoShell.tabs.reload(i), id);
  await expect.poll(async () => (await oggi(app))?.azioni?.reload?.n || 0, { timeout: 10_000 }).toBe(1);
  const r = (await oggi(app)).azioni.reload;
  expect([quante(r.visto), quante(r.fine)]).toEqual([1, 1]);
  expect((await oggi(app)).primeVolte).toEqual(expect.arrayContaining(['avvio', 'new-tab', 'reload']));
});

test('un’impostazione cambiata conta il valore solo se è di un elenco chiuso, e dice se l’ha chiesto a Filo', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const pref = await openTab('filo://preferences/preferences.html');
  const casella = pref.locator('#spiegaAnticipata');
  await casella.scrollIntoViewIfNeeded();
  const accesa = await casella.isChecked();
  await casella.click();
  await expect.poll(async () => (await oggi(app))?.impostazioni?.['spiegaAnticipata.enabled'] || null, { timeout: 8_000 })
    .toEqual({ [`${accesa ? 'spento' : 'acceso'}|mano`]: 1 });
  // Un valore scritto da chi usa Filo esce solo come «cambiato».
  await pref.evaluate(() => chrome.runtime.sendMessage({ type: 'update_settings', settings: { agentStyle: 'Rispondimi come Mario Rossi' } }));
  await expect.poll(async () => (await oggi(app))?.impostazioni?.agentStyle || null, { timeout: 8_000 }).toEqual({ 'cambiato|mano': 1 });
  expect(JSON.stringify(await statoContatori(app))).not.toContain('Mario');

  // Chiesto a Filo in chat: lo stesso cambio, segnato come tale.
  await chatCheFa(app, [
    { toolCalls: [{ id: 't1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'tema', valore: 'scuro' }) }] },
    { text: 'Fatto, ora è scuro.' },
  ]);
  const home = await homeDi(app);
  await home.bringToFront();
  await home.locator('#input').fill('metti il tema scuro');
  await home.locator('#sendBtn').click();
  // La frase è anche un comando rapido, che Filo fa senza modello: il cambio è chiesto in chat per l'una o l'altra via.
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 15_000 }).toBe('dark');
  await expect.poll(async () => (await oggi(app))?.impostazioni?.theme || null, { timeout: 8_000 }).toEqual({ 'dark|chat': 1 });
});

test('la ricerca fra i font dell’Editor conta l’attesa e la posizione della scelta, e la chiusura senza scelta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('.ed-overlay [data-add="font"]').click();
  const mod = page.locator('.ed-module[data-type="font"]');
  await expect(mod).toHaveCount(1);
  await mod.locator('.ed-font-button').click();
  await mod.locator('.ed-font-search').fill('garam');
  await mod.locator('.ed-font-list .sn-select-option:visible').first().click();
  await expect.poll(async () => (await oggi(app))?.ricerche?.font?.scelte || null, { timeout: 8_000 }).not.toBeNull();
  let r = (await oggi(app)).ricerche.font;
  expect([r.aperte, quante(r.scelte), r.posizioni, r.vuote || 0]).toEqual([1, 1, { p1: 1 }, 0]);
  // Aperta e chiusa senza scegliere.
  await mod.locator('.ed-font-button').click();
  await expect(mod.locator('.ed-font-pop')).toBeVisible();
  await mod.locator('.ed-font-search').press('Escape');
  await expect.poll(async () => (await oggi(app))?.ricerche?.font?.vuote || 0, { timeout: 8_000 }).toBe(1);
  r = (await oggi(app)).ricerche.font;
  expect(r.aperte).toBe(2);
  expect(JSON.stringify(await statoContatori(app))).not.toContain('garam');
});

test('una pagina d’errore di rete e una scheda caduta sono errori visti, col numero e mai l’indirizzo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html('<!doctype html><title>viva</title><p>contenuto</p>');
  await openTab(url);
  await app.evaluate(({ webContents, BrowserWindow }, target) => {
    const shellWc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://shell/'));
    const mainWin = BrowserWindow.fromWebContents(shellWc);
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === target && BrowserWindow.fromWebContents(w) === mainWin);
    process.kill(wc.getOSProcessId(), 'SIGKILL');
  }, url);
  await expect.poll(async () => Object.keys((await oggi(app))?.erroriVisti || {}).filter((k) => k.startsWith('crash:scheda:')).length, { timeout: 15_000 }).toBe(1);

  // Un sito che non esiste: la pagina d'errore conta col codice di Chromium.
  const id = await schedaDavanti(app);
  await app.evaluate(({ BrowserWindow }, i) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.navigate(i, 'http://sito-che-non-esiste.invalid/');
  }, id);
  await expect.poll(async () => Object.keys((await oggi(app))?.erroriVisti || {}).filter((k) => /^rete:-\d+$/.test(k)).length, { timeout: 20_000 }).toBe(1);
  const tutto = JSON.stringify(await statoContatori(app));
  expect(tutto).not.toContain('invalid');
  expect(tutto).not.toContain('127.0.0.1');
});

test('una conferma di Filo detta di no si conta coi suoi ingressi, e l’azione non parte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await chatCheFa(app, [
    { toolCalls: [{ id: 'c1', name: 'CANCELLA_PAGINE', arguments: JSON.stringify({ periodo: 'tutto' }) }] },
    { text: 'Te lo chiedo prima.' },
  ]);
  const home = await homeDi(app);
  await home.locator('#input').fill('cancella tutta la cronologia');
  await home.locator('#sendBtn').click();
  const bottone = home.locator('.dash-action-btn').last();
  await expect(bottone).toBeVisible({ timeout: 15_000 });
  await bottone.click();
  await expect(home.locator('.sn-confirm-host')).toBeVisible({ timeout: 8_000 });
  await home.evaluate(() => window.SN_CONFIRM_UI._test.click('cancel'));
  await expect.poll(async () => (await oggi(app))?.conferme?.CANCELLA_PAGINE || null, { timeout: 8_000 }).not.toBeNull();
  const conferme = Object.keys((await oggi(app)).conferme.CANCELLA_PAGINE);
  expect(conferme).toHaveLength(1);
  const [livello, stato, costo, perimetro, origine, risposta, esito] = conferme[0].split('|');
  expect({ livello, costo, perimetro, origine, esito }).toEqual({ livello: 'default', costo: '3', perimetro: 'dentro', origine: 'chat', esito: 'rifiutata' });
  expect(['chiede', 'conferma']).toContain(risposta);
  expect(['pulito', 'contaminato']).toContain(stato);
});

test('«Cerca nel filo» conta l’apertura del pannello e la chiusura senza scelta, mai cosa si cerca', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const home = await homeDi(app);
  const campo = home.locator('#cercaInput');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await campo.fill('zanzibar quattro');
  await expect(home.locator('#cercaRisultati')).toBeVisible({ timeout: 8_000 });
  await campo.press('Escape');
  await expect(home.locator('#cercaRisultati')).toBeHidden();
  await expect.poll(async () => (await oggi(app))?.ricerche?.['cerca-filo'] || null, { timeout: 8_000 }).toEqual({ aperte: 1, scelte: {}, posizioni: {}, vuote: 1 });
  expect(JSON.stringify(await statoContatori(app))).not.toContain('zanzibar');
});

test('il correttore conta le proposte mostrate, accettate e ignorate, per tipo e modello, mai la parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  // Il controllo rapido finto segna come errore ogni pezzo di ERRORI che trova nel testo nuovo (come tests/correttore.spec.mjs):
  // pezzi di più parole, che cambiano in testa e in coda, così il segno resta una frase.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: true },
    });
    const M = globalThis.SN_ESTERNO.marcature('TESTO_IN_PAGINA');
    // Le regole stanno nel system, il testo nuovo imbustato dentro <testo_nuovo> del messaggio dell'utente (#1580).
    const tag = (t, nome) => {
      const a = t.indexOf(`<${nome}>\n`);
      const b = t.indexOf(`</${nome}>`, a);
      if (a < 0 || b < 0) return '';
      const dentro = t.slice(a, b);
      const i = dentro.indexOf(M.inizio);
      return i < 0 ? '' : dentro.slice(i + M.inizio.length + 1, dentro.indexOf(M.fine) - 1);
    };
    const ERRORI = { 'ho andato al': 'sono andata alla', 'le ragazzo': 'i ragazzi' };
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto/correttore', provider: 'openrouter', costEur: 0, usage: {} });
      if (!String(messages[0].content).includes('Sei il controllo rapido')) return fine('[][][][nessuno]');
      const nuovo = tag(t, 'testo_nuovo');
      const righe = Object.entries(ERRORI).filter(([p]) => nuovo.includes(p)).map(([p, c]) => `[${p}][${c}][x][errore]`);
      return fine(righe.join('\n') || '[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:20px">
<textarea id="ta" lang="it" style="display:block;width:900px;height:300px;font:18px monospace"></textarea></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ta').click();
  await page.keyboard.type('oggi ho andato al mare con le ragazzo e basta ');
  const segno = (testo) => page.locator('.sn-spell-overlay .sn-errore:not(.sn-dubbio)', { hasText: testo });
  await expect(segno('ho andato al')).toHaveCount(1, { timeout: 8000 });
  await expect(segno('le ragazzo')).toHaveCount(1, { timeout: 8000 });
  const frase = async () => Object.entries((await oggi(app))?.correttore?.frase || {});
  await expect.poll(async () => (await frase()).map(([m, c]) => [m, c[0]]), { timeout: 5000 }).toEqual([['finto/correttore', 2]]);

  // La prima si accetta dal tasto destro: la correzione in cima.
  const box = await riquadroDelSegno(segno('ho andato al'));
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  const riga = menuDi(page).locator('.sn-menu-correction-main', { hasText: 'sono andata alla' });
  await expect(riga).toBeVisible({ timeout: 8000 });
  await riga.click();
  await expect(page.locator('#ta')).toHaveValue(/sono andata alla/);
  await expect.poll(async () => (await frase())[0]?.[1]?.[1] || 0, { timeout: 5000 }).toBe(1);
  // Disfatta subito con la tastiera: un annullo della correzione.
  await page.locator('#ta').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await oggi(app))?.annullati?.correzione || 0, { timeout: 5000 }).toBe(1);
  // La seconda la sistema chi scrive, e sparisce senza una scelta: è ignorata.
  await page.evaluate(() => { const ta = document.getElementById('ta'); ta.value = ta.value.replace('le ragazzo', 'i ragazzi'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.keyboard.type(' ');
  await expect.poll(async () => (await frase())[0]?.[1]?.[3] || 0, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  const tutto = JSON.stringify(await statoContatori(app));
  expect(tutto).not.toContain('andat');
  expect(tutto).not.toContain('ragazz');
});

test('la barra laterale e il box del tasto destro contano l’apertura, la scelta con la sua posizione e la chiusura senza scelta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0;padding:40px;height:1400px"><p id="p">Clic destro qui.</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await barra.locator('#nav .ico[data-id="reload"]').click();
  await expect.poll(async () => quante((await oggi(app))?.ricerche?.['barra-laterale']?.posizioni), { timeout: 8_000 }).toBe(1);
  await comandaBarra(app, 'chiudi');
  await comandaBarra(app, 'clic');
  await comandaBarra(app, 'chiudi');
  await expect.poll(async () => (await oggi(app))?.ricerche?.['barra-laterale']?.vuote || 0, { timeout: 8_000 }).toBe(1);
  let b = (await oggi(app)).ricerche['barra-laterale'];
  expect([b.aperte, quante(b.scelte)], 'due aperture, una scelta').toEqual([2, 1]);

  // Il box del tasto destro: chiuso con Esc senza scegliere, poi riaperto per una voce.
  await page.locator('#p').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.superficie.keyboard.press('Escape');
  await expect(menu.principale).toBeHidden({ timeout: 8_000 });
  await expect.poll(async () => (await oggi(app))?.ricerche?.['tasto-destro']?.vuote || 0, { timeout: 8_000 }).toBe(1);
  await page.locator('#p').click({ button: 'right' });
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Aiuto').first().click();
  await expect.poll(async () => quante((await oggi(app))?.ricerche?.['tasto-destro']?.posizioni), { timeout: 8_000 }).toBe(1);
  b = (await oggi(app)).ricerche['tasto-destro'];
  expect([b.aperte, quante(b.scelte), b.vuote]).toEqual([2, 1, 1]);
});

// I menu dell'ingranaggio e «App» sono finestre di popup-menu.js: si sceglie la voce come la sceglie chi usa Filo.
async function sceltaNelMenu(app, shell, bottone, voce) {
  await shell.evaluate((id) => document.getElementById(id).click(), bottone);
  const menuWin = await menuAperto(app, { tetto: 4_000 });
  expect(menuWin, 'il menu deve aprirsi').toBeTruthy();
  await menuWin.locator('.item', { hasText: voce }).first().click();
}

test('la stessa azione conta da ogni strada: l’Editor dal menu «App», la cronologia, Salva per dopo da tastiera', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await sceltaNelMenu(app, shell, 'nav-apps', 'Editor');
  await expect.poll(async () => (await oggi(app))?.azioni?.editor?.n || 0, { timeout: 10_000 }).toBe(1);
  expect(quante((await oggi(app)).azioni.editor.fine), 'l’Editor fino alla pagina caricata').toBe(1);
  const editor = await trovaPagina(app, (u) => u.startsWith('filo://editor/'));
  await editor.evaluate(() => chrome.runtime.sendMessage({ type: 'open_history' }));
  await expect.poll(async () => (await oggi(app))?.azioni?.history?.n || 0, { timeout: 10_000 }).toBe(1);

  const page = await testServer.openReady(openTab, '<!doctype html><title>da salvare</title><p>ciao</p>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    globalThis.__filoShortcuts.dispatch('save-for-later', win);
  });
  await expect.poll(async () => (await oggi(app))?.azioni?.['save-for-later']?.n || 0, { timeout: 10_000 }).toBe(1);
});

test('aprire una pagina di Filo si conta da ogni strada: Preferenze dall’ingranaggio, Download dalla home, Memorie', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await sceltaNelMenu(app, shell, 'nav-settings', 'Preferenze');
  await expect.poll(async () => (await oggi(app))?.azioni?.preferences?.n || 0, { timeout: 10_000 }).toBe(1);
  // La home apre le pagine di Filo col messaggio dei collegamenti: l'apertura della scheda la conta lo stesso.
  const home = await homeDi(app);
  await home.evaluate(() => chrome.runtime.sendMessage({ type: globalThis.SN_MSG.MSG.OPEN_URL, url: 'filo://downloads/downloads.html' }));
  await expect.poll(async () => (await oggi(app))?.azioni?.['downloads-list']?.n || 0, { timeout: 10_000 }).toBe(1);
  await sceltaNelMenu(app, shell, 'nav-apps', 'Memorie');
  await expect.poll(async () => (await oggi(app))?.azioni?.['filo-memory']?.n || 0, { timeout: 10_000 }).toBe(1);
  // La stessa pagina già aperta torna davanti: è un'azione, contata una volta per gesto.
  await sceltaNelMenu(app, shell, 'nav-settings', 'Preferenze');
  await expect.poll(async () => (await oggi(app))?.azioni?.preferences?.n || 0, { timeout: 10_000 }).toBe(2);
});

test('spenti dalle Preferenze di una finestra in incognito, i contatori restano spenti anche nella finestra normale', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_CONTATORI_MAIN.azione('reload').fine());
  await expect.poll(async () => Object.keys((await statoContatori(app)).ore).length, { timeout: 8_000 }).toBeGreaterThan(0);
  await shell.evaluate(() => window.filoShell.openIncognito());
  const incog = await trovaPagina(app, (u) => u.includes('incognito=1'), 15_000);
  await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1', null, { timeout: 10000 });
  await incog.evaluate(() => window.filoShell.tabs.open('filo://preferences/preferences.html'));
  const prefs = await trovaPagina(app, (u) => u.startsWith('filo://preferences'));
  const interruttore = prefs.locator('#contatoriAttivi');
  await expect(interruttore).toBeChecked({ timeout: 10_000 });
  await interruttore.evaluate((el) => { el.scrollIntoView(); el.click(); });
  await expect(interruttore).not.toBeChecked();
  // Sul disco, per tutte le finestre: quello che aspettava si butta, e la finestra normale non conta più.
  await expect.poll(async () => (await impostazioni(app))?.contatori?.attivi, { timeout: 8_000 }).toBe(false);
  await expect.poll(async () => Object.keys((await statoContatori(app)).ore).length, { timeout: 8_000 }).toBe(0);
  await app.evaluate(() => globalThis.SN_CONTATORI_MAIN.azione('reload').fine());
  await new Promise((r) => setTimeout(r, 800));
  expect(await app.evaluate(() => globalThis.SN_CONTATORI_MAIN.accesi())).toBe(false);
  expect(Object.keys((await statoContatori(app)).ore)).toEqual([]);
});

const annullatiOggi = async (app) => (await oggi(app))?.annullati || {};

test('Ctrl+Z conta l’annullo di una correzione di Filo, non quello di ciò che si è scritto dopo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => { await globalThis.chrome.storage.local.set({ sn_autocorrect: { perchè: 'perché' } }); });
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px"><textarea id="t" style="width:500px;height:120px;font-size:18px"></textarea><textarea id="u" style="width:500px;height:120px;font-size:18px"></textarea></body></html>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  // Scrive ancora dopo la correzione, e disfa la sua frase: la correzione resta, e non è un annullo di Filo.
  await page.locator('#t').click();
  await page.keyboard.type('perchè ', { delay: 30 });
  await expect.poll(() => page.locator('#t').inputValue(), { timeout: 8_000 }).toBe('perché ');
  await page.waitForTimeout(600);
  await page.keyboard.type('scrivo ancora una frase mia', { delay: 20 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+Z');
  await expect.poll(() => page.locator('#t').inputValue()).toContain('perché');
  await page.waitForTimeout(1200);
  expect(await annullatiOggi(app)).toEqual({});
  // Disfa la correzione appena fatta: questo sì.
  await page.locator('#u').click();
  await page.keyboard.type('perchè ', { delay: 30 });
  await expect.poll(() => page.locator('#u').inputValue(), { timeout: 8_000 }).toBe('perché ');
  await page.keyboard.press('Control+Z');
  await expect.poll(() => page.locator('#u').inputValue()).not.toBe('perché ');
  await expect.poll(() => annullatiOggi(app), { timeout: 8_000 }).toEqual({ 'correzione-automatica': 1 });
});

test('Ctrl+Z col cursore nella casella vuota della chat, subito dopo un’azione di Filo, è il suo annullo', async ({ app }) => {
  test.setTimeout(60_000);
  const home = await homeDi(app);
  await home.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 }).catch(() => {});
  const tipo = await app.evaluate(() => Object.keys(globalThis.SN_ACTION_LEVELS.REGISTRY)[0]);
  await app.evaluate((_e, t) => globalThis.SN_CONTATORI_MAIN.azioneDiFilo(t, []), tipo);
  await home.locator('#input').click();
  await home.locator('#input').fill('');
  await home.keyboard.press('Control+Z');
  await expect.poll(() => annullatiOggi(app), { timeout: 8_000 }).toEqual({ [tipo]: 1 });
  // Con qualcosa scritto, Ctrl+Z disfa il testo: non è un annullo di Filo.
  await app.evaluate((_e, t) => globalThis.SN_CONTATORI_MAIN.azioneDiFilo(t, []), tipo);
  await home.locator('#input').fill('una domanda');
  await home.keyboard.press('Control+Z');
  await home.waitForTimeout(800);
  expect(await annullatiOggi(app)).toEqual({ [tipo]: 1 });
});

test('una spiegazione preparata e riaperta due volte conta un anticipo aperto, non due', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitoreCheConta(app);
  const page = await testServer.openReady(openTab, PAGINA_PAROLE, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const p = await puntoDellaParola(page, 'p2', 'fotosintesi');
  await page.mouse.dblclick(p.x, p.y);
  await expect.poll(() => app.evaluate(() => globalThis.__chiamate.spiega), { timeout: 5000 }).toBe(1);
  await expect.poll(async () => (await oggi(app))?.anticipi?.explain, { timeout: 5000 }).toEqual({ preparati: 1, aperti: 0 });
  for (let i = 0; i < 2; i++) {
    await page.mouse.click(p.x, p.y, { button: 'right' });
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu .sn-menu-inline-explain')).toContainText('Spiegazione di prova', { timeout: 10_000 });
    await menu.superficie.keyboard.press('Escape');
    await expect(menu.principale).toBeHidden({ timeout: 8_000 });
  }
  expect(await app.evaluate(() => globalThis.__chiamate.spiega)).toBe(1);
  await expect.poll(() => usiOggi(app, 'explain'), { timeout: 5000 }).toBe(2);
  expect((await oggi(app)).anticipi.explain).toEqual({ preparati: 1, aperti: 1 });
});

test('le conferme dell’Aiuto nella pagina e dei pannelli contano la risposta calcolata e quello che sceglie la persona', async ({ app }) => {
  test.setTimeout(60_000);
  const home = await homeDi(app);
  // L'Aiuto chiede prima di un'azione cara: la chiave della domanda torna alla pagina, che manda la scelta.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }); });
  const d = await home.evaluate(() => chrome.runtime.sendMessage({ type: globalThis.SN_MSG.MSG.FILO_DECIDI_PAGINA, costo: 3, campo: 'web' }));
  expect(['chiede', 'conferma']).toContain(d.risposta);
  expect(d.conferma).toMatch(/^pagina:[0-9a-f]{16}$/);
  await home.evaluate((k) => chrome.runtime.sendMessage({ type: globalThis.SN_MSG.MSG.CONTATORI_EVENTO, misura: 'conferma', chiave: k, esito: 'rifiutata' }), d.conferma);
  await expect.poll(async () => Object.keys((await oggi(app))?.conferme?.AZIONE_PAGINA || {}), { timeout: 8_000 }).toHaveLength(1);
  const [chiave, n] = Object.entries((await oggi(app)).conferme.AZIONE_PAGINA)[0];
  expect(chiave.split('|').slice(0, 2)).toEqual(['conservativo', 'pulito']);
  expect(chiave.split('|').pop()).toBe('rifiutata');
  expect(n).toBe(1);
  // Il pannello del riordino: la domanda la fa lui, la risposta arriva con la sua chiave.
  await app.evaluate(() => globalThis.SN_CONTATORI_MAIN.confermaChiesta('pannello:PULISCI_TAB', 'PULISCI_TAB', { livello: 'default', stato: 'pulito', costo: 2, perimetro: 'dentro', origine: 'chat', risposta: 'chiede' }));
  await home.evaluate(() => chrome.runtime.sendMessage({ type: globalThis.SN_MSG.MSG.CONTATORI_EVENTO, misura: 'conferma', chiave: 'pannello:PULISCI_TAB', esito: 'approvata' }));
  await expect.poll(async () => (await oggi(app))?.conferme?.PULISCI_TAB, { timeout: 8_000 }).toEqual({ 'default|pulito|2|dentro|chat|chiede|approvata': 1 });
});

test('i menu di Filo sono pannelli dove si cerca: la scelta col suo posto, e la chiusura senza scelta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await sceltaNelMenu(app, shell, 'nav-settings', 'Preferenze');
  await expect.poll(async () => quante((await oggi(app))?.ricerche?.menu?.posizioni), { timeout: 10_000 }).toBe(1);
  await shell.evaluate(() => document.getElementById('nav-apps').click());
  const menuWin = await menuAperto(app, { tetto: 4_000 });
  expect(menuWin, 'il menu deve aprirsi').toBeTruthy();
  await menuWin.keyboard.press('Escape');
  await expect.poll(async () => (await oggi(app))?.ricerche?.menu?.vuote || 0, { timeout: 8_000 }).toBe(1);
  const m = (await oggi(app)).ricerche.menu;
  expect([m.aperte, quante(m.scelte)], 'due aperture, una scelta').toEqual([2, 1]);
});

test('Copia dal tasto destro è un’azione con la sua attesa, come le icone', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px"><p id="p" style="font-size:22px">Una frase da copiare.</p></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.locator('#p').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Copia').first().click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5_000 }).toContain('Una frase da copiare');
  await expect.poll(async () => (await oggi(app))?.azioni?.['copy-cut']?.n || 0, { timeout: 8_000 }).toBe(1);
  expect(quante((await oggi(app)).azioni['copy-cut'].fine)).toBe(1);
});

test('l’errore letto nella pagina Download si conta come quello della barra delle schede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const FILE = Buffer.from('%PDF-1.4\n% prova\n' + 'y'.repeat(2048));
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': FILE.length, 'Content-Disposition': 'attachment; filename="sparito.pdf"' });
    res.end(FILE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/sparito.pdf`;
    const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px"><a id="dl" href="${url}">Scarica</a></body>`);
    await page.locator('#dl').click();
    const voce = async () => (((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || []).find((it) => it.filename === 'sparito.pdf');
    await expect.poll(async () => (await voce())?.state || null, { timeout: 20_000 }).toBe('completed');
    const rec = await voce();
    const dl = await openTab('filo://downloads/downloads.html');
    await dl.waitForLoadState('domcontentloaded');
    const riga = dl.locator('.dl-item').first();
    await expect(riga).toBeVisible({ timeout: 10_000 });
    unlinkSync(rec.savePath);
    await riga.click();
    await expect(dl.locator('#dl-flash')).toContainText(/non c[’']è più/i, { timeout: 8_000 });
    await expect.poll(async () => (await oggi(app))?.erroriVisti?.['avviso:file_non_aperto'] || 0, { timeout: 8_000 }).toBe(1);
  } finally {
    try { srv.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => srv.close(r));
  }
});

// Le voci che aprono una scheda finiscono con la pagina caricata: il motore di ricerca qui risponde dopo tre secondi.
test('Cerca e Cerca immagine dal tasto destro contano l’attesa fino alla pagina dei risultati, non fino al clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const svg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#c84"/></svg>');
  const page = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px"><p id="p" style="font-size:22px">Una frase da cercare.</p></body>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await app.evaluate(async ({ webContents }, url) => {
    const ses = webContents.getAllWebContents().find((w) => w.getURL() === url).session;
    ses.protocol.handle('https', async (req) => {
      if (!/(^|\.)google\.com$/.test(new URL(req.url).hostname)) return new Response('', { status: 404 });
      await new Promise((r) => setTimeout(r, 3000));
      return new Response('<!doctype html><title>risultati</title><p>risultati</p>', { headers: { 'content-type': 'text/html' } });
    });
  }, page.url());
  const caricata = (re) => app.evaluate(({ webContents }, src) => webContents.getAllWebContents()
    .some((w) => new RegExp(src).test(w.getURL()) && !w.isLoading()), re);
  const menu = menuDi(page);

  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await page.locator('#p').click({ button: 'right' });
  await expect(menu.principale).toBeVisible({ timeout: 8_000 });
  await menu.voce('Cerca').first().click();
  await expect.poll(() => caricata('google\\.com/search'), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await oggi(app))?.azioni?.['search-web']?.n || 0, { timeout: 8_000 }).toBe(1);
  expect(Object.keys((await oggi(app)).azioni['search-web'].fine)).toEqual(['s5']);

  const conImmagine = await testServer.openReady(openTab, `<!doctype html><body style="padding:40px"><img id="img" src="data:image/svg+xml,${svg}" width="120" height="80"></body>`);
  await conImmagine.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const menuImg = menuDi(conImmagine);
  await conImmagine.locator('#img').click({ button: 'right' });
  await expect(menuImg.principale).toBeVisible({ timeout: 8_000 });
  await menuImg.voce('Cerca immagine').first().click();
  await expect.poll(() => caricata('lens\\.google\\.com'), { timeout: 15_000 }).toBe(true);
  await expect.poll(async () => (await oggi(app))?.azioni?.['search-image']?.n || 0, { timeout: 8_000 }).toBe(1);
  expect(Object.keys((await oggi(app)).azioni['search-image'].fine)).toEqual(['s5']);
  expect((await oggi(app)).azioni['search-web'].n, 'nessuna misura doppia').toBe(1);
});
