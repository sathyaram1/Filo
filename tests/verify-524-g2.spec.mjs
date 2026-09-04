// #524 giro 2 — verifica avversariale dell'intervista di benvenuto.
//
// Le porte già trovate al giro 1 (uscita che non passa dal modello, doppioni
// del turno interrotto, intervista di prima cancellata, seconda scheda ferma)
// sono coperte dagli spec esistenti: qui si prova a romperla dove non è ancora
// stata provata.
//
// Ipotesi sotto esame: la parola di stop che l'app riconosce da sé è tarata
// troppo larga. L'elenco delle cose da DIRE contiene proposte esplicite
// («preferisci il tema scuro?», «vuoi accedere con Google?», «se ti interessa
// come scelgo i modelli, chiedimelo»): a una proposta si risponde «no grazie»,
// «magari dopo», «non ora» — e quelle frasi chiudono l'intera accoglienza.

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

async function useFakeKey(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  });
}

async function stubAgents(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    globalThis.__chatCalls = 0;
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) {
        return 'PROFILO:\nAnna, insegnante.\n\nPREFERENZE:\nRisposte brevi.';
      }
      if (all.includes('analizzare l')) return 'LEZIONE: L\'utente si chiama Anna.';
      if (all.includes('preparare la dashboard')) {
        return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      }
      globalThis.__chatCalls += 1;
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

const queueChat = (app, ...replies) => app.evaluate((_e, rs) => {
  globalThis.__chatReplies = (globalThis.__chatReplies || []).concat(rs);
}, replies.map((r) => JSON.stringify(r)));

const onbState = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getOnboarding());
const chatCalls = (app) => app.evaluate(() => globalThis.__chatCalls || 0);

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

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

// ── 1. Rifiutare una PROPOSTA non è chiedere di uscire ─────────────────────
//
// Filo deve proporre l'accesso Google («proposto, non obbligatorio»). Chi
// risponde «no grazie» sta rifiutando l'accesso, non l'accoglienza: deve
// restare dentro l'intervista e sentirsi dire le cose che restano.
test('«no grazie» all’accesso Google non deve chiudere l’intervista', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);

  await queueChat(app, {
    text: 'Piacere Anna. I crediti si ricaricano ogni giorno; con l’accesso Google restano tuoi anche dopo una reinstallazione. Vuoi accedere?',
    actions: [{ type: 'ONBOARDING', spunta: ['profilo', 'crediti'] }],
  });
  await scrivi(page, 'sono Anna, insegnante');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Vuoi accedere' })).toBeVisible({ timeout: 30_000 });

  const primaChiamate = await chatCalls(app);

  // La risposta naturale al «vuoi accedere?».
  await queueChat(app, {
    text: 'Nessun problema, resta com’è. Ti dico ancora una cosa sulla privacy…',
    actions: [{ type: 'ONBOARDING', spunta: ['privacy'] }],
  });
  await scrivi(page, 'no grazie');

  await page.waitForTimeout(3_000);
  const s = await onbState(app);
  await page.screenshot({ path: 'tests/.shots/524g2-no-grazie.png' }).catch(() => {});

  // Il modello non è stato nemmeno interpellato: l'app ha chiuso da sé.
  expect.soft(await chatCalls(app), 'il turno deve arrivare al modello').toBeGreaterThan(primaChiamate);
  expect(s.done, 'l’intervista non deve chiudersi per un «no grazie» a una proposta').toBe(false);
  await expect(page.locator('#bubbles')).not.toContainText('Va bene, chiudo qui');
});

// Stessa causa, altre porte: ogni frase qui sotto è una risposta plausibile a
// una delle proposte che l'elenco impone a Filo di fare.
for (const frase of ['magari dopo', 'non ora', 'lascia stare', 'passo', 'più tardi']) {
  test(`«${frase}» a una proposta non deve chiudere l’intervista`, async ({ app, shell }) => {
    test.setTimeout(120_000);
    const page = await apriIntervista(app, shell);

    await queueChat(app, {
      text: 'Piacere Anna. Se preferisci il tema scuro dimmelo, si cambia parlando.',
      actions: [{ type: 'ONBOARDING', spunta: ['profilo', 'estetica'] }],
    });
    await scrivi(page, 'sono Anna, insegnante');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'tema scuro' })).toBeVisible({ timeout: 30_000 });

    await queueChat(app, { text: 'Va bene. Sulla privacy: cookie rifiutati e pubblicità bloccate già così.', actions: [] });
    await scrivi(page, frase);
    await page.waitForTimeout(3_000);

    expect((await onbState(app)).done, `«${frase}» rifiuta la proposta, non l’accoglienza`).toBe(false);
  });
}

// ── 2. Rifare l'intervista più volte non deve svuotare l'archivio ──────────
test('rilanci ripetuti non devono cancellare la prima intervista dall’archivio', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const page = await apriIntervista(app, shell);

  await queueChat(app, {
    text: 'Piacere Anna, ci siamo.',
    actions: [{ type: 'ONBOARDING', spunta: ['profilo'], fine: true }],
  });
  await scrivi(page, 'sono Anna, insegnante di lettere alle medie');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
  expect((await onbState(app)).done).toBe(true);

  // L'utente rilancia l'intervista e ci ripensa, più volte: apre Preferenze,
  // clicca, torna indietro. Nessuno di quei rilanci è una conversazione.
  const prefs = await openTab('filo://preferences/preferences.html');
  const btn = prefs.locator('#restartOnboarding');
  await expect(btn).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 6; i++) {
    await btn.click();
    await page.waitForTimeout(400);
  }

  const s = await onbState(app);
  const tutte = JSON.stringify(s.past || []);
  await prefs.screenshot({ path: 'tests/.shots/524g2-archivio.png', fullPage: true }).catch(() => {});
  expect(tutte, 'la prima conversazione con Filo deve restare rileggibile').toContain('insegnante di lettere');
});

// ── 3. Testo ostile e testo enorme ─────────────────────────────────────────
test('HTML, script e un messaggio enorme non rompono l’intervista', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const page = await apriIntervista(app, shell);

  await page.evaluate(() => { window.__xss = 0; });
  const cattivo = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>'
    + '<a href="javascript:window.__xss=1">clic</a>   🙂';

  await queueChat(app, {
    text: 'Ricevuto. <img src=x onerror="window.__xss=1"><script>window.__xss=1</script>',
    actions: [{ type: 'ONBOARDING', spunta: ['profilo'] }],
  });
  await scrivi(page, cattivo);
  await page.waitForTimeout(3_000);
  expect(await page.evaluate(() => window.__xss || 0), 'niente esecuzione da testo utente o del modello').toBe(0);

  // Messaggio enorme: non deve far saltare né la chat né lo stato salvato.
  const enorme = 'a'.repeat(200_000);
  await queueChat(app, { text: 'Ok.', actions: [] });
  await scrivi(page, enorme);
  await page.waitForTimeout(4_000);
  const s = await onbState(app);
  expect(s.done).toBe(false);
  expect(s.thread.length).toBeGreaterThan(1);

  // L'archivio in Preferenze regge lo stesso testo senza eseguirlo.
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForTimeout(1_500);
  await prefs.evaluate(() => { window.__xss = 0; });
  await prefs.reload();
  await prefs.waitForLoadState('domcontentloaded');
  await prefs.waitForTimeout(1_500);
  expect(await prefs.evaluate(() => window.__xss || 0)).toBe(0);
  await expect(prefs.locator('#onboardingArchive')).toBeVisible({ timeout: 10_000 });
});

// ── 4. Tre schede nuove insieme ────────────────────────────────────────────
test('tre schede nuove mostrano tutte la stessa intervista aggiornata', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  const page = await apriIntervista(app, shell);

  const t2 = await openTab('filo://newtab/');
  const t3 = await openTab('filo://newtab/');
  await expect(t2.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(t3.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });

  await queueChat(app, { text: 'Piacere Anna, tutto chiaro.', actions: [{ type: 'ONBOARDING', spunta: ['profilo'] }] });
  await scrivi(page, 'sono Anna, insegnante');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  await expect(t2.locator('#bubbles')).toContainText('Piacere Anna', { timeout: 15_000 });
  await expect(t3.locator('#bubbles')).toContainText('Piacere Anna', { timeout: 15_000 });
  // Un solo giro di modello: le altre schede guardano, non rilanciano.
  expect(await chatCalls(app)).toBe(1);
});
