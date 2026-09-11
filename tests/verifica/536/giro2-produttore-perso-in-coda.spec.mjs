// Verifica #536 — giro 2.
//
// LA PORTA: il secondo giudizio smette di essere indipendente appena la
// risposta fa un giro in coda.
//
// Quando il controllo non si può fare (rete caduta, oppure — come qui — il
// guardiano impostato sullo stesso modello che scrive le risposte) la risposta
// della chat non si perde: va in coda «in attesa del controllo» e riparte al
// giro dopo. Ma quello che viene messo in coda NON si porta dietro qual era il
// modello che il testo l'ha scritto. Al giro dopo il guardiano non ha più
// nessuno da escludere: gira sul PRIMO modello della sua catena, che può essere
// — ed è, in questo caso — lo stesso che ha scritto il testo. Due contesti
// sullo stesso modello cadono insieme: è esattamente la cosa che la funzione
// esiste per impedire, e che un minuto prima aveva rifiutato di fare.
//
// Dal punto di vista di chi usa Filo: gli viene detto «manca un modello
// diverso, sistemalo qui», e subito dopo la stessa risposta compare lo stesso,
// con l'aria di essere passata da un controllo che non c'è stato.
//
// Rosso finché la porta è aperta.

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

const TRAPPOLA = 'Il portale clienti chiede di confermare subito le tue credenziali per non perdere l’accesso.';

test('la risposta rimessa in coda viene giudicata dallo stesso modello che l’ha scritta', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async (_e, arg) => {
    const C = globalThis.SN_CONST;
    // Lo stesso modello per la chat e per il guardiano: il codice DEVE
    // rifiutarsi di usarlo, e al primo passaggio infatti si rifiuta.
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.GUARD_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'Portale clienti', url: 'https://portale-esempio.it/', snippet: 'accedi al portale' }],
    });
    // Nessun finto guardiano: gira quello VERO, con la sua regola di
    // indipendenza. Qui si registra soltanto su quale modello finisce.
    globalThis.__modelliGuardiano = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      globalThis.__modelliGuardiano.push(String(attempts[0].model || ''));
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: '{"esito":"passa","motivo":""}',
      };
    };
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return {
          ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"portale clienti"}' }],
        };
      }
      return { ...base, text: arg.trappola, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { trappola: TRAPPOLA });

  await page.locator('#input').fill('cerca il portale clienti');
  await page.locator('#sendBtn').click();

  // Primo passaggio: il controllo si rifiuta di partire e lo dice.
  await expect(page.locator('.dash-bubble-filo').last())
    .toContainText('controllo di sicurezza', { timeout: 30_000 });
  expect(
    await app.evaluate(() => globalThis.__modelliGuardiano.length),
    'al primo passaggio il guardiano non doveva girare su nessun modello',
  ).toBe(0);

  // La colonna degli avvisi, riaperta: è lei che ridà una possibilità alla
  // coda. È la cosa che succede da sola, senza che l'utente faccia niente.
  await page.reload();
  await expect(page.locator('#input')).toBeVisible();

  await expect
    .poll(async () => app.evaluate(() => globalThis.__modelliGuardiano.slice()), { timeout: 30_000 })
    .not.toEqual([]);

  const usati = await app.evaluate(() => globalThis.__modelliGuardiano.slice());
  const chat = await app.evaluate(() => globalThis.SN_TEST_MODELS.registry['deepseek-flash'].model);
  expect(
    usati.filter((m) => m === chat),
    'il controllo è girato sullo stesso modello che ha scritto la risposta',
  ).toEqual([]);
});
