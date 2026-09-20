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

  // Il titolo e il tipo li ha scritti un modello. Se ha sbagliato, l'utente
  // deve poterli correggere: nell'Editor un titolo generato si rinomina e si
  // rigenera dallo stesso menu.
  const puoCorreggere = voci.some((v) => /rinomin|titolo|conversazion|sposta|tipo/i.test(v));
  expect(puoCorreggere, `menu: ${JSON.stringify(voci)}`).toBeTruthy();
});
