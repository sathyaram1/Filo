// Verifica #517 — giro 8, dal punto di vista dell'utente, nella chat della home.
//
// Due porte:
//
//   1. L'utente INCOLLA un documento nel messaggio e chiede cosa dice. Il
//      testo arriva al modello dentro la domanda, senza passare da nessuno
//      strumento — il giro 7 lo ha messo fra le prove, e «ho letto il
//      contratto» non è più un'accusa. Raccontato con l'altro verbo, «ho
//      aperto il contratto che hai incollato», la risposta viene cancellata,
//      rifatta con una seconda chiamata al modello e poi smentita.
//   2. Il tasto «Fallo adesso» porta dentro l'unico buco rimasto. Se nella
//      conversazione un appunto era già stato scritto davvero, la seconda
//      richiesta raccontata e mai fatta viene vista una volta; premendo il
//      tasto, il modello ripete la stessa cosa guardando indietro («te l'ho
//      già salvato») e quella volta non lo dice più nessuno.
//
// I test sono scritti per essere ROSSI finché le porte sono aperte.

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

const chiamate = (app) => app.evaluate(() => (globalThis.__captured || []).length);

async function chiedi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });
}

// Un contratto incollato: abbastanza lungo da essere un documento e non una
// richiesta.
const CONTRATTO = `CONDIZIONI GENERALI DI FORNITURA — ${'Il fornitore si impegna a consegnare la merce entro trenta giorni dalla data dell\'ordine. '.repeat(6)}`;

test('un documento incollato non fa accusare Filo di non averlo aperto', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    { text: 'Ho aperto il contratto che hai incollato: la penale è del 5%.' },
  ]);

  await chiedi(page, `${CONTRATTO}\nquanto è la penale?`);

  // Il contratto Filo ce l'ha davanti: non c'era niente da aprire e non c'è
  // niente da smentire.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(0);
  // …e la risposta non viene buttata e rifatta: una chiamata al modello sola.
  expect(await chiamate(app)).toBe(1);
});

test('dopo «Fallo adesso» la stessa cosa mai fatta non diventa muta', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);
  await installScript(app, [
    // Turno 1: l'appunto della riunione lo scrive davvero.
    { text: '', toolCalls: [{ id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"lunedì alle 10","contesto":"riunione"}' }] },
    { text: 'Fatto, te l\'ho scritto.' },
    // Turno 2: racconta la lista della spesa e non chiama niente. Anche dopo
    // il ritentativo insiste.
    { text: 'Ti ho salvato l\'appunto con la lista della spesa.' },
    { text: 'Ti ho salvato l\'appunto con la lista della spesa.' },
    // Turno 3, quello del tasto: ripete la stessa cosa guardando indietro.
    { text: 'Te l\'ho già salvato l\'appunto con la lista della spesa.' },
  ]);

  await chiedi(page, 'segnami che la riunione è lunedì alle 10');
  await chiedi(page, 'segnami anche la lista della spesa: pane, uova, latte');

  // La prima volta l'utente lo legge.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(1);

  // Preme il tasto che Filo gli offre per farla davvero.
  await page.getByRole('button', { name: /Fallo adesso/ }).last().click();
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 25_000 });

  // Della spesa non esiste ancora nessun appunto: l'utente deve leggerlo
  // anche stavolta, non credere che premendo il tasto sia andata.
  await expect(page.locator('.dash-bubble-avviso')).toHaveCount(2);
});
