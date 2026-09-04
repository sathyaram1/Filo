// #524 — Onboarding: micro-intervista al primo avvio.
//
// Prima: la home mostrava un cartello fisso che prometteva «raccontami chi sei
// e mi configuro io», la risposta finiva in una chat qualunque, non c'era
// nessun elenco di cose da scoprire, e il segno «già accolto» veniva scritto
// PRIMA che l'utente rispondesse — chi chiudeva la finestra non rivedeva più
// il benvenuto.
//
// Qui si verifica il comportamento voluto, dal punto di vista dell'utente:
//   1. al primo avvio parte una CONVERSAZIONE (non un cartello), e finché non
//      finisce l'utente la ritrova riaprendo;
//   2. quello che Filo impara lo applica subito e lo spunta;
//   3. «basta così» chiude, quello che ha imparato finisce in memoria SUBITO
//      (compattazione forzata) e l'ultimo atto è la prima home personale;
//   4. da Preferenze l'intervista si rifà.
//
// Senza il fix: (1) è rossa (il benvenuto sparisce dopo un reload e lo stato
// risulta già accolto), (2) e (3) sono rosse (non esistono né elenco né
// chiusura), (4) è rossa (il pulsante non c'è).

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

// Chiave finta + modello noto: la richiesta arriva al provider, che stubbiamo.
async function useFakeKey(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'flash-lite-3',
        [C.ACTIONS.FILO_LESSON]: 'flash-lite-3',
        [C.ACTIONS.FILO_COMPACT]: 'flash-lite-3',
        [C.ACTIONS.FILO_DASHBOARD]: 'flash-lite-3',
      },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
}

// Un solo stub per tutti gli agenti coinvolti nel giro: la chat (in streaming),
// il creatore di lezioni, il compattatore e il generatore della home. Chi
// risponde si riconosce dal prompt. Le risposte della chat si accodano in
// `__chatReplies` nell'ordine in cui devono uscire.
async function stubAgents(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    globalThis.__seen = { lesson: 0, compact: 0, dashboard: 0 };
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) {
        globalThis.__seen.compact += 1;
        return 'PROFILO:\nAnna, insegnante delle medie. Usa il computer per preparare le lezioni.\n\nPREFERENZE:\nRisposte brevi, dà del tu.';
      }
      if (all.includes('analizzare l')) { // "analizzare l'ultima interazione"
        globalThis.__seen.lesson += 1;
        return 'LEZIONE: L\'utente si chiama Anna ed è un\'insegnante.';
      }
      if (all.includes('preparare la dashboard')) {
        globalThis.__seen.dashboard += 1;
        return JSON.stringify({
          message: 'Buongiorno Anna — le tue lezioni ti aspettano.',
          suggestions: [],
        });
      }
      const next = globalThis.__chatReplies.shift();
      return next || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => {
      const text = reply(messages);
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
}

const queueChat = (app, ...replies) => app.evaluate((_electron, rs) => {
  globalThis.__chatReplies = (globalThis.__chatReplies || []).concat(rs);
}, replies.map((r) => JSON.stringify(r)));

const onbState = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());

// La scheda nuova nasce col profilo di test, che non ha ancora un modello: la
// chiave si può mettere solo a app avviata, quindi la mettiamo e ricarichiamo.
// È lo stesso cammino dell'utente vero che accede e trova Filo che si presenta.
async function apriIntervista(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await useFakeKey(app);
  await stubAgents(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  return page;
}

test('senza un modello disponibile l’accoglienza aspetta invece di rompersi', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  // Nessun accesso, nessuna chiave: la home dice come attivare Filo e
  // l'intervista resta in attesa. Accoglierlo con una chat che non può
  // rispondere sarebbe peggio del silenzio.
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 10_000 });
  await expect(page.locator('#homeMessage')).toContainText(/Accedi con un profilo/i, { timeout: 15_000 });
  expect((await onbState(app)).done).toBe(false);
});

test('primo avvio: parte una conversazione, e chi non risponde la ritrova', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await apriIntervista(app, shell);

  // Non un cartello al centro della home: una chat, con Filo che ha già parlato.
  const welcome = page.locator('.dash-bubble-filo').first();
  await expect(welcome).toBeVisible({ timeout: 10_000 });
  await expect(welcome).toContainText('Ciao, sono Filo');
  await expect(page.locator('#input')).toBeVisible();

  // Il segno "già accolto" NON è ancora scritto: l'utente non ha risposto.
  const prima = await onbState(app);
  expect(prima.done).toBe(false);
  expect(prima.ticked).toEqual([]);

  // Chiude la finestra senza rispondere (qui: ricarica la scheda) → il
  // benvenuto è ancora lì. Prima il flag era già scritto e non tornava più.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo', { timeout: 10_000 });
  expect((await onbState(app)).done).toBe(false);
});

test('quello che Filo impara lo applica subito, lo spunta, e riprende da lì', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  // Filo scopre chi è l'utente e come vuole essere trattato: applica lo stile
  // (azione vera) e spunta le due voci.
  await queueChat(app, {
    text: 'Piacere Anna. Ti scrivo breve allora — e a proposito, il tema si cambia parlando: se lo preferisci scuro, dimmelo.',
    actions: [
      { type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: 'Risposte brevi, dà del tu.' },
      { type: 'ONBOARDING', spunta: ['profilo', 'stile', 'estetica'] },
    ],
  });

  await page.locator('#input').fill('sono Anna, insegnante — scrivimi breve e dammi del tu');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  // Applicato DAVVERO, non promesso: lo stile dell'agente è nelle impostazioni.
  await expect.poll(
    () => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => s.agentStyle || '')),
    { timeout: 15_000 },
  ).toContain('brevi');

  // E l'elenco è avanzato: quelle tre voci non verranno più chieste.
  await expect.poll(() => onbState(app).then((s) => s.ticked.slice().sort()), { timeout: 15_000 })
    .toEqual(['estetica', 'profilo', 'stile']);

  // Riapertura a metà intervista: la conversazione torna dov'era, tutta.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dash-bubble-user', { hasText: 'sono Anna' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread');
  expect((await onbState(app)).done).toBe(false);
});

test('«basta così»: chiude, fissa in memoria quello che ha imparato e apre la prima home', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await useFakeKey(app);
  await stubAgents(app);

  await queueChat(app, {
    text: 'Ci siamo capiti. Buon lavoro, Anna.',
    actions: [
      { type: 'ONBOARDING', spunta: ['profilo'], fine: true },
    ],
  });

  await page.locator('#input').fill('sono Anna, insegnante. basta così');
  await page.locator('#sendBtn').click();

  // L'ultimo atto non è un "fatto": è la home personale, costruita sul profilo
  // appena imparato, che prende il posto della chat.
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
  await expect(page.locator('#homeMessage')).toContainText('Buongiorno Anna', { timeout: 40_000 });

  // Il segno "già accolto" si scrive ADESSO, non prima.
  expect((await onbState(app)).done).toBe(true);

  // Le lezioni raccolte sono già dentro il profilo: compattazione FORZATA,
  // senza aspettare la soglia dei 3000 caratteri (prima non c'era modo di
  // chiederla e il profilo restava vuoto per giorni).
  const mem = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  expect(mem.PROFILO || '').toContain('insegnante');
  const buf = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getLessonsBuffer());
  expect(buf).toEqual([]);

  // Riaprendo, l'intervista non ricomincia: adesso sì che è accolto.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
  await expect(page.locator('#bubbles')).not.toContainText('Ciao, sono Filo');
});

test('da Preferenze l’intervista si rifà, anche dopo settimane', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await newtabPage(app);

  // Utente di vecchia data: intervista già chiusa.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] }));
  expect((await onbState(app)).done).toBe(true);

  const prefs = await openTab('filo://preferences/preferences.html');
  const btn = prefs.locator('#restartOnboarding');
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();

  // Riparte da capo: elenco tutto da spuntare e il benvenuto già in cima.
  await expect.poll(() => onbState(app), { timeout: 15_000 }).toMatchObject({ done: false, ticked: [] });
  const s = await onbState(app);
  expect(s.thread.length).toBe(1);
  expect(s.thread[0].text).toContain('Ciao, sono Filo');
});
