// Feedback #360 — due problemi nella chat della nuova scheda:
//
//   1. "il fetch failed": quando la chiamata al modello fallisce per un guasto
//      di rete, in chat arrivava il messaggio grezzo dell'eccezione ("fetch
//      failed") — tre volte di fila, e anche alla domanda "che significa?".
//      Deve arrivare una frase che dice cosa non ha funzionato e cosa fare.
//
//   2. "NON ha proposto un feedback (lo ha fatto solo dopo che gli ho chiesto di
//      farlo)": quando Filo ammette di non poter fare una cosa (nel caso reale:
//      "quanti crediti ho?"), la segnalazione agli sviluppatori deve comparire
//      GIÀ SCRITTA nella stessa risposta, col tasto di conferma — senza che
//      l'utente debba chiederla.
//
// Entrambi asseriscono il SUCCESSO del comportamento voluto:
//   - il primo che in bolla c'è la spiegazione (e che "fetch failed" NON c'è);
//   - il secondo che la proposta di segnalazione esiste e che, confermata,
//     spedisce davvero una segnalazione che cita cosa l'utente aveva chiesto.
// Senza il fix il primo trova "fetch failed" nudo e il secondo non trova
// nessun tasto di conferma: entrambi rossi.

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

// Chiave finta + modello noto: serve solo a far arrivare la richiesta al
// provider (che poi stubbiamo), non a chiamare nessuno davvero.
async function useFakeKey(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

test('rete assente: la chat spiega il problema invece di mostrare "fetch failed"', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await useFakeKey(app);

  // Provider che fallisce come fallisce Node quando la rete non c'è.
  await app.evaluate(() => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__restoreNet = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async () => {
      throw new TypeError('fetch failed');
    };
  });

  await page.locator('#input').fill('quanti crediti ho?');
  await page.locator('#sendBtn').click();

  const bubble = page.locator('.dash-bubble-filo').last();
  await expect(bubble).toBeVisible({ timeout: 20_000 });
  // La bolla dice all'utente COSA controllare…
  await expect(bubble).toContainText(/rete/i, { timeout: 20_000 });
  await expect(bubble).toContainText(/connessione/i);
  await expect(bubble).toContainText(/riprova/i);
  // …e non il messaggio grezzo dell'eccezione.
  await expect(page.locator('#bubbles')).not.toContainText('fetch failed');

  await page.screenshot({ path: 'tests/.shots/360-rete-assente.png' }).catch(() => {});

  // La bolla dice "riprova": il tasto deve esserci, altrimenti l'utente
  // dovrebbe riscrivere tutto a mano (stesso "Riprova" della pagina d'errore
  // di una scheda).
  const retry = bubble.locator('.dash-action-btn', { hasText: /Riprova/i });
  await expect(retry).toBeVisible({ timeout: 5_000 });

  // Tornata la rete, "Riprova" rimanda lo STESSO messaggio e la risposta arriva.
  await app.evaluate(() => {
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({ text: 'Rete tornata: eccomi.', actions: [] });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
  await retry.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Rete tornata: eccomi.' }))
    .toBeVisible({ timeout: 20_000 });
  // La bolla d'errore sparisce: il tentativo è ricominciato, non accumulato.
  await expect(page.locator('#bubbles')).not.toContainText(/Problema di rete/i);
  // Il messaggio è stato rimandato una sola volta, non duplicato in chat.
  await expect(page.locator('.dash-bubble-user', { hasText: 'quanti crediti ho?' })).toHaveCount(1);

  await app.evaluate(() => { try { globalThis.__restoreNet?.(); } catch (_) {} });
});

test('Filo ammette una mancanza: propone lui la segnalazione, senza che gliela si chieda', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await useFakeKey(app);

  // Il modello risponde ammettendo di non avere il dato e NON emette nessuna
  // azione: è esattamente la situazione del feedback (#360) — prima qui la
  // conversazione finiva lì.
  await app.evaluate(() => {
    const origProv = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    const origSubmit = globalThis.SN_FEEDBACK.submit;
    globalThis.__restoreGap = () => {
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = origProv;
      globalThis.SN_FEEDBACK.submit = origSubmit;
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({
        text: 'Non ho accesso al saldo dei crediti: puoi vederlo in Opzioni, alla voce Crediti e consumi.',
        actions: [],
      });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    // Nessuna scrittura su Firestore nei test: registriamo cosa sarebbe partito.
    globalThis.__submitted = [];
    globalThis.SN_FEEDBACK.submit = async (payload) => {
      globalThis.__submitted.push(payload);
      return { id: `fb-test-${globalThis.__submitted.length}` };
    };
  });

  // Il popup di conferma è irraggiungibile via DOM (shadow root chiuso, scelta
  // di sicurezza): per proseguire oltre il consenso sostituiamo il modulo di
  // conferma e catturiamo il testo che l'utente avrebbe letto. Va messo PRIMA
  // dell'invio perché il popup si apre da sé appena la proposta compare (#414).
  await page.evaluate(() => {
    window.__confirmSeen = [];
    window.SN_CONFIRM_UI = {
      confirm: async (opts) => { window.__confirmSeen.push(opts && opts.text); return true; },
      confirmTyped: async (opts) => { window.__confirmSeen.push(opts && opts.text); return true; },
    };
  });

  await page.locator('#input').fill('quanti crediti ho?');
  await page.locator('#sendBtn').click();

  // ── L'assert centrale: la segnalazione è già lì, pronta da confermare ──────
  const proposal = page.locator('.dash-bubble-actions .dash-action-btn-primary', {
    hasText: /Inviare questo feedback/i,
  });
  await expect(proposal).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'tests/.shots/360-proposta-feedback.png' }).catch(() => {});

  // #414 — nessun click: la richiesta di conferma si presenta DA SOLA, con
  // l'anteprima citata qui sotto. Il chip resta solo come ripiego per chi annulla.
  // L'anteprima mostrata all'utente cita la SUA richiesta: è ciò che rende la
  // segnalazione utile (e ciò che gli permette di decidere se mandarla).
  await expect.poll(async () => page.evaluate(() => (window.__confirmSeen || []).join('\n')), {
    timeout: 10_000, intervals: [100],
  }).toMatch(/quanti crediti ho/i);

  // Confermata, la segnalazione parte davvero, col testo che l'utente ha letto.
  await expect.poll(async () => app.evaluate(() => (globalThis.__submitted || []).map((p) => p.text).join('\n')), {
    timeout: 10_000, intervals: [200],
  }).toMatch(/quanti crediti ho/i);

  // Feedback anonimo generico: NON deve partire in parallelo a quello che
  // l'utente ha autorizzato (una sola segnalazione per lo stesso buco).
  const sources = await app.evaluate(() => (globalThis.__submitted || []).map((p) => String(p.clientId || '')));
  expect(sources.filter((c) => c.startsWith('auto:'))).toHaveLength(0);

  // Il tasto conferma l'avvenuto invio (feedback all'azione dell'utente).
  await expect(proposal).toContainText('✓', { timeout: 10_000 });

  await app.evaluate(() => { try { globalThis.__restoreGap?.(); } catch (_) {} });
});

// #419 — il "buco muto": qui Filo NON ammette niente. La funzione esiste (è nel
// manifesto delle capacità), l'utente chiede di farla, e l'assistente si limita
// a spiegargli dove cliccare. Prima la segnalazione dipendeva solo dal fatto che
// il modello si ricordasse di emetterla: se se ne dimenticava — come qui, dove
// la risposta non contiene NESSUNA azione e nessuna ammissione — non succedeva
// niente e il buco restava invisibile. Senza la rete di sicurezza questo test è
// rosso: non compare nessun tasto di conferma e nessuna segnalazione parte.
test('Filo spiega a mano una cosa che sa fare: la segnalazione arriva lo stesso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await useFakeKey(app);

  await app.evaluate(() => {
    const origProv = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    const origSubmit = globalThis.SN_FEEDBACK.submit;
    globalThis.__restoreMute = () => {
      globalThis.SN_PROVIDERS.streamCompleteWithFallback = origProv;
      globalThis.SN_FEEDBACK.submit = origSubmit;
    };
    // Risposta indistinguibile da una riuscita: nessun "non posso", nessuna
    // azione — solo indicazioni su dove cliccare.
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const text = JSON.stringify({
        text: 'Per andare a schermo intero clicca l’icona con le due frecce in alto a '
          + 'destra nella barra di Filo, oppure premi F11: la finestra occupa tutto lo schermo.',
        actions: [],
      });
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.__submitted = [];
    globalThis.SN_FEEDBACK.submit = async (payload) => {
      globalThis.__submitted.push(payload);
      return { id: `fb-test-${globalThis.__submitted.length}` };
    };
  });

  await page.evaluate(() => {
    window.__confirmSeen = [];
    window.SN_CONFIRM_UI = {
      confirm: async (opts) => { window.__confirmSeen.push(opts && opts.text); return true; },
      confirmTyped: async (opts) => { window.__confirmSeen.push(opts && opts.text); return true; },
    };
  });

  await page.locator('#input').fill('metti Filo a schermo intero');
  await page.locator('#sendBtn').click();

  const proposal = page.locator('.dash-bubble-actions .dash-action-btn-primary', {
    hasText: /Inviare questo feedback/i,
  });
  await expect(proposal).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'tests/.shots/419-buco-muto.png' }).catch(() => {});

  // L'anteprima dice il punto: la cosa Filo la sa fare, è l'assistente che non
  // l'ha fatta. È la differenza con il caso "non esiste".
  await expect.poll(async () => page.evaluate(() => (window.__confirmSeen || []).join('\n')), {
    timeout: 10_000, intervals: [100],
  }).toMatch(/schermo intero/i);

  // Confermata, parte davvero, citando cosa l'utente aveva chiesto.
  await expect.poll(async () => app.evaluate(() => (globalThis.__submitted || []).map((p) => p.text).join('\n')), {
    timeout: 10_000, intervals: [200],
  }).toMatch(/schermo intero/i);

  // Una sola segnalazione per lo stesso buco: quella anonima non parte in parallelo.
  const sources = await app.evaluate(() => (globalThis.__submitted || []).map((p) => String(p.clientId || '')));
  expect(sources.filter((c) => c.startsWith('auto:'))).toHaveLength(0);

  await app.evaluate(() => { try { globalThis.__restoreMute?.(); } catch (_) {} });
});
