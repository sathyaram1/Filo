// Verifica #1115 giro 2, rilievo 1: in un campo che scorre (testo più alto della casella) i segni del correttore
// devono stare sotto la parola segnata, che è in fondo e visibile, non spostati più in basso fuori dalla casella.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = (campo) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<div role="log">
  <div>Anna: ciao! ci vediamo martedì?</div>
  <div>Anna: perfetto, porto io i biglietti</div>
</div>
${campo}
</body>`;

const OCRA = JSON.stringify({ issues: [{
  tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: 'martedì',
}] });
const BLU = JSON.stringify({ annotated: 'uno\ndue\ntre\nquattro\ncinque\nsì ci vediamo **mercoledì**', issues: [{ type: 'grammar', explanation: 'x', correction: 'martedì' }] });
const NIENTE_BLU = '{"annotated":"","issues":[]}';

const CE = '<div id="f" contenteditable="true" style="width:420px;max-height:80px;overflow:auto;border:1px solid #999;font:22px sans-serif"></div>';
const TA = '<textarea id="f" style="width:420px;height:80px;font:22px sans-serif"></textarea>';

async function apri(app, openTab, testServer, campo, ocra, blu) {
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
  const page = await testServer.openReady(openTab, PAGINA(campo), { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#f').click();
  for (const r of ['uno', 'due', 'tre', 'quattro', 'cinque']) {
    await page.keyboard.type(r);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('sì ci vediamo mercoledì');
  return page;
}

// Il segno deve stare all'altezza dell'ultima riga (dove c'è «mercoledì», visibile in fondo). Sotto l'ultima riga di
// una casella piena i segni sporgono di 2 px sotto il bordo: scelta dell'owner (17/10), non un difetto.
const SPORGENZA_AMMESSA = 3;
async function sottoLUltimaRiga(page, sel) {
  const segno = page.locator(sel);
  await expect(segno).toHaveText(['mercoledì'], { timeout: 12_000 });
  await page.waitForTimeout(500);
  const dove = await page.evaluate(({ sel, sporge }) => {
    const f = document.getElementById('f').getBoundingClientRect();
    const s = document.querySelector(sel).getBoundingClientRect();
    return { dentro: s.top >= f.top - 1 && s.bottom <= f.bottom + sporge, inFondo: f.bottom - s.bottom < 40 };
  }, { sel, sporge: SPORGENZA_AMMESSA });
  expect(dove).toEqual({ dentro: true, inFondo: true });
}

test('r1 ocra in un campo modificabile che scorre: i puntini stanno sotto «mercoledì», in fondo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, CE, OCRA, NIENTE_BLU);
  await sottoLUltimaRiga(page, '.sn-spell-overlay .sn-coerenza');
});

test('r1 ocra in una casella di testo che scorre: i puntini stanno sotto «mercoledì», in fondo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, TA, OCRA, NIENTE_BLU);
  await sottoLUltimaRiga(page, '.sn-spell-overlay .sn-coerenza');
});

test('r1 blu in una casella di testo che scorre: lo zigzag sta sotto «mercoledì», in fondo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await apri(app, openTab, testServer, TA, '{"issues":[]}', BLU);
  await sottoLUltimaRiga(page, '.sn-spell-overlay .sn-semantic-error');
});
