// #524 — verifica avversariale, giro 3.
//
// Non riusa i test di chi ha corretto: ripercorre da fuori le porte dei due
// giri precedenti (uscita senza modello, turni duplicati, archivio, schede
// multiple, rifiuti che non devono chiudere) e ne prova di nuove attorno alla
// riga «abbiamo chiuso a metà» comparsa sulla home.

import { test, expect } from './fixtures/electron.mjs';

function newtabWindows(app) {
  return app.windows().filter((w) => w.url().startsWith('filo://newtab'));
}

async function newtabPage(app, index = 0) {
  const deadline = Date.now() + 15_000;
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
    globalThis.__chatCalls = 0;
    globalThis.__failAll = false;
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
      if (globalThis.__failAll) throw new Error('provider giù');
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
const setFail = (app, v) => app.evaluate((_e, x) => { globalThis.__failAll = x; }, v);

async function apriIntervista(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await useFakeKey(app);
  await stubAgents(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(page.locator('#input')).toBeVisible();
  return page;
}

// Manda un messaggio e aspetta che sia stato consegnato (bolla utente a schermo).
async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

// ─────────────────────────────────────────────────────────────────────────────
// A. I RIFIUTI (rilievo del giro 2): rispondere «no» a una PROPOSTA non deve
//    chiudere tutta l'accoglienza.
// ─────────────────────────────────────────────────────────────────────────────

const RIFIUTI = [
  'no grazie', 'magari dopo', 'più tardi', 'non ora', 'non adesso',
  'lascia stare', 'lascia perdere', 'non mi va', 'passo', 'salto',
  'magari un\'altra volta', 'un\'altra volta', 'ci penso', 'forse dopo',
  'no, grazie', 'No Grazie!', 'ok, magari dopo', 'non ho voglia',
];

test('A — un «no» a una proposta di Filo non chiude l’accoglienza', async ({ app, shell }) => {
  test.setTimeout(240_000);
  const page = await apriIntervista(app, shell);

  const chiuseSubito = [];
  for (const frase of RIFIUTI) {
    // Ogni giro riparte da un'intervista pulita, con Filo che ha appena fatto
    // una PROPOSTA: è il caso del giro 2 (crediti + accesso Google).
    await app.evaluate(async () => {
      const O = globalThis.SN_ONBOARDING;
      await globalThis.SN_FILO_MEMORY.setOnboarding({
        done: false, ticked: ['profilo'], startedAt: new Date().toISOString(),
        thread: [
          { role: 'filo', text: O.WELCOME_MESSAGE },
          { role: 'user', text: 'sono Anna, insegnante' },
          { role: 'filo', text: 'Piacere Anna. I crediti si ricaricano ogni giorno; con l’accesso Google restano tuoi anche dopo una reinstallazione. Vuoi accedere?' },
        ],
      });
    });
    await queueChat(app, { text: 'Va bene, niente accesso. Allora ti dico della privacy…', actions: [] });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });

    await scrivi(page, frase);
    // Aspetta che il turno sia finito in un modo o nell'altro.
    await expect
      .poll(async () => {
        const s = await onbState(app);
        const last = s.thread[s.thread.length - 1];
        return s.done || (last && last.role === 'filo' && !last.text.includes('Vuoi accedere'));
      }, { timeout: 25_000 })
      .toBe(true);

    const s = await onbState(app);
    if (s.done) chiuseSubito.push(frase);
  }
  console.log('[A] rifiuti che hanno chiuso tutta l’accoglienza:', JSON.stringify(chiuseSubito));
  expect(chiuseSubito).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// B. LE VERE USCITE: devono funzionare anche col modello muto.
// ─────────────────────────────────────────────────────────────────────────────

const USCITE = [
  'basta così', 'basta cosi', 'Basta così!', 'ok basta così, grazie',
  'salta', 'stop', 'chiudiamo', 'basta domande', 'niente intervista',
  'salta l\'accoglienza', 'finiamola',
];

test('B — le parole di uscita chiudono anche col provider giù', async ({ app, shell }) => {
  test.setTimeout(240_000);
  const page = await apriIntervista(app, shell);
  await setFail(app, true); // nessuna risposta dal modello, mai

  const nonChiuse = [];
  for (const frase of USCITE) {
    await app.evaluate(async () => {
      const O = globalThis.SN_ONBOARDING;
      await globalThis.SN_FILO_MEMORY.setOnboarding({
        done: false, ticked: [], startedAt: new Date().toISOString(),
        thread: [{ role: 'filo', text: O.WELCOME_MESSAGE }],
      });
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await scrivi(page, frase);
    let chiusa = false;
    try {
      await expect.poll(() => onbState(app).then((s) => s.done), { timeout: 12_000 }).toBe(true);
      chiusa = true;
    } catch (_) { /* resta false */ }
    if (!chiusa) nonChiuse.push(frase);
  }
  console.log('[B] uscite NON riconosciute col modello muto:', JSON.stringify(nonChiuse));
  expect(nonChiuse).toEqual([]);
});

test('B2 — risposte legittime che somigliano a un’uscita NON chiudono', async ({ app, shell }) => {
  test.setTimeout(240_000);
  const page = await apriIntervista(app, shell);

  const LEGITTIME = [
    'no',
    'mi basta poco, sono uno che va di fretta',
    'basta che tu non sia prolisso',
    'va bene',
    'non lo so',
    'stop motion, faccio animazione',
    'lavoro in una ditta che si chiama Chiudi Srl',
  ];
  const chiuse = [];
  for (const frase of LEGITTIME) {
    await app.evaluate(async () => {
      const O = globalThis.SN_ONBOARDING;
      await globalThis.SN_FILO_MEMORY.setOnboarding({
        done: false, ticked: [], startedAt: new Date().toISOString(),
        thread: [{ role: 'filo', text: O.WELCOME_MESSAGE }],
      });
    });
    await queueChat(app, { text: 'Capito. Andiamo avanti.', actions: [] });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
    await scrivi(page, frase);
    await expect
      .poll(async () => {
        const s = await onbState(app);
        return s.done || s.thread.some((m) => m.text.includes('Andiamo avanti'));
      }, { timeout: 25_000 })
      .toBe(true);
    if ((await onbState(app)).done) chiuse.push(frase);
  }
  console.log('[B2] risposte normali scambiate per un’uscita:', JSON.stringify(chiuse));
  expect(chiuse).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// C. LA RIGA «abbiamo chiuso a metà» sulla home (nuova in questo giro).
// ─────────────────────────────────────────────────────────────────────────────

test('C — chiusa a metà: la home lo dice, la riga regge il reload e si toglie', async ({ app, shell }) => {
  test.setTimeout(150_000);
  const page = await apriIntervista(app, shell);

  await page.locator('#skipOnboarding').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });

  const riga = page.locator('#onbNotice');
  await expect(riga).toBeVisible({ timeout: 15_000 });
  await expect(riga).toContainText(/chiuso la presentazione a metà/i);
  await page.screenshot({ path: 'tests/.shots/524-g3-riga-home.png' }).catch(() => {});

  // Regge una riapertura: chi non l'ha letta subito la ritrova.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#onbNotice')).toBeVisible({ timeout: 15_000 });

  // «No, va bene così» la toglie — e non torna più.
  await page.locator('#onbNoticeDismiss').click();
  await expect(page.locator('#onbNotice')).toBeHidden({ timeout: 10_000 });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await expect(page.locator('#onbNotice')).toBeHidden();
});

test('C2 — «Riprendiamola» riapre davvero l’intervista, dalla home', async ({ app, shell }) => {
  test.setTimeout(150_000);
  const page = await apriIntervista(app, shell);
  await page.locator('#skipOnboarding').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 40_000 });
  await expect(page.locator('#onbNotice')).toBeVisible({ timeout: 15_000 });

  await page.locator('#onbNoticeRedo').click();
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(page.locator('.dash-bubble-filo').first()).toContainText('Ciao, sono Filo');
  await expect(page.locator('#skipOnboarding')).toBeVisible();
  expect((await onbState(app)).done).toBe(false);
  // La riga non deve restare a schermo mentre l'intervista è di nuovo aperta.
  await expect(page.locator('#onbNotice')).toBeHidden();
});

test('C3 — intervista COMPLETATA: nessuna riga «chiusa a metà»', async ({ app, shell }) => {
  test.setTimeout(150_000);
  const page = await apriIntervista(app, shell);

  await queueChat(app, {
    text: 'Ci siamo detti tutto, Anna. A dopo.',
    actions: [{
      type: 'ONBOARDING',
      spunta: ['profilo', 'stile', 'estetica', 'privacy', 'modelli', 'crediti'],
      fine: true,
    }],
  });
  await scrivi(page, 'sono Anna, insegnante; scrivimi breve');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  await expect(page.locator('#onbNotice')).toBeHidden();
  const s = await onbState(app);
  expect(s.done).toBe(true);
  expect(s.notice).toBe('');
});

// ─────────────────────────────────────────────────────────────────────────────
// D. L'ARCHIVIO (rilievo del giro 2): la prima conversazione non si perde.
// ─────────────────────────────────────────────────────────────────────────────

test('D — sei rilanci a vuoto non buttano fuori la prima conversazione', async ({ app, shell, openTab }) => {
  test.setTimeout(200_000);
  const page = await apriIntervista(app, shell);

  await queueChat(app, { text: 'Piacere Anna, ti scrivo breve.', actions: [] });
  await scrivi(page, 'sono Anna, insegnante di lettere alle medie');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  const prefs = await openTab('filo://preferences/preferences.html');
  const btn = prefs.locator('#restartOnboarding');
  await expect(btn).toBeVisible({ timeout: 15_000 });

  for (let i = 0; i < 6; i++) {
    await btn.click();
    await page.waitForTimeout(500);
  }

  // Riapro le Preferenze per rileggere l'archivio così come lo vede l'utente.
  await prefs.reload();
  await prefs.waitForLoadState('domcontentloaded');
  const box = prefs.locator('#onboardingArchive');
  await expect(box).toBeVisible({ timeout: 15_000 });
  const voci = await prefs.locator('#onboardingArchive .onb-conv').allTextContents();
  console.log('[D] voci in archivio:', JSON.stringify(voci.map((t) => t.slice(0, 90))));
  // La prima conversazione vera è ancora lì, con quello che l'utente ha scritto.
  await expect(box).toContainText('insegnante di lettere alle medie', { timeout: 10_000 });
  // E l'archivio non si è riempito di conversazioni senza risposte.
  const vuote = await prefs.evaluate(() => {
    const O = window.SN_ONBOARDING;
    return document.querySelectorAll('#onboardingArchive .onb-conv').length && O ? null : null;
  });
  expect(vuote).toBeNull();
  const s = await onbState(app);
  const passateVuote = s.past.filter((p) => !p.thread.some((m) => m.role === 'user')).length;
  console.log('[D] conversazioni archiviate:', s.past.length, '| di cui senza risposte:', passateVuote);
  expect(passateVuote).toBe(0);
  expect(s.past.some((p) => p.thread.some((m) => m.text.includes('insegnante di lettere')))).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// E. SCHEDE MULTIPLE + turno interrotto (rilievi del giro 1).
// ─────────────────────────────────────────────────────────────────────────────

test('E — due schede nuove: stessa intervista, si aggiornano insieme, una sola chiamata', async ({ app, shell }) => {
  test.setTimeout(180_000);
  const a = await apriIntervista(app, shell);

  await queueChat(app, { text: 'Piacere Anna.', actions: [] });
  await scrivi(a, 'sono Anna');
  await expect(a.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  const prima = await app.evaluate(() => globalThis.__chatCalls);
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  const b = await newtabPage(app, 1);
  await expect(b.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 20_000 });
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 15_000 });

  // La seconda scheda non rilancia il turno già fatto.
  await b.waitForTimeout(1500);
  expect(await app.evaluate(() => globalThis.__chatCalls)).toBe(prima);

  // Scrivo nella seconda: la prima si riallinea da sé.
  await queueChat(app, { text: 'Capito, ti do del tu.', actions: [] });
  await scrivi(b, 'dammi del tu');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'ti do del tu' })).toBeVisible({ timeout: 30_000 });
  await expect(a.locator('.dash-bubble-user', { hasText: 'dammi del tu' })).toBeVisible({ timeout: 15_000 });
  await expect(a.locator('.dash-bubble-filo', { hasText: 'ti do del tu' })).toBeVisible({ timeout: 15_000 });

  // Nessun doppione nella conversazione salvata.
  const s = await onbState(app);
  const utente = s.thread.filter((m) => m.role === 'user').map((m) => m.text);
  console.log('[E] messaggi utente salvati:', JSON.stringify(utente));
  expect(utente).toEqual(['sono Anna', 'dammi del tu']);
});

test('E2 — errore + Riprova: la risposta non viene contata due volte', async ({ app, shell }) => {
  test.setTimeout(180_000);
  const page = await apriIntervista(app, shell);

  await setFail(app, true);
  await scrivi(page, 'sono Anna e insegno lettere');
  const retry = page.locator('#retryBtn, .dash-retry, button:has-text("Riprova")').first();
  await expect(retry).toBeVisible({ timeout: 30_000 });
  // Il pulsante che non passa dal modello deve stare lì accanto.
  await expect(page.locator('.dash-skip-onboarding').first()).toBeVisible({ timeout: 10_000 });

  await setFail(app, false);
  await queueChat(app, { text: 'Piacere Anna.', actions: [] });
  await retry.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Piacere Anna' })).toBeVisible({ timeout: 30_000 });

  const s = await onbState(app);
  const utente = s.thread.filter((m) => m.role === 'user').map((m) => m.text);
  console.log('[E2] messaggi utente salvati:', JSON.stringify(utente));
  expect(utente).toEqual(['sono Anna e insegno lettere']);
});

// ─────────────────────────────────────────────────────────────────────────────
// F. L'intervista non può diventare infinita, e non esegue quello che le scrivo.
// ─────────────────────────────────────────────────────────────────────────────

test('F — un modello che non chiude mai: l’accoglienza finisce lo stesso', async ({ app, shell }) => {
  test.setTimeout(240_000);
  const page = await apriIntervista(app, shell);

  for (let i = 0; i < 14; i++) {
    if ((await onbState(app)).done) break;
    await queueChat(app, { text: `Interessante. Dimmi altro (${i}).`, actions: [] });
    await scrivi(page, `risposta numero ${i}`);
    await expect
      .poll(async () => {
        const s = await onbState(app);
        return s.done || s.thread.some((m) => m.text.includes(`Dimmi altro (${i})`));
      }, { timeout: 30_000 })
      .toBe(true);
  }
  const s = await onbState(app);
  const scambi = s.thread.filter((m) => m.role === 'user').length;
  console.log('[F] scambi consumati prima della chiusura:', scambi, '| chiusa:', s.done);
  expect(s.done).toBe(true);
});

test('G — HTML e script scritti in chat non eseguono, né in chat né in Preferenze', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  const page = await apriIntervista(app, shell);

  await page.evaluate(() => { window.__hit = 0; });
  const cattivo = '<img src=x onerror="window.__hit=(window.__hit||0)+1"><script>window.__hit=99<\/script>';
  await queueChat(app, { text: `Ecco: ${cattivo}`, actions: [] });
  await scrivi(page, cattivo);
  await page.waitForTimeout(3000);
  const hit = await page.evaluate(() => window.__hit || 0);
  const img = await page.evaluate(() => document.querySelectorAll('#bubbles img').length);
  console.log('[G] esecuzioni in chat:', hit, '| img iniettate:', img);
  expect(hit).toBe(0);

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.evaluate(() => { window.__hit = 0; });
  await prefs.reload();
  await prefs.waitForLoadState('domcontentloaded');
  await prefs.waitForTimeout(1500);
  const hit2 = await prefs.evaluate(() => window.__hit || 0);
  const img2 = await prefs.evaluate(() => document.querySelectorAll('#onboardingArchive img, #onboardingArchive script').length);
  console.log('[G] esecuzioni in Preferenze:', hit2, '| nodi iniettati:', img2);
  expect(hit2).toBe(0);
  expect(img2).toBe(0);
});
