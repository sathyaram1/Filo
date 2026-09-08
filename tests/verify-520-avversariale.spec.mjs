// #520 — verifica avversariale: «si è bloccato e non vedo risposta nonostante
// sia passato molto tempo».
//
// La causa è una sola: un'attesa che non finisce mai e da cui non si esce.
// Le porte che ci portano sono più di una — la chat dei mazzi (dove il sintomo
// è stato segnalato), la chat della home, il parere sulla carta, l'archivio
// delle carte. Qui si prova ogni porta e si guarda la stessa cosa da utente:
// posso vedere quanto sto aspettando? posso smettere di aspettare? se non
// faccio niente, prima o poi l'attesa finisce da sola con qualcosa da leggere?

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Modello configurato + provider che NON risponde mai (router che accetta la
// connessione e poi tace). Rispetta il signal: se qualcuno annulla, si sa.
async function providerAppeso(app, action) {
  await app.evaluate(async (act) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS[act]]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chiamate = 0;
    globalThis.__annullato = false;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ signal }) => {
      globalThis.__chiamate += 1;
      return new Promise((_res, rej) => {
        const fine = () => {
          globalThis.__annullato = true;
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          rej(e);
        };
        if (!signal) return;
        if (signal.aborted) { fine(); return; }
        signal.addEventListener('abort', fine, { once: true });
      });
    };
  }, action);
}

// ── Porta 1: la chat della home ────────────────────────────────────────────
// È il primo posto in cui un utente nuovo scrive a Filo. Se il modello tace,
// l'utente deve poter capire che sta ancora aspettando e poter smettere —
// esattamente come nella chat dei mazzi.
test('home: un\'attesa senza risposta si vede e si può fermare', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await providerAppeso(app, 'FILO_CHAT');

  await page.locator('#input').fill('ciao filo, come stai?');
  await page.locator('#sendBtn').click();

  // La chat è occupata: la bolla d'attesa c'è.
  await expect(page.locator('.dash-activity')).toBeVisible({ timeout: 15_000 });

  // Dopo venti secondi di silenzio l'utente vuole due cose. Prima: sapere da
  // quanto sta aspettando (un cronometro, come nei mazzi).
  await page.waitForTimeout(20_000);
  const testo = await page.locator('.dash-activity').innerText();
  console.log('[#520] blocco di attività dopo 20s:', JSON.stringify(testo));

  // Seconda, e più importante: una via d'uscita. Un comando qualsiasi che
  // smetta di aspettare e liberi la chat.
  const stop = page.locator('.dash-activity button, .dash-bubble button')
    .filter({ hasText: /interrompi|ferma|annulla|smetti/i });
  const nStop = await stop.count();
  const inviaBloccato = await page.locator('#sendBtn').isDisabled();
  console.log('[#520] uscite disponibili:', nStop, '· invio bloccato:', inviaBloccato);

  expect(nStop, 'nessun modo di smettere di aspettare nella chat della home').toBeGreaterThan(0);
});

// ── Porta 2: la chat dei mazzi, sotto stress ───────────────────────────────
test('mazzi: Interrompi due volte, e riscrivere subito dopo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await providerAppeso(app, 'DECKS_CHAT');
  // Il secondo turno risponde: serve per vedere che la chat si è liberata.
  await app.evaluate(() => {
    const appeso = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (opts) => {
      if (globalThis.__chiamate >= 1) {
        return {
          text: JSON.stringify({ reply: 'Eccomi, ci sono.' }),
          model: opts.attempts[0].model, provider: opts.attempts[0].provider, usage: {},
        };
      }
      return appeso(opts);
    };
  });

  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  await page.fill('#chatInput', 'che ne pensi?');
  await page.press('#chatInput', 'Enter');
  const stop = page.locator('[data-stop-chat]');
  await expect(stop).toBeVisible();

  // Doppio clic rapidissimo sullo stesso bottone: la seconda pressione non
  // deve rompere niente né lasciare la chat occupata.
  await stop.dblclick({ delay: 10 }).catch(() => {});
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Attesa interrotta');

  // E subito dopo si riscrive, senza aspettare: la chat è di nuovo libera.
  await page.fill('#chatInput', 'e adesso?');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('ci sono', { timeout: 20_000 });

  // Nessuna bolla fantasma: un'interrotta + una risposta.
  await expect(page.locator('.dk-msg-bot')).toHaveCount(2);
});

// ── Porta 3: fermare SUBITO ferma davvero la chiamata? ─────────────────────
// La promessa scritta nel bottone è «niente token spesi per una risposta che
// nessuno leggerà». Se l'utente preme Interrompi nei primi istanti — mentre il
// turno sta ancora raccogliendo il contesto — la chiamata al modello parte
// comunque e continua a costare.
test('mazzi: Interrompi nei primi istanti annulla davvero la chiamata', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await providerAppeso(app, 'DECKS_CHAT');
  // Il contesto delle carte ci mette qualche secondo (mazzo grande, cache
  // fredda, archivio lento): è la finestra in cui il turno non è ancora
  // registrato come interrompibile.
  await app.evaluate(() => {
    const orig = globalThis.SN_SCRYFALL.cards;
    globalThis.SN_SCRYFALL.cards = async (...a) => {
      await new Promise((r) => setTimeout(r, 4000));
      return orig.apply(globalThis.SN_SCRYFALL, a);
    };
  });

  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  await page.fill('#chatInput', 'valuta il mazzo');
  await page.press('#chatInput', 'Enter');
  const stop = page.locator('[data-stop-chat]');
  await expect(stop).toBeVisible();
  await page.waitForTimeout(600); // l'utente impaziente, subito
  await stop.click();
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Attesa interrotta');

  // La chiamata al modello parte lo stesso? E se parte, viene annullata?
  await page.waitForTimeout(8000);
  const stato = await app.evaluate(() => ({
    chiamate: globalThis.__chiamate, annullato: globalThis.__annullato,
  }));
  console.log('[#520] dopo Interrompi immediato:', JSON.stringify(stato));
  expect(stato.chiamate === 0 || stato.annullato,
    'la chiamata al modello è partita e non è stata annullata: token spesi per una risposta buttata').toBeTruthy();
});

// Stessa prova nella chat della home: lì non c'è nessun bottone per uscire,
// quindi l'unica speranza è che l'attesa finisca da sola.
test('home: senza toccare niente, l\'attesa finisce da sola con una frase', async ({ app, shell }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.FILO_AI_TETTO_MS, 'serve FILO_AI_TETTO_MS stretto');
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.fetch = (_url, opts) => new Promise((_res, rej) => {
      const s = opts && opts.signal;
      const fine = () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; rej(e); };
      if (!s) return;
      if (s.aborted) { fine(); return; }
      s.addEventListener('abort', fine, { once: true });
    });
  });

  await page.locator('#input').fill('ciao filo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity')).toBeVisible({ timeout: 15_000 });

  // Nessun clic: la chat deve tornare utilizzabile da sola.
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 90_000 });
  const bolle = await page.locator('.dash-bubble').last().innerText();
  console.log('[#520] home, frase finale:', JSON.stringify(bolle));
  expect(bolle).not.toMatch(/https?:|openrouter\.ai|AbortError|\bfetch\b/i);
});

// ── Porta 4: senza toccare niente, l'attesa finisce da sola ────────────────
// L'utente del feedback non ha premuto niente: ha aspettato «molto tempo».
// Qui il servizio AI accetta la connessione e poi tace per davvero (fetch
// appeso, percorso vero del provider): senza nessun clic, la chat deve finire
// l'attesa da sola e mostrare una frase leggibile.
// Serve FILO_AI_STALLO_MS/FILO_AI_TETTO_MS stretti: senza, l'attesa vera è di
// minuti e il test non aspetta tanto.
test('mazzi: se non tocco niente, l\'attesa finisce da sola con una frase', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  test.skip(!process.env.FILO_AI_TETTO_MS, 'serve FILO_AI_TETTO_MS stretto');
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    // Il router accetta e tace: la promessa non si risolve mai da sola.
    globalThis.__fetchChiamate = 0;
    globalThis.fetch = (_url, opts) => {
      globalThis.__fetchChiamate += 1;
      return new Promise((_res, rej) => {
        const s = opts && opts.signal;
        const fine = () => {
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          rej(e);
        };
        if (!s) return;
        if (s.aborted) { fine(); return; }
        s.addEventListener('abort', fine, { once: true });
      });
    };
  });

  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  await page.fill('#chatInput', 'che ne pensi del mazzo?');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('[data-stop-chat]')).toBeVisible();

  // Nessun clic: si aspetta e basta. La bolla deve smettere di «pensare».
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla).toContainText(/Non ha funzionato/, { timeout: 90_000 });
  const testo = await bolla.innerText();
  console.log('[#520] frase mostrata all\'utente:', JSON.stringify(testo));
  // Una frase per l'utente, non un codice tecnico né un endpoint.
  expect(testo).not.toMatch(/https?:|openrouter\.ai|AbortError|\bfetch\b/i);
  // E la chat è di nuovo libera.
  await expect(page.locator('[data-stop-chat]')).toHaveCount(0);
});
