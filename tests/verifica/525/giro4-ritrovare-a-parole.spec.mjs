// #525 — giro 4. «Filo in chat deve poterle ritrovare ("riprendi la
// discussione di ieri sulla coscienza")»: è l'ultima cosa che il feedback
// chiede. Qui si prova COME ci arriva: con quali parole l'assistente cerca, e
// cosa succede quando gliele passa come le ha sentite.
//
// In più: la pagina guardata, chiara e scura, con un titolo lungo e una chat
// ancora in corso in mezzo alle altre.

import { test, expect } from '../../fixtures/electron.mjs';

const ARCHIVE = 'filo://archive/archive.html';

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash',
        [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
        [C.ACTIONS.FILO_CHAT_TRIAGE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}

async function stubProvider(app, triage) {
  await app.evaluate(async (_e, { triage }) => {
    globalThis.__filoTriage = triage;
    const rispondi = async ({ attempts, messages }) => {
      const joined = messages
        .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n');
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      if (joined.includes('Classifichi le conversazioni')) {
        for (const [ago, risposta] of Object.entries(globalThis.__filoTriage || {})) {
          if (joined.includes(ago)) return { ...base, text: JSON.stringify(risposta) };
        }
        return { ...base, text: JSON.stringify({ tipo: 'conversazione', titolo: 'Senza etichetta' }) };
      }
      return { ...base, text: JSON.stringify({ text: 'Va bene, ci penso.', actions: [] }) };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = rispondi;
  }, { triage });
}

function turno(app, chatId, userMessage) {
  return app.evaluate(
    (_e, { chatId, userMessage }) =>
      globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId }),
    { chatId, userMessage },
  );
}

function cercaComeFilo(app, query) {
  return app.evaluate(
    (_e, q) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'CERCA_CHAT', query: q }),
    query,
  );
}

function leggiArchivio(app) {
  return app.evaluate(() => globalThis.SN_FILO_CHATS.list());
}

// ─────────────────────────────────────────────────────────────────────────────

test('Filo cerca la chat con le parole con cui l’utente gliel’ha chiesta', async ({ app }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { coscienza: { tipo: 'conversazione', titolo: 'La coscienza e il libero arbitrio' } });

  await turno(app, 'c-coscienza', 'Parliamo della coscienza: è un fenomeno emergente?');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-coscienza'));
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).kind || '', { timeout: 30_000 }).toBe('conversazione');

  // La parola sola la trova: è il caso facile.
  const conParola = await cercaComeFilo(app, 'coscienza');
  const idsParola = ((conParola.output || {}).results || []).map((r) => r.id);
  console.log('CERCA «coscienza»:', JSON.stringify(idsParola));
  expect(idsParola).toContain('c-coscienza');

  // E se cerca con la frase dell'utente, come lo strumento gli suggerisce di
  // poter fare («le parole da cercare: argomento, nomi, FRASI»)? È la chat
  // giusta, e l'utente l'ha chiesta così.
  const esiti = {};
  for (const q of [
    'la discussione di ieri sulla coscienza',
    'discussione sulla coscienza',
    'coscienza libero arbitrio',
  ]) {
    const r = await cercaComeFilo(app, q);
    esiti[q] = ((r.output || {}).results || []).map((x) => x.id);
  }
  console.log('CERCA A FRASI:', JSON.stringify(esiti, null, 1));
  for (const [q, ids] of Object.entries(esiti)) {
    expect(ids, `query: ${q}`).toContain('c-coscienza');
  }
});

test('la pagina guardata: titolo lungo, chat in corso, chiaro e scuro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, {
    Epicuro: { tipo: 'conversazione', titolo: 'Una discussione lunghissima su Epicuro, il piacere, il dolore e la morte' },
    sveglia: { tipo: 'comando', titolo: 'Sveglia alle sette' },
  });

  await turno(app, 'c-lunga', 'Discutiamo di Epicuro');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-lunga'));
  await turno(app, 'c-cmd', 'Metti una sveglia alle 7');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-cmd'));
  await expect.poll(async () => (await leggiArchivio(app)).filter((c) => c.kind).length, { timeout: 30_000 }).toBe(2);
  await turno(app, 'c-viva', 'Questa la sto ancora scrivendo');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('.arc-chat').first()).toBeVisible({ timeout: 20_000 });
  await page.locator('#showCommands').check();
  await page.waitForTimeout(300);

  // Il titolo lungo non deve uscire dalla riga né coprire la data.
  const misure = await page.evaluate(() => [...document.querySelectorAll('.arc-chat')].map((r) => {
    const t = r.querySelector('.arc-chat-title');
    const d = r.querySelector('.arc-chat-date');
    const rr = r.getBoundingClientRect(); const tr = t.getBoundingClientRect(); const dr = d.getBoundingClientRect();
    return {
      titolo: t.textContent.slice(0, 40),
      sborda: tr.right > rr.right + 1,
      sovrappone: tr.right > dr.left + 1,
      tagliato: t.scrollWidth > t.clientWidth + 1,
    };
  }));
  console.log('RIGHE:', JSON.stringify(misure, null, 1));

  await page.screenshot({ path: 'tests/.shots/525-giro4-cronologia-chiaro.png', fullPage: true });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    window.SN_PAGE_BOOTSTRAP.applyTheme('dark');
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/525-giro4-cronologia-scuro.png', fullPage: true });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('light'));

  for (const m of misure) {
    expect(m.sborda, `titolo fuori riga: ${m.titolo}`).toBeFalsy();
    expect(m.sovrappone, `titolo sopra la data: ${m.titolo}`).toBeFalsy();
  }
});
