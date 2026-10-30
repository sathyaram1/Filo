// #846 — Nel riquadro di Spiega (Alt+E) e Traduci (Alt+T) ogni risposta finita ha il suo «Copia»: negli appunti va
// il testo come si legge, senza marcature e coi numeri già calcolati; mentre la risposta arriva il comando non c'è.

import { test, expect } from './fixtures/electron.mjs';
import { neiRiquadri, statoDi, conta, clicca, scrivi, tastieraDi, tastoSullaScheda } from './helpers/riquadri.mjs';

const PRIMA = '**The cat** is on the *roof*.\nIt costs [[calc: 1200*1.5]] euros, see [the page](https://example.com).';
const PRIMA_PULITA = 'The cat is on the roof.\nIt costs 1800 euros, see the page.';
const SECONDA = 'Two forms:\n\n- **first**\n- `second`';
const SECONDA_PULITA = 'Two forms:\n\n• first\n• second';

const pagina = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">'
  + '<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p>'
  + '<textarea id="campo" style="margin-top:320px;width:420px;height:90px"></textarea></body></html>';

// Provider finto nel main: la prima risposta si ferma a metà finché la prova non la libera.
async function modelloFinto(app, risposte) {
  await app.evaluate(async (_e, rs) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__n846 = 0;
    globalThis.__libera846 = null;
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      streamComplete: async ({ onDelta }) => {
        const n = globalThis.__n846++;
        const t = rs[n] || 'Altra risposta.';
        const a = t.indexOf('\n') > 0 ? t.indexOf('\n') : Math.ceil(t.length / 2);
        onDelta(t.slice(0, a));
        if (n === 0) await new Promise((r) => { globalThis.__libera846 = r; });
        onDelta(t.slice(a));
        return { text: t, usage: {} };
      },
    };
  }, risposte);
}

const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

test('Alt+T: Copia mette negli appunti la traduzione pulita, coi numeri risolti; ogni risposta ha il suo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, [PRIMA, SECONDA]);
  await app.evaluate(({ clipboard }) => clipboard.writeText('vecchio contenuto'));
  const page = await testServer.openReady(openTab, pagina);
  await page.locator('#parola').dblclick();
  await comando(app, 'translate-selection');

  // A metà risposta il comando non c'è.
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  await page.waitForTimeout(300);
  expect(await conta(app, page, '.sn-msg-copia')).toBe(0);

  await app.evaluate(() => globalThis.__libera846());
  await expect.poll(() => conta(app, page, '.sn-msg-copia'), { timeout: 10_000 }).toBe(1);
  expect((await statoDi(app, page, '.sn-msg-copia')).visibile).toBe(true);

  // Il passaggio del mouse dice cosa fa, in una parola.
  const tasto = await statoDi(app, page, '.sn-msg-copia');
  // Sui siti il riquadro sta nello strato sopra la scheda: mouse e foto sono i suoi.
  const riquadri = await tastieraDi(app, page);
  await riquadri.mouse.move(tasto.x + tasto.width / 2, tasto.y + tasto.height / 2);
  await page.waitForTimeout(500);
  try { await riquadri.screenshot({ path: 'tests/.shots/popup-copia-hover.png' }); } catch (_) {}

  await clicca(app, page, '.sn-msg-copia');
  await expect.poll(() => appunti(app)).toBe(PRIMA_PULITA);
  // La conferma breve, poi il tasto torna com'era.
  await expect.poll(async () => (await statoDi(app, page, '.sn-msg-copia'))?.classi || '').toContain('sn-copiato');
  try { await riquadri.screenshot({ path: 'tests/.shots/popup-copia-copiato.png' }); } catch (_) {}
  await expect.poll(async () => (await statoDi(app, page, '.sn-msg-copia'))?.classi || '', { timeout: 5000 }).not.toContain('sn-copiato');

  // Incollato in un campo della pagina arriva lo stesso testo.
  await page.locator('#campo').click();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#campo')).toHaveValue(PRIMA_PULITA);

  // E lo ritrova la cronologia degli appunti di Filo, come il «Copia» del tasto destro.
  const storia = await app.evaluate(async () => {
    const k = globalThis.SN_CONST.STORAGE_KEYS.CLIPBOARD_HISTORY;
    return ((await globalThis.chrome.storage.local.get([k]))[k] || []).map((x) => x.text);
  });
  expect(storia[0]).toBe(PRIMA_PULITA);

  // La domanda dopo ha la sua risposta e il suo comando, che copia solo quella.
  const dove = await scrivi(app, page, '.sn-popup-input', 'and the plural?');
  await dove.keyboard.press('Enter');
  await expect.poll(() => conta(app, page, '.sn-msg-copia'), { timeout: 15_000 }).toBe(2);
  await cliccaUltimo(app, page, '.sn-msg-copia');
  await expect.poll(() => appunti(app)).toBe(SECONDA_PULITA);
});

// Clic vero sull'ultimo nodo che risponde a `sel` (l'helper `clicca` prende il primo).
async function cliccaUltimo(app, page, sel) {
  const r = await neiRiquadri(app, page, (s) => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const tutti = T ? T.trovaTutti(s) : document.querySelectorAll(s);
    const b = tutti[tutti.length - 1].getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, sel);
  await (await tastieraDi(app, page)).mouse.click(r.x, r.y);
}

test('Alt+E: anche l\'approfondimento si copia senza titoli né asterischi; uno script del sito non copia niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app, ['Già pronto', '## Gatto\n\nUn **felino** domestico.\n\n1. agile\n1. curioso']);
  await app.evaluate(() => { globalThis.__n846 = 1; });
  await app.evaluate(({ clipboard }) => clipboard.writeText('vecchio contenuto'));
  const page = await testServer.openReady(openTab, pagina);
  await page.locator('#parola').dblclick();
  await comando(app, 'explain-selection');
  await expect.poll(() => conta(app, page, '.sn-msg-copia'), { timeout: 15_000 }).toBe(1);

  // Il riquadro sta sopra la scheda: nel documento del sito non c'è niente da cliccare, nemmeno un host.
  expect(await page.evaluate(() => document.querySelectorAll('[data-sn-riquadro], .sn-popup').length)).toBe(0);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  });
  await page.waitForTimeout(400);
  expect(await appunti(app)).toBe('vecchio contenuto');

  await clicca(app, page, '.sn-msg-copia');
  await expect.poll(() => appunti(app)).toBe('Gatto\n\nUn felino domestico.\n\n1. agile\n2. curioso');

  // In tema scuro il tasto e la sua etichetta restano leggibili.
  await app.evaluate((_e) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.waitForTimeout(600);
  await tastoSullaScheda(app, page, 'Escape');
  await expect.poll(() => conta(app, page, '.sn-popup')).toBe(0);
  await app.evaluate(() => { globalThis.__n846 = 1; });
  await page.locator('#parola').dblclick();
  await comando(app, 'explain-selection');
  await expect.poll(() => conta(app, page, '.sn-msg-copia'), { timeout: 15_000 }).toBe(1);
  await clicca(app, page, '.sn-msg-copia');
  await expect.poll(async () => (await statoDi(app, page, '.sn-msg-copia'))?.classi || '').toContain('sn-copiato');
  await page.waitForTimeout(300);
  try { await (await tastieraDi(app, page)).screenshot({ path: 'tests/.shots/popup-copia-scuro.png' }); } catch (_) {}
});

test('dentro il riquadro incorporato di un altro sito Copia funziona lo stesso', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app, ['Già pronto', 'The **cat** sleeps.']);
  await app.evaluate(() => { globalThis.__n846 = 1; });
  await app.evaluate(({ clipboard }) => clipboard.writeText('vecchio contenuto'));
  // blocked.test è mappato su 127.0.0.1 dal fixture: origine diversa, e lì la pagina non può scrivere gli appunti.
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;padding:16px;font:16px sans-serif"><p>Il <span id="parola">gatto</span> dorme.</p></body></html>')
    .replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:12px"><iframe id="embed" src="${dentro}" width="600" height="420"></iframe></body></html>`);
  await page.frameLocator('#embed').locator('#parola').dblclick();
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await comando(app, 'translate-selection');
  await expect.poll(() => conta(app, page, '.sn-msg-copia', frame), { timeout: 15_000 }).toBe(1);
  await clicca(app, page, '.sn-msg-copia', { frame });
  await expect.poll(() => appunti(app)).toBe('The cat sleeps.');
  expect((await statoDi(app, page, '.sn-msg-copia', frame)).classi).toContain('sn-copiato');
});

test('in una pagina di Filo il riquadro copia allo stesso modo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await modelloFinto(app, ['Già pronto', '*Ciao* **mondo**']);
  await app.evaluate(() => { globalThis.__n846 = 1; });
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.TRANSLATE_SELECTION,
    payload: { selection: 'hello world' },
    anchor: { x: 120, y: 120 },
    title: 'Traduzione',
  }));
  const tasto = page.locator('.sn-popup .sn-msg-copia');
  await expect(tasto).toHaveCount(1, { timeout: 15_000 });
  await tasto.click();
  await expect.poll(() => appunti(app)).toBe('Ciao mondo');
  await expect(tasto).toHaveClass(/sn-copiato/);
});
