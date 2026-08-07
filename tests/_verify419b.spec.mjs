// VERIFIER #419 — le DUE richieste del feedback, provate dalla chat vera della
// home (non chiamando l'esecutore a mano).
//
//  A) "metti il video a schermo intero" → l'agente lo FA, non lo spiega.
//  B) il "buco muto": l'agente riconosce una cosa che Filo sa fare ma che lui
//     non sa comandare → deve SEGNALARLA, non solo spiegarla a mano.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

async function stubSequence(app, turns) {
  await app.evaluate(async (_electron, { turns }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__filoTurnCount = 0;
    globalThis.__filoTurns = turns;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      const seq = globalThis.__filoTurns;
      const n = globalThis.__filoTurnCount;
      globalThis.__filoTurnCount += 1;
      return {
        text: JSON.stringify(seq[Math.min(n, seq.length - 1)]),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ text: '', actions: [] }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  }, { turns });
}

const fsState = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  const tabs = win._filoTabs;
  const active = tabs.tabs.find((t) => t.id === tabs.activeId);
  return { fs: tabs.contentFullscreen, y: active.view.getBounds().y };
});

test('A) dalla chat della home: "metti il video a schermo intero" lo ESEGUE davvero', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubSequence(app, [
    { text: 'Fatto, schermo intero attivo. Esci con Esc.',
      actions: [{ type: 'COMANDO_FINESTRA', comando: 'fullscreen' }] },
  ]);

  expect((await fsState(app)).fs).toBe(false);

  await page.locator('#input').fill('metti il video a schermo intero');
  await page.locator('#sendBtn').click();

  // SUCCESSO: la pagina va DAVVERO a tutto schermo partendo da una frase in chat.
  await expect.poll(async () => (await fsState(app)).fs, { timeout: 15_000 }).toBe(true);
  expect((await fsState(app)).y).toBe(0);

  // e l'utente vede la conferma in chat (nessun popup: e' livello 1)
  await expect(page.locator('.dash-bubble-filo', { hasText: 'schermo intero' }))
    .toBeVisible({ timeout: 10_000 });
});

test('B) buco muto: se l\'agente emette la segnalazione, l\'utente la trova gia\' scritta da confermare', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await stubSequence(app, [
    {
      text: 'Intanto puoi farlo dal tasto destro sulla pagina → Schermo intero.',
      actions: [{
        type: 'INVIA_FEEDBACK',
        testo: 'L\'utente voleva mettere la pagina a schermo intero. Filo lo sa fare, ma io (assistente) non ho un\'azione per comandarlo.',
        titolo: 'Azione mancante: schermo intero',
      }],
    },
  ]);

  await page.locator('#input').fill('porta questa pagina a tutto schermo');
  await page.locator('#sendBtn').click();

  // La segnalazione compare come azione DA CONFERMARE (livello 2): non parte di
  // nascosto e non resta muta.
  const btn = page.locator('.dash-action-btn').first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  // e continua comunque a dire come farlo a mano
  await expect(page.locator('.dash-bubble-filo', { hasText: 'tasto destro' })).toBeVisible();
});

test('C) rete di sicurezza: se l\'agente NON emette la segnalazione, il buco resta muto', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  // Stessa spiegazione manuale, ma senza INVIA_FEEDBACK: e' il caso in cui il
  // modello non obbedisce all'istruzione.
  await stubSequence(app, [
    { text: 'Puoi farlo dal tasto destro sulla pagina → Schermo intero. Con Esc esci.', actions: [] },
  ]);

  await page.locator('#input').fill('porta questa pagina a tutto schermo');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'tasto destro' }))
    .toBeVisible({ timeout: 15_000 });

  // Documenta lo stato attuale: nessuna proposta automatica compare.
  await page.waitForTimeout(2500);
  const proposte = await page.locator('.dash-action-btn').count();
  console.log(`[C] proposte di segnalazione comparse senza INVIA_FEEDBACK del modello: ${proposte}`);
});
