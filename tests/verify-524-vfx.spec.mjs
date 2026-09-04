// SONDA DI VERIFICA #524 — temporanea, va rimossa prima di chiudere il giro.
//
// Attacca l'accoglienza dal punto di vista dell'utente: interruzione a metà
// risposta, «basta così» che il modello ignora, rilancio da Preferenze, due
// schede aperte insieme, testi limite.

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
    globalThis.__hangChat = false;
    globalThis.__prompts = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) {
        return 'PROFILO:\nAnna, insegnante.\n\nPREFERENZE:\nRisposte brevi.';
      }
      if (all.includes('analizzare l')) return 'LEZIONE: L\'utente si chiama Anna.';
      if (all.includes('preparare la dashboard')) {
        return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      }
      globalThis.__prompts.push(all);
      const next = globalThis.__chatReplies.shift();
      return next || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    const maybeHang = async (messages) => {
      const all = JSON.stringify(messages || []);
      const isChat = !all.includes('integrare le nuove lezioni')
        && !all.includes('analizzare l') && !all.includes('preparare la dashboard');
      if (isChat && globalThis.__hangChat) await new Promise(() => {});
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      await maybeHang(messages);
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => {
      await maybeHang(messages);
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

// ── P1: chiude la finestra mentre Filo sta pensando ─────────────────────────
test('P1 — interrotto mentre Filo pensa: alla riapertura la mia risposta è una sola', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);

  await app.evaluate(() => { globalThis.__hangChat = true; });
  await page.locator('#input').fill('sono Anna, insegnante');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-user', { hasText: 'sono Anna' })).toBeVisible({ timeout: 10_000 });
  // Il main ha già messo da parte il mio turno; la risposta non arriverà mai.
  await expect.poll(() => onbState(app).then((s) => s.thread.length), { timeout: 10_000 }).toBe(2);

  // Chiudo (= ricarico la scheda) e riapro: la risposta di Filo adesso arriva.
  await app.evaluate(() => { globalThis.__hangChat = false; });
  await queueChat(app, { text: 'Piacere Anna.', actions: [{ type: 'ONBOARDING', spunta: ['profilo'] }] });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  const s = await onbState(app);
  const mie = s.thread.filter((m) => m.role === 'user' && m.text.includes('sono Anna'));
  console.log('[P1] thread =', JSON.stringify(s.thread.map((m) => `${m.role}: ${m.text.slice(0, 40)}`), null, 1));
  console.log('[P1] scambi contati =', s.thread.filter((m) => m.role === 'user').length);

  // Ricarico ancora: quello che vedo a schermo è la conversazione vera?
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 15_000 });
  const bolleMie = await page.locator('.dash-bubble-user', { hasText: 'sono Anna' }).count();
  console.log('[P1] bolle mie a schermo =', bolleMie);
  await page.screenshot({ path: 'tests/.shots/524-vfx-p1.png' }).catch(() => {});

  expect(mie.length, 'la mia risposta compare una sola volta nella conversazione salvata').toBe(1);
  expect(bolleMie, 'la mia risposta compare una sola volta a schermo').toBe(1);
});

// ── P2: «basta così» che il modello non traduce in una chiusura ─────────────
test('P2 — «basta così»: chiude comunque?', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);

  // Il modello risponde a parole ma si dimentica di chiudere: è il caso
  // realistico su un modello piccolo/economico.
  await queueChat(app, { text: 'Va bene! Allora, dimmi: che tipo di siti frequenti di solito?', actions: [] });
  await page.locator('#input').fill('basta così');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'che tipo di siti' })).toBeVisible({ timeout: 30_000 });

  await page.waitForTimeout(1500);
  const s = await onbState(app);
  console.log('[P2] done dopo «basta così» =', s.done, '| stato pagina =', await page.locator('body').getAttribute('data-state'));
  await page.screenshot({ path: 'tests/.shots/524-vfx-p2.png' }).catch(() => {});
  expect(s.done, '«basta così» chiude tutto in qualsiasi momento').toBe(true);
});

// ── P3: rifare l'intervista non deve buttare via quella di prima ────────────
test('P3 — rifaccio l’intervista: la conversazione di prima è ancora conservata?', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await queueChat(app, { text: 'Piacere Anna.', actions: [{ type: 'ONBOARDING', spunta: ['profilo'], fine: true }] });
  await page.locator('#input').fill('sono Anna, insegnante — basta così');
  await page.locator('#sendBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });

  const dopoChiusura = await onbState(app);
  console.log('[P3] conversazione conservata dopo la chiusura =', dopoChiusura.thread.length, 'messaggi');

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#restartOnboarding').click();
  await expect.poll(() => onbState(app).then((s) => s.done), { timeout: 15_000 }).toBe(false);
  const dopoRilancio = await onbState(app);
  console.log('[P3] dopo il rilancio restano =', dopoRilancio.thread.length, 'messaggi:',
    JSON.stringify(dopoRilancio.thread.map((m) => `${m.role}: ${m.text.slice(0, 30)}`)));

  expect(dopoChiusura.thread.length, 'la conversazione chiusa resta conservata').toBeGreaterThan(1);
  expect(
    dopoRilancio.thread.some((m) => m.text.includes('sono Anna')),
    'rifare l’intervista non cancella quella di prima',
  ).toBe(true);
});

// ── P4: due schede nuove aperte insieme durante l'intervista ────────────────
test('P4 — apro una seconda scheda mentre l’intervista è in corso', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await queueChat(app, { text: 'Piacere Anna.', actions: [{ type: 'ONBOARDING', spunta: ['profilo'] }] });
  await page.locator('#input').fill('sono Anna');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  const page2 = await openTab('filo://newtab/');
  await page2.waitForLoadState('domcontentloaded');
  await page2.waitForTimeout(1500);
  const stato2 = await page2.locator('body').getAttribute('data-state');
  console.log('[P4] seconda scheda, stato =', stato2);
  await page2.screenshot({ path: 'tests/.shots/524-vfx-p4-tab2.png' }).catch(() => {});

  // Rispondo nella SECONDA scheda; poi guardo la prima, che è rimasta ferma.
  await queueChat(app, { text: 'Capito, ti scrivo breve.', actions: [{ type: 'ONBOARDING', spunta: ['stile'] }] });
  if (stato2 === 'thread') {
    await page2.locator('#input').fill('dammi del tu');
    await page2.locator('#sendBtn').click();
    await expect(page2.locator('.dash-bubble-filo', { hasText: 'ti scrivo breve' })).toBeVisible({ timeout: 30_000 });
  }
  const s = await onbState(app);
  console.log('[P4] thread =', JSON.stringify(s.thread.map((m) => `${m.role}: ${m.text.slice(0, 30)}`), null, 1));
  await page.screenshot({ path: 'tests/.shots/524-vfx-p4-tab1.png' }).catch(() => {});
});

// ── P5: testi limite dentro l'intervista ───────────────────────────────────
test('P5 — testi limite: solo spazi, 10.000 caratteri, HTML', async ({ app, shell }) => {
  test.setTimeout(150_000);
  const page = await apriIntervista(app, shell);

  // Solo spazi: non deve partire niente.
  await page.locator('#input').fill('     ');
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(800);
  const dopoSpazi = await onbState(app);
  console.log('[P5] dopo soli spazi, messaggi salvati =', dopoSpazi.thread.length);
  expect(dopoSpazi.thread.length, 'un messaggio di soli spazi non entra nella conversazione').toBe(1);

  // HTML/script nel testo dell'utente.
  await queueChat(app, { text: 'Ricevuto.', actions: [] });
  const cattivo = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script> ciao';
  await page.locator('#input').fill(cattivo);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ricevuto' })).toBeVisible({ timeout: 30_000 });
  await page.reload(); // la ripresa ri-disegna il testo salvato
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dash-bubble-user').first()).toBeVisible({ timeout: 15_000 });
  const xss = await page.evaluate(() => !!window.__xss);
  const imgs = await page.locator('#bubbles img').count();
  console.log('[P5] xss =', xss, '| img iniettate =', imgs);
  expect(xss, 'niente esecuzione di HTML dell’utente').toBe(false);

  // 10.000 caratteri.
  await queueChat(app, { text: 'Ok.', actions: [] });
  await page.locator('#input').fill('a'.repeat(10_000));
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ok.' })).toBeVisible({ timeout: 40_000 });
  await page.screenshot({ path: 'tests/.shots/524-vfx-p5.png' }).catch(() => {});
  const finale = await onbState(app);
  console.log('[P5] messaggi salvati =', finale.thread.length,
    '| più lungo =', Math.max(...finale.thread.map((m) => m.text.length)));
});

// ── P6: doppio clic su invio ───────────────────────────────────────────────
test('P6 — doppio clic rapido su invio', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await queueChat(app,
    { text: 'Prima risposta.', actions: [] },
    { text: 'Seconda risposta.', actions: [] });
  await page.locator('#input').fill('sono Anna');
  await page.locator('#sendBtn').dblclick();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Prima risposta' })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  const s = await onbState(app);
  const mie = s.thread.filter((m) => m.role === 'user').length;
  console.log('[P6] messaggi utente salvati dopo doppio clic =', mie);
  expect(mie, 'un doppio clic non manda il messaggio due volte').toBe(1);
});
