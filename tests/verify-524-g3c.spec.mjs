// #524 — giro 3, sonde su memoria e rilancio a intervista aperta.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app, index = 0) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const wins = app.windows().filter((w) => w.url().startsWith('filo://newtab'));
    if (wins.length > index) { await wins[index].waitForLoadState('domcontentloaded'); return wins[index]; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}
async function setup(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'flash-lite-3', [C.ACTIONS.FILO_LESSON]: 'flash-lite-3',
        [C.ACTIONS.FILO_COMPACT]: 'flash-lite-3', [C.ACTIONS.FILO_DASHBOARD]: 'flash-lite-3',
      },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna, insegnante.\n\nPREFERENZE:\nBrevi.';
      if (all.includes('analizzare l')) return 'LEZIONE: Anna insegna.';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      return globalThis.__chatReplies.shift() || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages); try { onDelta && onDelta(text); } catch (_) {}
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
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await setup(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  return page;
}

// I — «cancella tutta la memoria di Filo»: l'utente lo chiede in chat, digita
// "conferma", e si aspetta che di lui non resti niente. Il testo dell'azione
// promette PROFILO, preferenze apprese e lezioni. La prima conversazione — dove
// ha raccontato chi è — resta però leggibile in Preferenze.
test('I — cancellare la memoria di Filo lascia in Preferenze quello che gli ho raccontato', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  const page = await apriIntervista(app, shell);

  await queueChat(app, {
    text: 'Ci siamo capiti, Anna.',
    actions: [{ type: 'ONBOARDING', spunta: ['profilo'], fine: true }],
  });
  await page.locator('#input').fill('sono Anna, insegno lettere alle medie e ho due figli piccoli');
  await page.locator('#sendBtn').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 60_000 });

  const memPrima = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  console.log('[I] profilo prima:', JSON.stringify(memPrima.PROFILO || ''));

  // Cancellazione totale della memoria, come la esegue Filo dopo la conferma.
  await app.evaluate(async () => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: '', PREFERENZE: '' });
    await globalThis.SN_FILO_MEMORY.clearLessonsBuffer();
  });
  const memDopo = await app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());
  console.log('[I] profilo dopo:', JSON.stringify(memDopo.PROFILO || ''));
  expect(memDopo.PROFILO || '').toBe('');

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForTimeout(1500);
  const testo = await prefs.locator('#onboardingArchive').innerText().catch(() => '');
  console.log('[I] archivio dopo la cancellazione:', JSON.stringify(testo.slice(0, 300)));
  // Se questo assert è verde, quello che l'utente ha raccontato è ancora lì.
  expect(testo).toContain('due figli piccoli');
  // E non c'è nessun modo, in quella sezione, per toglierlo.
  const bottoniElimina = await prefs.locator('#onboardingArchive button').count();
  console.log('[I] pulsanti per rimuovere una conversazione:', bottoniElimina);
  expect(bottoniElimina).toBe(0);
});

// L — rilancio dalle Preferenze MENTRE l'intervista è aperta in un'altra scheda.
test('L — rilanciare l’intervista mentre è già aperta non la sdoppia', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  const page = await apriIntervista(app, shell);
  await queueChat(app, { text: 'Piacere Anna.', actions: [] });
  await page.locator('#input').fill('sono Anna');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  const prefs = await openTab('filo://preferences/preferences.html');
  await expect(prefs.locator('#restartOnboarding')).toBeVisible({ timeout: 15_000 });
  await prefs.locator('#restartOnboarding').click();
  await page.waitForTimeout(2500);

  const s = await onbState(app);
  console.log('[L] thread dopo il rilancio:', JSON.stringify(s.thread.map((m) => `${m.role}: ${m.text.slice(0, 30)}`)));
  console.log('[L] archiviate:', s.past.length);
  // La scheda che aveva l'intervista aperta si riallinea al nuovo inizio invece
  // di restare ferma alla conversazione appena archiviata.
  const bolle = await page.evaluate(() => Array.from(document.querySelectorAll('#bubbles .dash-bubble')).map((b) => b.textContent.slice(0, 30)));
  console.log('[L] bolle nella scheda:', JSON.stringify(bolle));
  expect(s.thread.filter((m) => m.role === 'user').length).toBe(0);
  expect(bolle.some((t) => t.includes('sono Anna'))).toBe(false);
});
