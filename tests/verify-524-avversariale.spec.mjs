// #524 — sonda avversariale del verificatore. NON fa parte della suite: va
// tolta prima della consegna.
//
// Verifica dal punto di vista dell'utente nuovo: l'accoglienza regge le vie
// storte (chiusura a metà risposta, «basta così» non raccolto dal modello,
// risposte enormi o con HTML dentro, uscita dalla conversazione).

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

async function stubAgents(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    globalThis.__seen = { lesson: 0, compact: 0, dashboard: 0, chat: 0 };
    globalThis.__prompts = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) {
        globalThis.__seen.compact += 1;
        return 'PROFILO:\nAnna, insegnante.\n\nPREFERENZE:\nRisposte brevi.';
      }
      if (all.includes('analizzare l')) {
        globalThis.__seen.lesson += 1;
        return 'LEZIONE: L\'utente si chiama Anna.';
      }
      if (all.includes('preparare la dashboard')) {
        globalThis.__seen.dashboard += 1;
        return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      }
      globalThis.__seen.chat += 1;
      globalThis.__prompts.push(all.slice(0, 20000));
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

// ── 1. «basta così» che il modello non raccoglie ────────────────────────────
// Il PRIMO messaggio, scritto a mano, promette: «scrivi "basta così" e
// chiudiamo». Se la promessa vive solo nell'obbedienza del modello, un modello
// che non emette l'azione lascia l'utente dentro un'intervista che ha appena
// chiesto di chiudere.
test('AVV1 — «basta così» quando il modello non chiude', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  // Il modello risponde ma "si dimentica" di chiudere (nessuna azione).
  await queueChat(app, { text: 'Certo! Allora dimmi: che siti usi di più?', actions: [] });
  await page.locator('#input').fill('basta così');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'che siti usi' })).toBeVisible({ timeout: 30_000 });

  await page.waitForTimeout(1500);
  const s = await onbState(app);
  console.log('AVV1 done dopo «basta così» ignorato:', s.done, 'turni:', s.thread.length);
  expect(s.done, 'l’intervista deve chiudersi quando l’utente dice «basta così»').toBe(true);
});

// ── 2. chiusura della finestra mentre Filo risponde ─────────────────────────
// L'utente risponde e chiude la finestra prima che la risposta arrivi.
// Riaprendo, la conversazione deve tornare com'era: la sua frase UNA volta.
test('AVV2 — chiusa a metà risposta: la frase dell’utente non si duplica', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  // Stato "ho risposto e ho chiuso prima che rispondesse": l'ultimo turno è suo.
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    await M.setOnboarding({
      done: false, ticked: [],
      thread: [
        { role: 'filo', text: O.WELCOME_MESSAGE },
        { role: 'user', text: 'sono Anna, insegnante' },
      ],
    });
  });

  await queueChat(app, { text: 'Piacere Anna.', actions: [{ type: 'ONBOARDING', spunta: ['profilo'] }] });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  const s = await onbState(app);
  const mie = s.thread.filter((m) => m.role === 'user' && m.text.includes('sono Anna'));
  console.log('AVV2 thread:', JSON.stringify(s.thread.map((m) => `${m.role}:${m.text.slice(0, 40)}`), null, 1));
  expect(mie.length, 'la frase dell’utente deve restare una sola').toBe(1);

  // E a schermo, riaprendo di nuovo, non deve comparire due volte.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
  await expect(page.locator('.dash-bubble-user', { hasText: 'sono Anna' })).toHaveCount(1);
});

// ── 3. risposta enorme, emoji, HTML ─────────────────────────────────────────
test('AVV3 — risposta lunghissima, emoji e HTML: regge e non inietta', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  const lungo = 'sono Anna 👩‍🏫 <img src=x onerror="window.__pwn=1"> <script>window.__pwn2=1</script> '
    + 'lavoro '.repeat(1400); // > 10.000 caratteri
  await queueChat(app, { text: 'Ricevuto.', actions: [{ type: 'ONBOARDING', spunta: ['profilo'] }] });
  await page.locator('#input').fill(lungo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ricevuto' })).toBeVisible({ timeout: 40_000 });

  expect(await page.evaluate(() => !!window.__pwn || !!window.__pwn2)).toBe(false);
  expect(await page.locator('#bubbles img').count()).toBe(0);
  const s = await onbState(app);
  expect(s.ticked).toContain('profilo');
  expect(s.done).toBe(false);

  // Riapertura: la bolla enorme torna, sempre come testo.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => !!window.__pwn || !!window.__pwn2)).toBe(false);
  await page.screenshot({ path: 'tests/.shots/524-avv-lungo.png', fullPage: false }).catch(() => {});
});

// ── 4. uscire dalla conversazione a intervista aperta ───────────────────────
// `/home` (o `/clear`) porta l'utente fuori dal thread. Con l'intervista aperta
// la home non è mai stata caricata: cosa vede?
test('AVV4 — /home durante l’intervista', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  await page.locator('#input').fill('/home');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(2500);
  const stato = await page.locator('body').getAttribute('data-state');
  const msg = (await page.locator('#homeMessage').textContent()) || '';
  const cls = await page.locator('#homeMessage').getAttribute('class');
  console.log('AVV4 stato:', stato, '| homeMessage:', JSON.stringify(msg.slice(0, 120)), '| class:', cls);
  await page.screenshot({ path: 'tests/.shots/524-avv-home.png' }).catch(() => {});
  // L'utente non deve restare davanti a una home vuota/in caricamento perenne.
  expect(msg.trim().length, 'la home non deve restare muta').toBeGreaterThan(0);
});

// ── 5. il modello non chiude mai: l’intervista finisce lo stesso? ───────────
test('AVV5 — modello che non chiude mai: l’intervista termina', async ({ app, shell }) => {
  test.setTimeout(240_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  for (let i = 0; i < 14; i += 1) {
    const s = await onbState(app);
    if (s.done) break;
    await queueChat(app, { text: `Domanda numero ${i + 1}?`, actions: [] });
    await page.locator('#input').fill(`risposta ${i + 1}`);
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-filo', { hasText: `Domanda numero ${i + 1}?` }))
      .toBeVisible({ timeout: 40_000 });
  }
  await page.waitForTimeout(2000);
  const s = await onbState(app);
  console.log('AVV5 done:', s.done, 'turni utente:', s.thread.filter((m) => m.role === 'user').length);
  expect(s.done, 'un’intervista che non finisce mai è peggio di una incompleta').toBe(true);
});

// ── 6. doppio clic su invio ────────────────────────────────────────────────
test('AVV6 — doppio clic rapido su invio: un turno solo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  await queueChat(app,
    { text: 'Prima risposta.', actions: [] },
    { text: 'Seconda risposta.', actions: [] });
  await page.locator('#input').fill('sono Anna');
  await page.locator('#sendBtn').dblclick();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Prima risposta' })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await expect(page.locator('.dash-bubble-user', { hasText: 'sono Anna' })).toHaveCount(1);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Seconda risposta' })).toHaveCount(0);
});

// ── 7. campo vuoto / soli spazi ────────────────────────────────────────────
test('AVV7 — invio a vuoto non consuma un turno', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  const prima = await app.evaluate(() => globalThis.__seen.chat);
  await page.locator('#input').fill('   ');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(1200);
  const dopo = await app.evaluate(() => globalThis.__seen.chat);
  expect(dopo).toBe(prima);
  const s = await onbState(app);
  expect(s.thread.filter((m) => m.role === 'user').length).toBe(0);
});
