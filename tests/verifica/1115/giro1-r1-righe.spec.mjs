// Verifica #1115 giro 1, rilievo 1: in un contenteditable su due righe (Invio = nuovo <div>) i segni del correttore
// devono stare sotto la parola segnata, non sulla riga sopra.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<div role="log">
  <div>Anna: ciao! ci vediamo martedì?</div>
  <div>Anna: perfetto, porto io i biglietti</div>
</div>
<div id="ce" contenteditable="true" style="width:700px;min-height:90px;border:1px solid #999;font:22px sans-serif"></div>
</body>`;

const OCRA = JSON.stringify({ issues: [{
  tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: 'martedì',
}] });
const BLU = JSON.stringify({ annotated: 'ok!\nsì ci vediamo **mercoledì**', issues: [{ type: 'grammar', explanation: 'x', correction: 'martedì' }] });

async function apri(app, openTab, testServer, ocra, blu) {
  await app.evaluate(async (_e, { ocra, blu }) => {
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
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Controlli la COERENZA')) return fine(ocra);
      if (t.includes('Analizza il testo qui sotto')) return fine(blu);
      return fine('{"misspelled":false,"correction":""}');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { ocra, blu });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ce').click();
  await page.keyboard.type('ok!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sì ci vediamo mercoledì');
  return page;
}

const dovèLaParola = (page) => page.evaluate(() => {
  const r = document.createRange();
  const w = document.createTreeWalker(document.getElementById('ce'), NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const i = n.nodeValue.indexOf('mercoledì');
    if (i >= 0) { r.setStart(n, i); r.setEnd(n, i + 9); const q = r.getBoundingClientRect(); return { x: q.x, y: q.y }; }
  }
  return null;
});

async function sottoLaParola(page, segno) {
  await expect(segno).toHaveText(['mercoledì'], { timeout: 12_000 });
  const a = await segno.first().boundingBox();
  const b = await dovèLaParola(page);
  expect({ dx: Math.round(Math.abs(a.x - b.x)) < 4, dy: Math.round(Math.abs(a.y - b.y)) < 6 }).toEqual({ dx: true, dy: true });
}

test('r1 ocra sulla seconda riga di un contenteditable: i puntini stanno sotto «mercoledì»', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, OCRA, '{"annotated":"","issues":[]}');
  await sottoLaParola(page, page.locator('.sn-spell-overlay .sn-coerenza'));
});

test('r1 blu sulla seconda riga di un contenteditable: lo zigzag sta sotto «mercoledì»', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, '{"issues":[]}', BLU);
  await sottoLaParola(page, page.locator('.sn-spell-overlay .sn-semantic-error'));
});
