// Il diario del lavoro dice TUTTO quello che Filo ha fatto, e non promette
// quello che non è riuscito.
//
// Con gli strumenti nativi il modello chiama azioni che in chat non lasciano
// niente da cliccare (un appunto scritto, una lezione fissata, il proxy tolto,
// lo stile della pagina). Prima sparivano: nessuna riga, nessun bottone,
// nessuna traccia — l'utente non sapeva nemmeno dove fosse finito il suo
// appunto, e un turno fatto di sole azioni silenziose non lasciava blocco. Allo
// stesso tempo un documento inesistente veniva raccontato come «Leggo il
// documento…» e riassunto come «letto un documento»: un successo che non c'era.
//
// Ogni test asserisce il successo dal punto di vista dell'utente, e senza il
// fix sarebbe rosso:
//  (A) appunto e lezione hanno la loro riga e il riassunto le conta; il
//      bottone che porta all'editor resta;
//  (B) una lettura fallita lo DICE, e il riassunto non se ne vanta; un link a
//      un indirizzo non ammesso non lascia un bottone che al click non fa nulla;
//  (C) un'impostazione confermata nel popup entra nel diario, e al turno dopo
//      il modello sa che è stata confermata invece di tirare a indovinare;
//  (D) un guasto a metà: le azioni già fatte tornano al modello al tentativo
//      successivo, che non le rifà.

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

async function configureModel(app) {
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

// Provider finto: `giri` è la lista delle risposte, una per giro del modello.
async function fakeProvider(app, giri, slot = '__fake') {
  // In `app.evaluate` il primo parametro è il modulo Electron: l'argomento
  // nostro arriva per secondo.
  await app.evaluate(async (_electron, { giri: g, slot: s }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis[`${s}_restore`] = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis[`${s}_calls`] = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      globalThis[`${s}_calls`].push(JSON.parse(JSON.stringify(messages)));
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      if (giro.errore) throw new Error(giro.errore);
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, { giri, slot });
}

const restore = (app, slot = '__fake') => app.evaluate((_electron, s) => {
  try { globalThis[`${s}_restore`]?.(); } catch (_) {}
}, slot);

test('A — appunto e lezione hanno la loro riga nel diario, e il riassunto le conta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'a1', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare il latte","contesto":"spesa"}' },
        { id: 'a2', name: 'SALVA_LEZIONE', arguments: '{"testo":"L\'utente non beve caffè."}' },
      ],
    },
    { text: 'Segnato.' },
  ]);

  await page.locator('#input').fill('ricordami di comprare il latte, e sappi che non bevo caffè');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Segnato.' })).toBeVisible({ timeout: 10_000 });

  // Il blocco c'è (prima: nessun blocco, nessuna traccia) e il riassunto dice
  // entrambe le cose.
  const activity = page.locator('.dash-activity');
  await expect(activity).toHaveCount(1);
  await expect(activity).toHaveAttribute('data-phase', 'done');
  const label = activity.locator('.dash-activity-label');
  await expect(label).toContainText('salvato un appunto');
  await expect(label).toContainText('memorizzato una cosa');

  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body.locator('.dash-activity-row', { hasText: 'Appunto salvato' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'spesa' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'Memorizzato' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'non beve caffè' })).toHaveCount(1);

  // Il bottone che porta dove l'appunto è finito resta: la riga racconta, il
  // bottone ci porta.
  await expect(page.locator('.dash-action-btn[data-action="openNotes"]')).toHaveCount(1);
  await page.screenshot({ path: 'tests/agent/.out/diario-azioni-silenziose.png' });

  await restore(app);
});

test('B — una lettura fallita lo dice, e un link non ammesso non lascia un bottone morto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    {
      toolCalls: [
        { id: 'b1', name: 'LEGGI_DOCUMENTO', arguments: '{"percorso":"~/non-esiste-davvero-12345.pdf"}' },
        { id: 'b2', name: 'NAVIGA', arguments: '{"url":"javascript:alert(1)","etichetta":"js"}' },
      ],
    },
    { text: 'Quel documento non c\'è.' },
  ], '__fakeB');

  await page.locator('#input').fill('leggi il pdf e apri il link');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Quel documento non c' })).toBeVisible({ timeout: 10_000 });

  const activity = page.locator('.dash-activity');
  const label = activity.locator('.dash-activity-label');
  // Il riassunto NON si vanta di una lettura che non è avvenuta.
  await expect(label).not.toContainText('letto un documento');
  await expect(label).not.toContainText('aperto una pagina');

  await activity.locator('.dash-activity-head').click();
  const body = activity.locator('.dash-activity-body');
  await expect(body.locator('.dash-activity-row', { hasText: 'Documento non letto' })).toHaveCount(1);
  await expect(body.locator('.dash-activity-row', { hasText: 'Link non aperto' })).toHaveCount(1);
  // Nessun chip che al click non farebbe niente.
  await expect(page.locator('.dash-action-btn', { hasText: 'js' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/agent/.out/diario-non-riuscito.png' });

  await restore(app, '__fakeB');
});

test('C — un\'impostazione confermata entra nel diario e il modello lo sa al turno dopo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'c1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' }] },
    { text: 'Ti chiedo conferma.' },
    { text: 'Sì, la modalità terminale è attiva.' },
  ], '__fakeC');

  await page.locator('#input').fill('attiva la modalità terminale');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' })).toBeVisible({ timeout: 10_000 });

  // Il popup si apre da sé: si conferma.
  const host = page.locator(CONFIRM_HOST);
  await expect(host).toBeVisible({ timeout: 5_000 });
  await clickConfirm(page, 'ok');
  await expect(host).toHaveCount(0, { timeout: 5_000 });

  // La conferma lascia la sua riga nel diario (prima: niente).
  const activity = page.locator('.dash-activity');
  await activity.locator('.dash-activity-head').click();
  await expect(activity.locator('.dash-activity-body .dash-activity-row', { hasText: 'modalita_terminale' }))
    .toHaveCount(1, { timeout: 5_000 });

  // E al turno dopo il modello SA che è stata confermata.
  await page.locator('#input').fill('è attivo?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'è attiva' })).toBeVisible({ timeout: 10_000 });
  const calls = await app.evaluate(() => globalThis.__fakeC_calls);
  const ultimo = JSON.stringify(calls[calls.length - 1]);
  expect(ultimo).toContain('ha CONFERMATO');
  expect(ultimo).toContain('modalita_terminale');

  await restore(app, '__fakeC');
});

test('D — guasto a metà: al nuovo tentativo il modello sa cosa era già stato fatto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await configureModel(app);

  await fakeProvider(app, [
    { toolCalls: [{ id: 'd1', name: 'TIMER', arguments: '{"secondi":300,"etichetta":"Pasta"}' }] },
    { errore: 'fetch failed' },
    { text: 'Il timer della pasta è già avviato.' },
  ], '__fakeD');

  await page.locator('#input').fill('timer per la pasta e dimmi quando');
  await page.locator('#sendBtn').click();

  // Il turno fallisce: compare l'errore col tasto Riprova.
  const retry = page.locator('.dash-action-btn', { hasText: 'Riprova' });
  await expect(retry).toBeVisible({ timeout: 15_000 });
  const timers = await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.listTimers()).map((t) => t.label));
  expect(timers).toContain('Pasta');

  await retry.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'già avviato' })).toBeVisible({ timeout: 15_000 });

  // Il nuovo tentativo parte SAPENDO che il timer c'è già (prima: il modello
  // non lo sapeva e poteva avviarne un secondo).
  const calls = await app.evaluate(() => globalThis.__fakeD_calls);
  const ultimo = JSON.stringify(calls[calls.length - 1]);
  expect(ultimo).toContain('ERANO GIÀ STATE FATTE');
  expect(ultimo).toContain('Pasta');

  await restore(app, '__fakeD');
});
