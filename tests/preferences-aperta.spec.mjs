// #592 — le Preferenze aperte in una scheda seguono quello che cambia altrove
// (la chat, un'altra pagina) e, quando l'utente tocca un campo, mandano solo
// quello: una scelta confermata a voce non torna indietro per un clic sul tema.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm } from './helpers/confirm.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

const salvate = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings());

// Un cambio fatto da un'altra pagina di Filo: stesso percorso della chat.
const cambiaAltrove = (app, settings) => app.evaluate(async (_e, s) => {
  const MSG = globalThis.SN_MSG.MSG;
  await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: s }, { url: 'filo://options/options.html' });
}, settings);

async function apri(openTab) {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#tok-accent', { timeout: 8_000 });
  return page;
}

test('lo stile confermato in chat compare nella pagina aperta e resta dopo un ritocco al tema', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
  });
  const prefs = await apri(openTab);
  await expect(prefs.locator('#agentStyleText')).toHaveValue('');

  const stile = 'Rispondi breve e dammi del tu.';
  await app.evaluate(async (_e, st) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__pa_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      n += 1;
      const calls = n === 1
        ? [{ id: 's1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'stile_agente', valore: st }) }]
        : [];
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: n === 1 ? '' : 'Ti chiedo conferma.', toolCalls: calls, reasoningDetails: [],
        finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, stile);
  await chat.bringToFront();
  await chat.locator('#input').fill('scrivimi breve e dammi del tu');
  await chat.locator('#sendBtn').click();
  await clickConfirm(chat, 'ok', { timeout: 10_000 });
  await expect.poll(() => salvate(app).then((s) => s.agentStyle), { timeout: 5_000 }).toBe(stile);
  await app.evaluate(() => globalThis.__pa_restore?.());

  await prefs.bringToFront();
  await expect(prefs.locator('#agentStyleText')).toHaveValue(stile, { timeout: 3_000 });
  await prefs.selectOption('#theme', 'dark');
  await expect.poll(() => salvate(app).then((s) => s.theme), { timeout: 3_000 }).toBe('dark');
  expect((await salvate(app)).agentStyle, 'toccare il tema ha rimesso lo stile di prima').toBe(stile);
});

test('un token cambiato altrove resta quando qui se ne tocca un altro', async ({ app, openTab }) => {
  const page = await apri(openTab);
  await cambiaAltrove(app, { themeTokens: { accent: '#00cc44' } });
  await expect(page.locator('#tok-accent')).toHaveValue('#00cc44', { timeout: 3_000 });
  await page.fill('#tok-radius', '3px');
  await expect.poll(() => salvate(app).then((s) => s.themeTokens || {}), { timeout: 3_000 })
    .toEqual({ accent: '#00cc44', radius: '3px' });
});

test('un parametro del colore delle schede cambiato altrove resta quando qui se ne tocca un altro', async ({ app, openTab }) => {
  const page = await apri(openTab);
  await cambiaAltrove(app, { tabColor: { peso_centralita: 8 } });
  await expect(page.locator('#tabcol-peso_centralita')).toHaveValue('8', { timeout: 3_000 });
  await page.fill('#tabcol-bucket_tinta', '10');
  await expect.poll(() => salvate(app).then((s) => (s.tabColor || {}).bucket_tinta), { timeout: 3_000 }).toBe(10);
  expect((await salvate(app)).tabColor.peso_centralita).toBe(8);
});

test('quello che si sta scrivendo qui non viene riscritto da un cambio arrivato da altrove', async ({ app, openTab }) => {
  const page = await apri(openTab);
  const max = await page.evaluate(() => window.SN_CONST.AGENT_STYLE_MAX);
  const troppo = 'Rispondi con calma. '.repeat(Math.ceil((max + 40) / 20));
  await page.fill('#agentStyleText', troppo);
  await expect(page.locator('#agentStyleNote')).toContainText('Troppo lungo');
  await page.fill('#tok-radius', '14');

  await cambiaAltrove(app, { theme: 'dark', agentStyle: '' });
  await expect(page.locator('#theme')).toHaveValue('dark', { timeout: 3_000 });
  await expect(page.locator('#agentStyleText'), 'il testo da accorciare è sparito').toHaveValue(troppo);
  await expect(page.locator('#agentStyleNote')).toContainText('Troppo lungo');
  await expect(page.locator('#tok-radius'), 'la misura a metà è tornata indietro').toHaveValue('14');

  // Una pausa di chi scrive salva il testo senza lo spazio in fondo: la
  // risposta del salvataggio non lo deve togliere dal campo mentre si scrive.
  await page.fill('#agentStyleText', 'Rispondi ');
  await expect.poll(() => salvate(app).then((s) => s.agentStyle), { timeout: 3_000 }).toBe('Rispondi');
  await page.waitForTimeout(300);
  await expect(page.locator('#agentStyleText')).toHaveValue('Rispondi ');
});
