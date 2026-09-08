// #520 giro 2 — i tre rilievi della prima verifica.
//
//  (A) Nella chat della home l'attesa non aveva né cronometro né via d'uscita:
//      il tasto d'invio restava spento fino alla scadenza del servizio, cioè
//      minuti. Nei mazzi c'era già tutto.
//  (B) Nella chat dei mazzi «Interrompi» premuto nei primi istanti liberava la
//      chat ma non fermava la richiesta al modello, che continuava a costare.
//  (C) Nella chat dei mazzi, scrivere e premere Invio mentre Filo pensa non
//      produceva niente: nessun segno che il campo fosse momentaneamente sordo.
//
// Ogni test asserisce il successo dal punto di vista dell'utente e senza il fix
// è rosso.

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

// Provider che NON risponde mai al primo turno (router che accetta e poi tace)
// e risponde subito ai successivi. Registra se l'annullamento è arrivato fino
// alla chiamata: senza, si pagherebbero token per una risposta buttata.
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
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, signal, onReasoning }) => {
      globalThis.__chiamate += 1;
      if (globalThis.__chiamate > 1) {
        return {
          text: JSON.stringify({ text: 'Eccomi, ci sono.', reply: 'Eccomi, ci sono.', actions: [] }),
          model: attempts[0].model, provider: attempts[0].provider, usage: {},
        };
      }
      // Un pezzo di ragionamento arriva, poi il servizio tace: è il caso vero,
      // e lascia qualcosa da leggere nel blocco di attività.
      try { onReasoning && onReasoning('Sto valutando la domanda. '); } catch (_) {}
      return new Promise((_res, rej) => {
        const fine = () => {
          globalThis.__annullato = true;
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          rej(e);
        };
        if (!signal) return;             // nessun segnale: appeso per sempre
        if (signal.aborted) { fine(); return; }
        signal.addEventListener('abort', fine, { once: true });
      });
    };
  }, action);
}

// (A) — la chat della home
test('home: l\'attesa si vede, si ferma, e la chat torna subito libera', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await providerAppeso(app, 'FILO_CHAT');

  await page.locator('#input').fill('ciao filo, come stai?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-activity')).toBeVisible({ timeout: 15_000 });

  // Si legge da quanto si sta aspettando.
  await expect(page.locator('[data-attesa]')).toHaveText(/\d+s/, { timeout: 20_000 });
  // E c'è una via d'uscita.
  const stop = page.locator('.dash-stop[data-stop-chat]');
  await expect(stop).toBeVisible();
  await stop.click();

  // La conversazione dice cosa è successo, senza spacciarlo per un guasto.
  const ultima = page.locator('.dash-bubble-filo').last();
  await expect(ultima).toContainText('Attesa interrotta');
  await expect(ultima).not.toContainText(/errore|non ha funzionato/i);
  // Il blocco di attività lo dice a sua volta, e non è marcato come fallito:
  // non è andato storto niente, è stato l'utente a fermare.
  await expect(page.locator('.dash-activity-label')).toContainText('Attesa interrotta');
  await expect(page.locator('.dash-activity[data-failed="1"]')).toHaveCount(0);
  // Il ragionamento già arrivato resta leggibile: aiuta a capire cosa stava
  // tentando prima che il servizio smettesse di rispondere.
  await page.locator('.dash-activity-head').first().click();
  await expect(page.locator('.dash-activity-reasoning')).toContainText('Sto valutando');
  // Il cronometro e il bottone se ne vanno con l'attesa.
  await expect(page.locator('.dash-stop[data-stop-chat]')).toHaveCount(0);

  // L'annullamento è arrivato fino alla chiamata al modello.
  await expect.poll(() => app.evaluate(() => globalThis.__annullato), { timeout: 10_000 }).toBe(true);

  // E soprattutto: la chat è di nuovo libera e il messaggio dopo riceve risposta.
  await expect(page.locator('#sendBtn')).toBeEnabled();
  await page.locator('#input').fill('e adesso?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('ci sono', { timeout: 30_000 });
});

test('home: «Riprova» dopo un\'interruzione rimanda lo stesso messaggio', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await providerAppeso(app, 'FILO_CHAT');

  await page.locator('#input').fill('che ore sono?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-stop[data-stop-chat]')).toBeVisible({ timeout: 15_000 });
  await page.locator('.dash-stop[data-stop-chat]').click();

  const riprova = page.locator('.dash-action-btn', { hasText: 'Riprova' });
  await expect(riprova).toBeVisible();
  await riprova.click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('ci sono', { timeout: 30_000 });
  // Il messaggio non è stato duplicato nella conversazione.
  await expect(page.locator('.dash-bubble-user', { hasText: 'che ore sono?' })).toHaveCount(1);
});

test('home: Esc smette di aspettare come il bottone', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await providerAppeso(app, 'FILO_CHAT');

  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-stop[data-stop-chat]')).toBeVisible({ timeout: 15_000 });
  await page.locator('#input').press('Escape');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Attesa interrotta');
  await expect(page.locator('#sendBtn')).toBeEnabled();
});

// (B) — fermare nei primi istanti ferma davvero
test('mazzi: Interrompi nei primi istanti annulla davvero la chiamata al modello', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await providerAppeso(app, 'DECKS_CHAT');
  // Il contesto del mazzo ci mette qualche secondo (cache fredda, archivio
  // lento): è la finestra in cui il turno non era ancora interrompibile.
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

  // Il modello non è stato chiamato affatto, oppure la chiamata è stata annullata.
  await page.waitForTimeout(8000);
  const stato = await app.evaluate(() => ({
    chiamate: globalThis.__chiamate, annullato: globalThis.__annullato,
  }));
  expect(stato.chiamate === 0 || stato.annullato,
    `chiamate=${stato.chiamate} annullato=${stato.annullato}: la richiesta è partita e nessuno l'ha fermata`).toBeTruthy();
});

// (C) — Invio a chat occupata
test('mazzi: Invio mentre Filo pensa dà un riscontro e non perde il testo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await providerAppeso(app, 'DECKS_CHAT');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  await page.fill('#chatInput', 'prima domanda');
  await page.press('#chatInput', 'Enter');
  const attesa = page.locator('.dk-msg-pending');
  await expect(attesa).toBeVisible();

  await page.fill('#chatInput', 'ci sei?');
  await page.press('#chatInput', 'Enter');
  // La bolla in attesa si accende: è lei che occupa la chat, ed è lì la via d'uscita.
  await expect(attesa).toHaveClass(/dk-nudge/);
  // Il testo scritto non si perde.
  await expect(page.locator('#chatInput')).toHaveValue('ci sei?');
  // E non è partito un secondo turno alle spalle dell'utente.
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);

  // Esc esce dall'attesa come il bottone.
  await page.press('#chatInput', 'Escape');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Attesa interrotta');
  // Adesso lo stesso Invio manda davvero.
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-user')).toHaveCount(2);
});

// Guardata: la riga dell'attesa nella home, chiaro e scuro.
for (const tema of ['light', 'dark']) {
  test(`home: la riga dell'attesa si legge bene (tema ${tema})`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await app.evaluate(async (t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    await providerAppeso(app, 'FILO_CHAT');
    await page.reload();
    await expect(page.locator('#input')).toBeVisible();

    await page.locator('#input').fill('raccontami qualcosa di interessante');
    await page.locator('#sendBtn').click();
    await expect(page.locator('[data-attesa]')).toHaveText(/\d+s/, { timeout: 20_000 });
    await page.screenshot({ path: `tests/.shots/520-home-attesa-${tema}.png` });

    // Il bottone resta dentro la colonna della conversazione.
    const b = await page.locator('.dash-stop[data-stop-chat]').boundingBox();
    const col = await page.locator('#bubbles').boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(col.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(col.x + col.width + 1);
  });
}
