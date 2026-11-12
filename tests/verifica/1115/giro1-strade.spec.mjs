// Verifica #1115 giro 1: le strade che lo spec del lavoro non percorre (contenteditable, input, markup, token, menu
// doppio, casella svuotata dal sito). Tutte verdi al giro 1: si ri-provano ai giri dopo.

import { test, expect } from '../../fixtures/electron.mjs';

const CHAT = (campo) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<div role="log" class="conversazione">
  <div>Anna: ciao! ci vediamo martedì?</div>
  <div>Tu: sì, alle 18 davanti al cinema</div>
  <div>Anna: perfetto, porto io i biglietti</div>
</div>
${campo}
</body>`;

async function apri(app, openTab, testServer, risposta, html, blu = '{"annotated":"","issues":[]}') {
  await app.evaluate(async (_e, { risposta, blu }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    globalThis.__ocra = [];
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Controlli la COERENZA')) { globalThis.__ocra.push(messages[messages.length - 1].content); return fine(risposta); }
      if (t.includes('Analizza il testo qui sotto')) return fine(blu);
      return fine('{"misspelled":false,"correction":""}');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { risposta, blu });
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const ocra = (page) => page.locator('.sn-spell-overlay .sn-coerenza');
const contraddizione = (extra = {}) => JSON.stringify({ issues: [{
  tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: 'martedì', ...extra,
}] });

async function tastoDestro(page, loc) {
  const b = await loc.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  return menu;
}

test('contenteditable in una chat: ocra su «mercoledì» e la correzione si applica', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione(),
    CHAT('<div id="ce" contenteditable="true" style="width:700px;min-height:60px;border:1px solid #999;font:22px sans-serif"></div>'));
  await page.locator('#ce').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
  const menu = await tastoDestro(page, ocra(page).first());
  await expect(menu.locator('.sn-menu-coerenza-citazione')).toHaveText('prima: «ci vediamo martedì?»');
  await page.screenshot({ path: 'tests/.shots/v1115-ce-menu.png' }).catch(() => {});
  await menu.locator('.sn-menu-correction-main', { hasText: 'martedì' }).click();
  await expect(page.locator('#ce')).toHaveText('sì ci vediamo martedì');
});

test('un input non riceve mai l\'ocra, nemmeno per le date', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione(), CHAT('<input id="in" style="width:600px;font:20px sans-serif">'));
  await page.locator('#in').click();
  await page.keyboard.type('sì ci vediamo mercoledì 9 ottobre 2026');
  await page.waitForTimeout(5000);
  await expect(ocra(page)).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__ocra.length)).toBe(0);
});

test('spiegazione e citazione con markup restano testo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer,
    contraddizione({ spiegazione: '<img src=x onerror="window.__xss=1"><b>grassetto</b>' }),
    CHAT('<textarea id="ta" style="width:700px;height:100px;font:22px monospace"></textarea>'));
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
  const menu = await tastoDestro(page, ocra(page).first());
  await expect(menu.locator('.sn-menu-coerenza')).toContainText('<b>grassetto</b>');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('token: colore e stile dell\'ocra cambiati chiedendolo a Filo arrivano al segno', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione(),
    CHAT('<textarea id="ta" style="width:700px;height:100px;font:22px monospace"></textarea>'));
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
  const r1 = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'IMPOSTA_ESTETICA', token: 'correttore.ocra.color', valore: '#aa00aa' });
  const r2 = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'IMPOSTA_ESTETICA', token: 'correttore.ocra.stile', valore: 'dashed' });
  expect(r1.executed).toBe(true);
  expect(r2.executed).toBe(true);
  const stile = () => ocra(page).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { stile: cs.textDecorationStyle, colore: cs.textDecorationColor };
  });
  await expect.poll(stile, { timeout: 5000 }).toEqual({ stile: 'dashed', colore: 'rgb(170, 0, 170)' });
  // In tema scuro la scelta dell'utente resta.
  await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), { type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' });
  await page.waitForTimeout(1000);
  await expect.poll(stile, { timeout: 5000 }).toEqual({ stile: 'dashed', colore: 'rgb(170, 0, 170)' });
});

test('stessa parola blu e ocra: il tasto destro mostra tutte e due le cose', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione(),
    CHAT('<textarea id="ta" style="width:700px;height:100px;font:22px monospace"></textarea>'),
    JSON.stringify({ annotated: 'sì ci vediamo **mercoledì**', issues: [{ type: 'grammar', explanation: 'x', correction: 'mercoledi' }] }));
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(page.locator('.sn-spell-overlay .sn-semantic-error.sn-coerenza')).toHaveText('mercoledì', { timeout: 12_000 });
  const menu = await tastoDestro(page, ocra(page).first());
  await expect(menu.locator('.sn-menu-coerenza')).toContainText('Prima si era detto martedì.');
  await expect(menu.locator('.sn-menu-correction-main', { hasText: 'mercoledi' })).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/v1115-doppio-menu.png' }).catch(() => {});
});

test('il sito svuota la casella dopo l\'invio: i segni ocra spariscono', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione(),
    CHAT('<textarea id="ta" style="width:700px;height:100px;font:22px monospace"></textarea>'));
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì, e giovedì 9 ottobre 2026');
  await expect(ocra(page)).toHaveCount(2, { timeout: 12_000 });
  await page.evaluate(() => { const t = document.getElementById('ta'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(ocra(page)).toHaveCount(0, { timeout: 4000 });
});

test('col blu spento il tasto destro sui puntini mostra il riquadro dell\'ocra', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, contraddizione(),
    CHAT('<textarea id="ta" style="width:700px;height:100px;font:22px monospace"></textarea>'));
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ featureFlags: { spellcheck: false, spellcheckContext: true } }));
  await page.waitForTimeout(500);
  await page.locator('#ta').click();
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect(ocra(page)).toHaveText(['mercoledì'], { timeout: 12_000 });
  const menu = await tastoDestro(page, ocra(page).first());
  await expect(menu.locator('.sn-menu-coerenza-citazione')).toHaveText('prima: «ci vediamo martedì?»');
});
