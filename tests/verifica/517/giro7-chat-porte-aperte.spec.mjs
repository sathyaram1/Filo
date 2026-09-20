// Verifica #517 — giro 7, dal punto di vista dell'utente, nella chat della home.
//
// Il giro 6 ha chiuso la porta «una cosa fatta una volta nella conversazione
// copre tutte quelle della sua specie raccontate dopo»: da allora un'azione
// di un turno precedente regge la frase solo se la frase GUARDA INDIETRO
// («te l'ho già messa», «come ti dicevo») oppure se l'utente stava facendo
// una domanda.
//
// «L'utente stava facendo una domanda» però vuol dire soltanto: nel suo
// messaggio c'è un punto interrogativo. E in italiano una richiesta si scrive
// quasi sempre così — «mi segni anche la lista della spesa?». Da lì in poi
// qualunque cosa fatta prima nella conversazione copre quella raccontata
// adesso, e il presidio torna muto nel caso della segnalazione: turno di
// prosecuzione, cosa dichiarata, cosa mai fatta.
//
// I test sono scritti per essere ROSSI finché la porta è aperta.

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

async function configureModel(app) {
  await app.evaluate(async (_electron) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function installScript(app, script) {
  await app.evaluate(async (_electron, script) => {
    globalThis.__captured = [];
    let i = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const step = script[Math.min(i++, script.length - 1)];
      globalThis.__captured.push({ messages: JSON.parse(JSON.stringify(messages)) });
      await new Promise((r) => setTimeout(r, 40));
      for (const c of step.toolCalls || []) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (step.text) { try { onDelta && onDelta(step.text); } catch (_) {} }
      return {
        text: step.text || '', toolCalls: step.toolCalls || [], reasoningDetails: [],
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  }, script);
}

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
}

test('una richiesta scritta come domanda non spegne il presidio', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    // Primo turno: l'appunto della riunione lo scrive davvero.
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"lunedì alle 10","contesto":"riunione"}' }] },
    { text: 'Fatto, te l\'ho scritto.' },
    // Secondo turno: racconta un SECONDO appunto e non chiama niente.
    { text: 'Ti ho salvato l\'appunto con la lista della spesa.' },
  ]);

  await chiedi(page, 'segnami che la riunione è lunedì alle 10');
  // La stessa richiesta del giro 6, scritta come la scrive un utente normale.
  await chiedi(page, 'mi segni anche la lista della spesa: pane, uova, latte?');

  // Della spesa non resta traccia da nessuna parte: l'utente deve leggerlo.
  await expect(page.locator('.dash-bubble-avviso')).not.toHaveCount(0);
});

test('una domanda vera sull\'già fatto non fa comparire nessuna accusa', async ({ app, shell }) => {
  // La controprova: «l'hai segnata?» → «sì, te l'avevo già segnata» deve
  // restare muto. Chiudendo la porta sopra questo non deve rompersi.
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"pane, uova, latte","contesto":"spesa"}' }] },
    { text: 'Fatto, te l\'ho scritto.' },
    { text: 'Sì, te l\'avevo già salvata negli appunti poco fa.' },
  ]);

  await chiedi(page, 'segnami la lista della spesa: pane, uova, latte');
  await chiedi(page, 'hai salvato la lista della spesa?');

  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
});
