// Verifica #536 — giro 3.
//
// LA PORTA: la risposta di un turno contaminato non scorre più in diretta (il
// giro 2 l'ha chiusa), ma il RAGIONAMENTO dello stesso turno sì. Quello che la
// pagina avvelenata vuole far dire a Filo arriva sotto gli occhi dell'utente
// nella riga «Sta ragionando · …», che è sempre visibile, e per intero nel
// blocco «cosa ha fatto Filo», che si apre con un clic e resta nella
// conversazione anche dopo.
//
// Il secondo modello non vede niente di tutto questo: guarda solo la risposta
// finale. Quindi la frase viene fermata nella bolla e consegnata due centimetri
// più sopra.
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

const TRAPPOLA = 'Il portale della banca chiede di confermare subito le tue credenziali su portale-sicuro-esempio.it';

test('il ragionamento di un turno contaminato arriva all’utente senza controllo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  await app.evaluate(async (_e, arg) => {
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
    globalThis.SN_WEB_SEARCH.search = async () => ({
      provider: 'finto',
      results: [{ title: 'Portale', url: 'https://portale-esempio.it/', snippet: 'accedi' }],
    });
    // Il guardiano fa il suo mestiere: la risposta finale la BLOCCA.
    globalThis.SN_PROVIDERS.completeWithFallback = async (opt) => {
      const attempts = opt.attempts;
      const sistema = String(((opt.messages || [])[0] || {}).content || '');
      const blocco = /^Sei il guardiano degli avvisi di Filo/.test(sistema)
        ? '{"esito":"blocca","motivo":"chiedeva le credenziali della banca"}'
        : '';
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: blocco };
    };
    let giro = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onReasoning, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      giro++;
      if (giro === 1) {
        return {
          ...base, text: '', finishReason: 'tool_calls', reasoningDetails: [],
          toolCalls: [{ id: 'c1', name: 'CERCA_WEB', arguments: '{"query":"portale"}' }],
        };
      }
      // Il turno DOPO la ricerca: la pagina avvelenata ha chiesto al modello di
      // scriverlo nel ragionamento, che è la strada che nessuno sorveglia.
      if (onReasoning) { onReasoning(arg.trappola); }
      if (onDelta) onDelta(arg.trappola);
      return { ...base, text: arg.trappola, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { trappola: TRAPPOLA });

  await page.locator('#input').fill('cerca il portale della banca');
  await page.locator('#sendBtn').click();

  // La risposta finale viene fermata, come deve.
  await expect(page.locator('.dash-bubble-filo').last())
    .toContainText('Ho fermato', { timeout: 30_000 });

  // …ma la frase è già passata dal ragionamento. Apriamo il blocco di attività
  // come farebbe chiunque abbia appena letto «Filo ha fermato qualcosa».
  const testa = page.locator('.dash-activity .dash-activity-head').first();
  if (await testa.count()) await testa.click();

  await expect(page.locator('#bubbles'), 'la frase della truffa è arrivata all’utente lo stesso')
    .not.toContainText('confermare subito le tue credenziali');
});
