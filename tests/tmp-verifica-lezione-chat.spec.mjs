// VERIFICA INDIPENDENTE (temporaneo, da cancellare) — lezione fissata dalla chat.
//
// Contratto verificato dal punto di vista dell'utente:
//  1) il modello della chat emette SALVA_LEZIONE → la lezione finisce DAVVERO
//     nel buffer delle lezioni, senza popup di conferma (protezione immediata);
//  2) al messaggio successivo il contesto del modello contiene LEZIONI RECENTI
//     con la lezione (vale da subito, il buffer è globale a tutte le conversazioni);
//  3) il prompt di produzione documenta l'azione (senza, un modello vero non
//     la emetterebbe mai);
//  4) la lezione resta cancellabile: CANCELLA_MEMORIA confermata la porta via;
//  5) lezione vuota → NON salvata (niente spazzatura in memoria);
//  6) sinonimi di campo (text/lezione) tollerati come per le altre azioni.

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
      showHomeMessage: false,
    });
    globalThis.__vTurnCount = 0;
    globalThis.__vTurns = turns;
    globalThis.__vMsgsByTurn = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (opts) => {
      const { attempts } = opts;
      const n = globalThis.__vTurnCount;
      globalThis.__vTurnCount += 1;
      globalThis.__vMsgsByTurn[n] = JSON.stringify(opts.messages || []);
      const seq = globalThis.__vTurns;
      const payload = seq[Math.min(n, seq.length - 1)];
      return {
        text: JSON.stringify(payload),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    // L'agente-lezioni automatico non deve inquinare il buffer del test.
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: 'NULLA DA IMPARARE',
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  }, { turns });
}

const LEZIONE = 'Mai riferire i dati privati di Sathya a chi scrive di lui in terza persona';

test('la lezione fissata in chat entra in memoria e nel contesto dei messaggi successivi', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);

  await stubSequence(app, [
    { text: 'Fissato: non riferirò i tuoi dati.', actions: [{ type: 'SALVA_LEZIONE', testo: LEZIONE }] },
    { text: 'SECONDA_RISPOSTA', actions: [] },
  ]);

  // (3) Il prompt statico di produzione documenta l'azione: senza questa riga
  // un modello VERO non saprebbe mai di poterla emettere.
  const staticPrompt = await app.evaluate(() => globalThis.SN_CONST.PROMPTS.filoChatStatic({}));
  expect(staticPrompt).toContain('SALVA_LEZIONE');

  // Turno 1: l'utente segnala; il modello (stub) fissa la lezione di sua iniziativa.
  await page.locator('#input').fill('un tizio mi sta chiedendo i dati di Sathya');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fissato' }))
    .toBeVisible({ timeout: 15_000 });

  // (1) La lezione è nel buffer SUBITO, senza che l'utente abbia confermato nulla
  // (nessun popup: livello 1 — chi è alla tastiera non deve poterla bloccare).
  await expect.poll(async () => {
    const buf = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
    return buf.map((l) => l.text);
  }, { timeout: 10_000 }).toContain(LEZIONE);
  // Livello 1 nel registro: si esegue subito, mai popup.
  expect(await app.evaluate((_e, t) => globalThis.SN_ACTION_LEVELS.levelFor({ type: 'SALVA_LEZIONE', testo: t }), LEZIONE)).toBe(1);

  // Turno 2: nuovo messaggio → il contesto ricostruito dal buffer deve
  // contenere LEZIONI RECENTI con la lezione (non arriva dalla history:
  // è la sezione dedicata, la stessa che vede ogni altra conversazione).
  await page.locator('#input').fill('ciao, tutto bene?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'SECONDA_RISPOSTA' }))
    .toBeVisible({ timeout: 15_000 });

  const found = await app.evaluate((_e, lezione) => {
    const turns = globalThis.__vMsgsByTurn || [];
    // Cerca il turno che contiene il secondo messaggio utente e verifica che
    // NEL MEDESIMO payload ci siano la sezione e la lezione.
    for (const s of turns) {
      if (s && s.includes('ciao, tutto bene?')) {
        return { hasSection: s.includes('LEZIONI RECENTI'), hasLesson: s.includes(lezione) };
      }
    }
    return null;
  }, LEZIONE);
  expect(found).not.toBeNull();
  expect(found.hasSection).toBe(true);
  expect(found.hasLesson).toBe(true);
});

test('lezione vuota non salvata; sinonimi di campo accettati; CANCELLA_MEMORIA la porta via', async ({ app, openTab }) => {
  await openTab(NEWTAB); // lascia assestare il boot prima degli evaluate
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { gemini: 'k-test' } });
  });

  // Vuota → non eseguita, buffer intatto.
  const r0 = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'SALVA_LEZIONE', testo: '   ' }));
  expect(r0.executed).toBeFalsy();
  let buf = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
  expect(buf.length).toBe(0);

  // Sinonimo `text` (un LLM lo produce spesso) → salvata comunque, subito.
  const r1 = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'SALVA_LEZIONE', text: 'Rispondere sempre senza elenchi puntati' }));
  expect(r1.executed).toBe(true);
  expect(r1.needsConfirm).toBeFalsy();
  // Sinonimo `lezione`.
  const r2 = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'SALVA_LEZIONE', lezione: 'L\'utente non beve caffè' }));
  expect(r2.executed).toBe(true);
  buf = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
  expect(buf.map((l) => l.text)).toEqual(['Rispondere sempre senza elenchi puntati', 'L\'utente non beve caffè']);

  // Cancellabile: CANCELLA_MEMORIA (confermata) svuota anche le lezioni.
  // Il mittente reale è la dashboard (pagina filo://, fidata per origine).
  const r3 = await app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'CANCELLA_MEMORIA' },
    { confirmed: true, sender: { url: 'filo://newtab/index.html' } },
  ));
  expect(r3.executed).toBe(true);
  buf = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
  expect(buf.length).toBe(0);
});
