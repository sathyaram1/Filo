// #536 — la chat della home: una risposta nata da roba scritta da altri non
// arriva all'utente finché un SECONDO modello non l'ha guardata.
//
// Cosa asserisce, dal punto di vista di chi usa Filo:
//  (A) turno che ha cercato sul web e torna con una risposta che spinge a dare
//      le credenziali → la bolla NON contiene quella risposta: contiene la riga
//      che dice cosa è stato fermato. E il testo non è nemmeno scorso in
//      diretta mentre veniva scritto.
//  (B) turno che non ha letto niente di nessuno → nessun secondo modello viene
//      chiamato, e la risposta arriva com'è. Il controllo non deve diventare
//      una tassa su «che ore sono».
//  (C) turno contaminato col guardiano irraggiungibile → la risposta non si
//      mostra e non si perde: l'utente legge che il controllo non risponde, e
//      la risposta resta in coda.

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

// Il modello della chat e quello del guardiano sono DIVERSI, come pretende il
// codice: due contesti sullo stesso modello cadono insieme.
async function configuraModelli(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.GUARD_TEXT]: 'glm',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// La chat: primo giro cerca sul web (se `cerca`), secondo giro risponde.
// La ricerca è finta ma passa dalla strada vera, quindi il turno risulta
// contaminato esattamente come succederebbe davvero.
async function preparaChat(app, { cerca, risposta }) {
  await app.evaluate(async (_e, arg) => {
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'Portale clienti', url: 'https://portale-esempio.it/', snippet: 'accedi al portale' }],
    });
    globalThis.__deltaVisti = [];
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (arg.cerca && giro === 1) {
        return {
          ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"portale clienti"}' }],
        };
      }
      // La risposta arriva a pezzi, come quella vera.
      for (const pezzo of arg.risposta.match(/.{1,24}/gs) || []) {
        try { onDelta && onDelta(pezzo); } catch (_) {}
        await new Promise((r) => setTimeout(r, 10));
      }
      return { ...base, text: arg.risposta, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { cerca, risposta });
}

// Il guardiano: risposta finta, e un contatore per dire se è stato chiamato.
async function preparaGuardiano(app, { verdetto, giu }) {
  await app.evaluate(async (_e, arg) => {
    globalThis.__guardiano = 0;
    globalThis.SN_TEXT_GUARDIAN.configure({
      pausaMs: 0,
      eseguiModello: async () => {
        globalThis.__guardiano++;
        if (arg.giu) throw new Error('fornitore non raggiungibile');
        return arg.verdetto;
      },
    });
  }, { verdetto, giu });
}

const RISPOSTA_TRAPPOLA =
  'Il portale clienti chiede di confermare subito le tue credenziali per non perdere l’accesso al conto.';

test('A — una risposta nata dal web che spinge alle credenziali viene fermata, e non scorre in diretta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configuraModelli(app);
  await preparaChat(app, { cerca: true, risposta: RISPOSTA_TRAPPOLA });
  await preparaGuardiano(app, {
    verdetto: '{"esito":"blocca","motivo":"chiedeva di confermare le credenziali del conto"}',
  });

  await page.locator('#input').fill('cerca il portale clienti e dimmi cosa devo fare');
  await page.locator('#sendBtn').click();

  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('Ho fermato un avviso nato da', { timeout: 20_000 });
  await expect(bolla).toContainText('chiedeva di confermare le credenziali del conto');
  // La risposta pericolosa non è arrivata: né a fine turno, né scorrendo.
  await expect(page.locator('.dash-bubble-filo')).not.toContainText('per non perdere l’accesso');
  expect(await app.evaluate(() => globalThis.__guardiano)).toBe(1);

  // E il blocco è finito nel registro che l'utente legge in Preferenze.
  const registro = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listGuardBlocks());
  expect(registro.length).toBe(1);
  expect(registro[0].origine).toContain('ricerca sul web');
  expect(registro[0].fonte).toContain('portale clienti');
});

test('B — un turno che non legge niente di nessuno non paga un secondo modello', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configuraModelli(app);
  await preparaChat(app, { cerca: false, risposta: 'Sono le 15:40.' });
  await preparaGuardiano(app, { verdetto: '{"esito":"passa"}' });

  await page.locator('#input').fill('che ore sono');
  await page.locator('#sendBtn').click();

  await expect(page.locator('.dash-bubble-filo', { hasText: 'Sono le 15:40.' }))
    .toBeVisible({ timeout: 20_000 });
  expect(await app.evaluate(() => globalThis.__guardiano)).toBe(0);
});

test('C — col guardiano irraggiungibile la risposta non si mostra e non si perde', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configuraModelli(app);
  await preparaChat(app, { cerca: true, risposta: 'Il portale clienti si trova a questo indirizzo.' });
  await preparaGuardiano(app, { giu: true });

  await page.locator('#input').fill('cerca il portale clienti');
  await page.locator('#sendBtn').click();

  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('il controllo di sicurezza non risponde', { timeout: 20_000 });
  await expect(page.locator('.dash-bubble-filo')).not.toContainText('Il portale clienti si trova');

  // La risposta è in coda, non buttata.
  const coda = await app.evaluate(() => globalThis.SN_FILO_MEMORY.listPendingNotifications());
  expect(coda.length).toBe(1);
  expect(coda[0].testo).toContain('Il portale clienti si trova');
});
