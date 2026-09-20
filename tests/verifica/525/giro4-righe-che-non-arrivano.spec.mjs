// #525 — giro 4. Il giro 3 aveva trovato che le righe che Filo scrive
// rispondendo a un comando con lo slash non arrivavano nell'archivio, e quella
// porta è stata chiusa. Qui si prova la porta gemella: la MODALITÀ TERMINALE,
// che scrive nella stessa conversazione (il comando e il suo esito) passando
// per un'altra strada.
//
// E si guarda cosa si può fare a una chat finita: il titolo lo scrive un
// modello, il tipo pure, e chi rilegge l'elenco non ha modo di correggerli.

import { test, expect } from '../../fixtures/electron.mjs';

const ARCHIVE = 'filo://archive/archive.html';
const DASH = 'filo://dashboard/dashboard.html';

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, { extra }) => {
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
      ...extra,
    });
  }, { extra });
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

function leggiArchivio(app) {
  return app.evaluate(() => globalThis.SN_FILO_CHATS.list());
}

function turno(app, chatId, userMessage) {
  return app.evaluate(
    (_e, { chatId, userMessage }) =>
      globalThis.SN_HANDLE_FILO_CHAT({ userMessage, threadHistory: [], chatId }),
    { chatId, userMessage },
  );
}

// ─────────────────────────────────────────────────────────────────────────────

test('la modalità terminale scrive nella chat: rileggendola, il comando c’è ancora', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await configura(app, { terminal: { enabled: true } });
  await stubProvider(app, { Kant: { tipo: 'conversazione', titolo: 'Kant' } });

  const dash = await openTab(DASH);
  // Prima una battuta normale: la conversazione esiste.
  await dash.locator('#input').fill('Parlami di Kant');
  await dash.locator('#input').press('Enter');
  await expect(dash.locator('.dash-bubble-filo').first()).toBeVisible({ timeout: 30_000 });

  // Poi, nella stessa conversazione, un comando di terminale. L'utente lo vede
  // a schermo dentro questa chat, con il suo esito.
  await dash.locator('#input').fill('/echo ciao-dal-terminale');
  await dash.locator('#input').press('Enter');
  await expect.poll(
    async () => dash.evaluate(() => document.body.innerText),
    { timeout: 40_000 },
  ).toContain('ciao-dal-terminale');

  const aSchermo = await dash.evaluate(() =>
    [...document.querySelectorAll('.dash-bubble')].map((b) => b.textContent.trim().slice(0, 60)));
  console.log('A SCHERMO:', JSON.stringify(aSchermo, null, 1));

  // Si torna alla home: la chat è finita.
  await dash.locator('#input').fill('/home');
  await dash.locator('#input').press('Enter');
  await expect.poll(async () => {
    const c = (await leggiArchivio(app))[0];
    return c && c.closedAt ? 'chiusa' : 'aperta';
  }, { timeout: 40_000 }).toBe('chiusa');

  const c = (await leggiArchivio(app))[0];
  const testi = c.messages.map((m) => `${m.role}: ${m.text}`);
  console.log('IN ARCHIVIO:', JSON.stringify(testi.map((t) => t.slice(0, 70)), null, 1));

  // Quello che l'utente ha letto a schermo dentro questa conversazione deve
  // ritrovarsi rileggendola: il comando e il suo esito.
  expect(testi.join('\n')).toContain('ciao-dal-terminale');
});

test('una chat finita: cosa si può farle dal suo menu del tasto destro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await configura(app);
  await stubProvider(app, { Spinoza: { tipo: 'comando', titolo: 'Sveglia impostata' } });

  // Il classificatore sbaglia: una discussione finisce fra i comandi. È il caso
  // che il feedback mette in conto («un errore di classificazione costa un clic
  // in più»): vediamo che cosa può fare l'utente per rimetterla a posto.
  await turno(app, 'c-malclassificata', 'Discutiamo a lungo di Spinoza e della sostanza');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-malclassificata'));
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).kind || '', { timeout: 30_000 }).toBe('comando');

  const page = await openTab(ARCHIVE);
  await expect(page.locator('#showCommandsLabel')).toBeVisible({ timeout: 20_000 });
  await page.locator('#showCommands').check();
  const riga = page.locator('.arc-chat').first();
  await expect(riga).toBeVisible({ timeout: 20_000 });

  await riga.click({ button: 'right' });
  const voci = await page.evaluate(() =>
    [...document.querySelectorAll('.arc-ctxmenu .sn-select-option')].map((o) => o.textContent.trim()));
  console.log('VOCI DEL MENU DI UNA CHAT:', JSON.stringify(voci));
  expect(voci.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'tests/.shots/525-giro4-menu-chat-chiaro.png' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    window.SN_PAGE_BOOTSTRAP.applyTheme('dark');
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/525-giro4-menu-chat-scuro.png' });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('light'));

  // Il titolo e il tipo li ha scritti un modello. Se ha sbagliato, l'utente
  // deve poterli correggere: nell'Editor un titolo generato si rinomina e si
  // rigenera dallo stesso menu.
  const puoCorreggere = voci.some((v) => /rinomin|titolo|conversazion|sposta|tipo/i.test(v));
  expect(puoCorreggere, `menu: ${JSON.stringify(voci)}`).toBeTruthy();

  // Rimessa fra le conversazioni, ci resta: il classificatore non la rimanda
  // indietro alla prossima chiusura.
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Sposta fra le conversazioni' }).click();
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).kind || '', { timeout: 20_000 }).toBe('conversazione');

  // E il titolo si corregge sul posto.
  await riga.click({ button: 'right' });
  await page.locator('.arc-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  const campo = page.locator('.arc-chat-rename');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  await campo.fill('Spinoza e la sostanza');
  await campo.press('Enter');
  await expect.poll(async () => ((await leggiArchivio(app))[0] || {}).title || '', { timeout: 20_000 })
    .toBe('Spinoza e la sostanza');

  // Quello che ha scelto l'utente vince anche dopo che la conversazione va
  // avanti e viene riclassificata.
  await turno(app, 'c-malclassificata', 'Un altro pezzo di discussione');
  await app.evaluate(() => globalThis.SN_CLOSE_FILO_CHAT('c-malclassificata'));
  await page.waitForTimeout(2500);
  const dopo = (await leggiArchivio(app)).find((c) => c.id === 'c-malclassificata');
  console.log('DOPO LA RICLASSIFICAZIONE:', JSON.stringify({ title: dopo.title, kind: dopo.kind }));
  expect(dopo.title).toBe('Spinoza e la sostanza');
  expect(dopo.kind).toBe('conversazione');
});
