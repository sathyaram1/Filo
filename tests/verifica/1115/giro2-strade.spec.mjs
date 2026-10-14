// Verifica #1115 giro 2: le altre forme di riga nei campi modificabili (Invio doppio, Maiusc+Invio, terza riga, riga
// che va a capo da sola, paragrafi incollati), la correzione su una riga che non è la prima, il contesto prima del
// testo. Tutte verdi al giro 2: si ri-provano ai giri dopo.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<div role="log">
  <div>Anna: ciao! ci vediamo martedì?</div>
  <div>Anna: perfetto, porto io i biglietti</div>
</div>
<div id="ce" contenteditable="true" style="width:420px;min-height:90px;border:1px solid #999;font:22px sans-serif"></div>
</body>`;

const OCRA = JSON.stringify({ issues: [{
  tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: 'martedì',
}] });

async function apri(app, openTab, testServer) {
  await app.evaluate(async (_e, ocra) => {
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
      if (t.includes('Controlli la COERENZA')) { globalThis.__ocra.push(messages); return fine(ocra); }
      if (t.includes('Analizza il testo qui sotto')) return fine('{"annotated":"","issues":[]}');
      return fine('{"misspelled":false,"correction":""}');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, OCRA);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ce').click();
  return page;
}

const dovèLaParola = (page) => page.evaluate(() => {
  const r = document.createRange();
  const w = document.createTreeWalker(document.getElementById('ce'), NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const i = n.nodeValue.indexOf('mercoledì');
    if (i >= 0) { r.setStart(n, i); r.setEnd(n, i + 9); const q = r.getBoundingClientRect(); return { x: Math.round(q.x), y: Math.round(q.y) }; }
  }
  return null;
});

async function sottoLaParola(page, nome) {
  const segno = page.locator('.sn-spell-overlay .sn-coerenza');
  await expect(segno).toHaveText(['mercoledì'], { timeout: 12_000 });
  const a = await segno.first().boundingBox();
  const b = await dovèLaParola(page);
  await page.screenshot({ path: `tests/.shots/v1115-g2-${nome}.png` }).catch(() => {});
  expect({ dx: Math.abs(a.x - b.x) < 4, dy: Math.abs(a.y - b.y) < 6, a: [Math.round(a.x), Math.round(a.y)], b: [b.x, b.y] })
    .toMatchObject({ dx: true, dy: true });
}

test('Invio due volte (riga vuota in mezzo)', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.keyboard.type('ok!');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sì ci vediamo mercoledì');
  await sottoLaParola(page, 'vuota');
});

test('Maiusc+Invio', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.keyboard.type('ok!');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('sì ci vediamo mercoledì');
  await sottoLaParola(page, 'br');
});

test('terza riga', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.keyboard.type('ok!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('va bene');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sì ci vediamo mercoledì');
  await sottoLaParola(page, 'terza');
});

test('riga lunga che va a capo da sola, dopo un Invio', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.keyboard.type('ok!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('allora va bene, ho sentito anche gli altri e sì ci vediamo mercoledì');
  await sottoLaParola(page, 'a-capo');
});

test('incollato con paragrafi', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.evaluate(() => {
    const ce = document.getElementById('ce');
    ce.innerHTML = '<p>ok!</p><p>va bene</p><p>sì ci vediamo mercoledì</p>';
    ce.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
  });
  await sottoLaParola(page, 'paragrafi');
});

test('correzione applicata sulla seconda riga: le righe restano', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.keyboard.type('ok!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sì ci vediamo mercoledì');
  const segno = page.locator('.sn-spell-overlay .sn-coerenza');
  await expect(segno).toHaveText(['mercoledì'], { timeout: 12_000 });
  const b = await segno.first().boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('.sn-menu-correction-main', { hasText: 'martedì' }).click();
  await expect(page.locator('#ce')).toHaveJSProperty('innerText', 'ok!\nsì ci vediamo martedì');
});

test('il contesto sta prima del testo da controllare', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer);
  await page.keyboard.type('sì ci vediamo mercoledì');
  await expect.poll(() => app.evaluate(() => globalThis.__ocra.length), { timeout: 12_000 }).toBeGreaterThan(0);
  const tutto = await app.evaluate(() => JSON.stringify(globalThis.__ocra[0]));
  const iCtx = tutto.indexOf('porto io i biglietti');
  const iTesto = tutto.lastIndexOf('sì ci vediamo mercoledì');
  expect(iCtx).toBeGreaterThan(-1);
  expect(iCtx).toBeLessThan(iTesto);
});
