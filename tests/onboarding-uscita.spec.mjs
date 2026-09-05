// #524 (correzione) — le quattro strade che l'accoglienza non reggeva.
//
// La micro-intervista funzionava finché il modello collaborava. Fuori da lì:
//
//   RILIEVO 1 — «basta così» dipendeva tutto dalla risposta del modello. Se
//     rispondeva a parole senza chiudere, l'intervista proseguiva; se non
//     rispondeva affatto (rete assente, provider giù, crediti finiti) l'unico
//     bottone a schermo era "Riprova" e alla home non ci si arrivava più. Chi
//     apriva Filo la prima volta senza rete era in un vicolo cieco, con davanti
//     una frase che gli diceva di scrivere una cosa che non funzionava.
//   RILIEVO 2 — un turno interrotto (finestra chiusa mentre Filo scriveva,
//     "Riprova" dopo un errore, seconda scheda aperta durante l'attesa) salvava
//     la risposta dell'utente DUE volte, e ne contava due dei cinque scambi:
//     un intoppo di rete costava una delle cose che Filo doveva scoprire.
//   RILIEVO 3 — "Rifai l'intervista" sostituiva quella di prima, che spariva
//     per sempre, e non c'era nessun posto dove rileggerla.
//   RILIEVO 4 — con due schede nuove aperte insieme l'intervista compariva in
//     entrambe, e quella dove non si scriveva restava ferma alla conversazione
//     vecchia.
//
// Ogni test qui sotto è rosso senza la correzione.

import { test, expect } from './fixtures/electron.mjs';

function newtabWindows(app) {
  return app.windows().filter((w) => w.url().startsWith('filo://newtab'));
}

async function newtabPage(app, index = 0) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const wins = newtabWindows(app);
    if (wins.length > index) {
      await wins[index].waitForLoadState('domcontentloaded');
      return wins[index];
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`newtab #${index} non trovata`);
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
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

// Stub del provider con due manopole in più rispetto a onboarding.spec.mjs:
//   __chatCalls  — quante volte la CHAT è arrivata davvero al modello;
//   __failChat   — quanti dei prossimi turni di chat devono fallire (provider
//                  giù). Serve a riprodurre il vicolo cieco e il "Riprova".
async function stubAgents(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    globalThis.__chatCalls = 0;
    globalThis.__failChat = 0;
    globalThis.__failAll = false;
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (globalThis.__failAll) throw new Error('provider giù');
      if (all.includes('integrare le nuove lezioni')) {
        return 'PROFILO:\nAnna, insegnante.\n\nPREFERENZE:\nRisposte brevi.';
      }
      if (all.includes('analizzare l')) return 'LEZIONE: L\'utente si chiama Anna.';
      if (all.includes('preparare la dashboard')) {
        return JSON.stringify({ message: 'Buongiorno Anna.', suggestions: [] });
      }
      globalThis.__chatCalls += 1;
      if (globalThis.__failChat > 0) {
        globalThis.__failChat -= 1;
        throw new Error('provider giù');
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
const chatCalls = (app) => app.evaluate(() => globalThis.__chatCalls);

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

// ── RILIEVO 1 ─────────────────────────────────────────────────────────────

test('«basta così» chiude anche se il modello non risponde mai', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  // Provider giù su tutta la linea: chat, lezioni, compattatore, home.
  await app.evaluate(() => { globalThis.__failAll = true; });
  const primaDelleChiamate = await chatCalls(app);

  await page.locator('#input').fill('basta così');
  await page.locator('#sendBtn').click();

  // L'utente arriva davvero alla home: è il punto. Prima, col provider giù,
  // restava dentro l'accoglienza col solo "Riprova" davanti.
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 30_000 });
  const s = await onbState(app);
  expect(s.done).toBe(true);
  // Il congedo è un testo fisso, scritto a mano: c'è comunque, senza aver
  // chiesto niente a nessuno. (A schermo dura quanto ci mette la home ad
  // arrivare — qui, con tutto giù, un istante.)
  expect(s.thread[s.thread.length - 1].text).toContain('chiudo qui');
  // Nessuna chiamata al modello per chiudere: la parola la riconosce l'app.
  expect(await chatCalls(app)).toBe(primaDelleChiamate);

  // Riaprendo non ricomincia: è chiusa davvero.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
});

test('«basta così» chiude anche se il modello risponde ma si dimentica di chiudere', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  // Il modello, se fosse interpellato, tirerebbe dritto con un'altra domanda:
  // è quello che fanno i modelli piccoli quando l'istruzione è una fra molte.
  await queueChat(app, { text: 'E che siti guardi di solito?', actions: [] });

  await page.locator('#input').fill('Basta così, grazie');
  await page.locator('#sendBtn').click();

  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
  expect((await onbState(app)).done).toBe(true);
  await expect(page.locator('#bubbles')).not.toContainText('E che siti guardi');
});

test('col modello irraggiungibile la via d’uscita è a schermo, accanto al "Riprova"', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  // L'uscita c'è già prima di qualsiasi errore: chi non ricorda la frase la vede.
  await expect(page.locator('#skipOnboarding')).toBeVisible({ timeout: 10_000 });

  await app.evaluate(() => { globalThis.__failChat = 5; });
  await page.locator('#input').fill('sono Anna, insegnante');
  await page.locator('#sendBtn').click();

  // Bolla d'errore col "Riprova"… e accanto la porta per uscirne.
  const azioni = page.locator('.dash-bubble-actions').last();
  await expect(azioni.getByRole('button', { name: /Riprova/ })).toBeVisible({ timeout: 30_000 });
  const salta = azioni.getByRole('button', { name: /Salta e vai alla home/ });
  await expect(salta).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/524-uscita-errore.png' }).catch(() => {});

  await salta.click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 30_000 });
  expect((await onbState(app)).done).toBe(true);
});

// ── RILIEVO 2 ─────────────────────────────────────────────────────────────

test('un turno interrotto non salva né conta la risposta due volte', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apriIntervista(app, shell);
  await expect(page.locator('#input')).toBeVisible();

  // Primo tentativo: il provider cade. La risposta dell'utente è già salvata.
  await app.evaluate(() => { globalThis.__failChat = 1; });
  await page.locator('#input').fill('sono Anna, insegnante');
  await page.locator('#sendBtn').click();
  const riprova = page.locator('.dash-bubble-actions').last().getByRole('button', { name: /Riprova/ });
  await expect(riprova).toBeVisible({ timeout: 30_000 });

  // "Riprova": stesso messaggio, e stavolta va.
  await queueChat(app, { text: 'Piacere Anna.', actions: [{ type: 'ONBOARDING', spunta: ['profilo'] }] });
  await riprova.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  const s = await onbState(app);
  const mie = s.thread.filter((m) => m.role === 'user');
  expect(mie.length).toBe(1); // prima erano due
  expect(mie[0].text).toContain('Anna');

  // Ricarico a metà del turno seguente: la ripresa non aggiunge un'altra copia.
  await app.evaluate(() => { globalThis.__failChat = 1; });
  await page.locator('#input').fill('scrivimi breve');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-actions').last().getByRole('button', { name: /Riprova/ }))
    .toBeVisible({ timeout: 30_000 });

  await queueChat(app, { text: 'Va bene, breve.', actions: [] });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Va bene, breve' })).toBeVisible({ timeout: 30_000 });

  const s2 = await onbState(app);
  const mie2 = s2.thread.filter((m) => m.role === 'user');
  expect(mie2.length).toBe(2); // prima erano quattro: due scambi bruciati su cinque
  expect(mie2.map((m) => m.text).join(' | ')).toContain('scrivimi breve');
});

// ── RILIEVO 3 ─────────────────────────────────────────────────────────────

test('rifare l’intervista non cancella quella di prima, e si rilegge da Preferenze', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await newtabPage(app);

  // Un'intervista già fatta e chiusa.
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setOnboarding({
    done: true,
    ticked: ['profilo'],
    startedAt: '2026-08-01T09:00:00.000Z',
    closedAt: '2026-08-01T09:05:00.000Z',
    thread: [
      { role: 'filo', text: 'Ciao, sono Filo. Chi sei?' },
      { role: 'user', text: 'sono Anna, insegnante delle medie' },
      { role: 'filo', text: 'Piacere Anna.' },
    ],
  }));

  const prefs = await openTab('filo://preferences/preferences.html');
  // Prima ancora di rifarla, la conversazione conservata è lì da rileggere.
  await expect(prefs.locator('#onboardingArchive')).toBeVisible({ timeout: 10_000 });
  await expect(prefs.locator('#onboardingArchive')).toContainText('insegnante delle medie');

  await prefs.locator('#restartOnboarding').click();
  await expect.poll(() => onbState(app), { timeout: 15_000 }).toMatchObject({ done: false, ticked: [] });

  // La prima non è sparita: è archiviata.
  const s = await onbState(app);
  expect(s.past.length).toBe(1);
  expect(JSON.stringify(s.past[0].thread)).toContain('insegnante delle medie');

  // E resta leggibile in Preferenze, accanto a quella nuova.
  await expect(prefs.locator('#onboardingArchive')).toContainText('insegnante delle medie');
  await expect(prefs.locator('.onb-conv')).toHaveCount(2);
  await prefs.screenshot({ path: 'tests/.shots/524-interviste-conservate.png' }).catch(() => {});
});

// ── RILIEVO 4 ─────────────────────────────────────────────────────────────

test('due schede nuove mostrano la STESSA intervista, non una ferma a com’era', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const prima = await apriIntervista(app, shell);
  await expect(prima.locator('#input')).toBeVisible();

  // Seconda scheda nuova, aperta accanto alla prima.
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const seconda = await newtabPage(app, 1);
  await expect(seconda.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  await expect(seconda.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo');

  // L'utente risponde nella PRIMA.
  await queueChat(app, { text: 'Piacere Anna, ti scrivo breve.', actions: [] });
  await prima.locator('#input').fill('sono Anna, insegnante');
  await prima.locator('#sendBtn').click();
  await expect(prima.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  // La seconda si aggiorna da sé: prima restava ferma al solo benvenuto.
  await expect(seconda.locator('.dash-bubble-user', { hasText: 'sono Anna' }))
    .toBeVisible({ timeout: 20_000 });
  await expect(seconda.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible();

  // E il turno non è ripartito due volte: una sola copia della risposta.
  const s = await onbState(app);
  expect(s.thread.filter((m) => m.role === 'user').length).toBe(1);
});
