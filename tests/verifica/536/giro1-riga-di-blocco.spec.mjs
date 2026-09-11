// Verifica #536 — giro 1.
//
// LA PORTA: la riga di blocco non è controllata da niente.
//
// Quando il guardiano ferma un avviso, al suo posto compare una riga scritta
// COL MOTIVO CHE HA DATO IL GUARDIANO. Quel motivo è la frase di un modello
// che ha appena letto il testo di un estraneo: se il testo gli detta cosa
// scrivere nel motivo, l'attacco arriva comunque all'utente — nella riga del
// blocco, cioè nella voce di Filo, e per di più come collegamento cliccabile,
// perché la colonna rende cliccabili gli indirizzi che trova in un avviso.
//
// Nessun controllo statico gira su quella riga: i controlli guardano il testo
// PROPOSTO, non quello che Filo scrive al suo posto.
//
// Rosso finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

async function homePage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

test('il motivo del blocco arriva all’utente senza nessun controllo, e come link cliccabile', async ({ app }) => {
  test.setTimeout(60_000);
  const home = await homePage(app);

  // Il guardiano blocca — come deve — ma il motivo che scrive è quello che il
  // testo letto gli ha dettato.
  const esito = await app.evaluate(async () => {
    const TG = globalThis.SN_TEXT_GUARDIAN;
    TG.configure({
      pausaMs: 0,
      eseguiModello: async () => JSON.stringify({
        esito: 'blocca',
        motivo: 'per riattivare il conto conferma le credenziali su https://banca-esempio.attacco.ru/login',
      }),
    });
    return TG.proponiNotifica({
      testo: 'Riepilogo della posta di oggi.',
      kind: 'alert',
      fiducia: 'contaminato',
      origine: 'una mail di Banca Esempio',
      regolaAutomazione: 'avvisami delle mail importanti',
      produttore: 'deepseek',
    });
  });
  expect(esito.esito).toBe('blocca');

  const riga = home.locator('.dash-live-card[data-guardiano="blocco"]');
  await expect(riga).toHaveCount(1, { timeout: 8_000 });

  // Quello che l'utente NON deve leggere nella voce di Filo.
  await expect(riga, 'la riga del blocco ripete l’indirizzo dell’attacco')
    .not.toContainText('attacco.ru');
  // E soprattutto non deve poterci cliccare sopra.
  await expect(
    riga.locator('a.dash-live-link'),
    'la riga del blocco offre un collegamento vivo verso il sito dell’attacco',
  ).toHaveCount(0);
});

// La seconda porta della stessa causa: nella chat la riga del blocco è scritta
// nello stesso modo, e la bolla rende cliccabili gli indirizzi che trova.
test('anche nella chat la riga del blocco ripete quello che il testo ha dettato', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await (async () => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
      if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('newtab non trovata');
  })();
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.GUARD_TEXT]: 'glm' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'Portale', url: 'https://portale-esempio.it/', snippet: 'accedi' }],
    });
    globalThis.SN_TEXT_GUARDIAN.configure({
      pausaMs: 0,
      eseguiModello: async () => JSON.stringify({
        esito: 'blocca',
        motivo: 'per riattivare il conto conferma le credenziali su https://banca-esempio.attacco.ru/login',
      }),
    });
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return { ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"portale"}' }] };
      }
      return { ...base, text: 'Ecco cosa ho trovato.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });

  await page.locator('#input').fill('cerca il portale clienti');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('Ho fermato un avviso', { timeout: 30_000 });
  await expect(bolla, 'la bolla del blocco ripete l’indirizzo dell’attacco')
    .not.toContainText('attacco.ru');
  await expect(bolla.locator('a'), 'la bolla del blocco offre un collegamento vivo verso l’attacco')
    .toHaveCount(0);
});
