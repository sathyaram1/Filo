// #2756 — su un sistema italiano chi scrive in inglese riceve un correttore inglese: segnate solo le parole sbagliate,
// proposte inglesi nel tasto destro, e il modello sa che il testo è inglese (correggeva «seeng» in «vedendo»). Un testo
// italiano accanto resta controllato in italiano. Nessuna chiamata esce dalla macchina.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { riquadroDelSegno, segniDi } from './helpers/segniDelCorrettore.mjs';
import { batti } from './helpers/tastiera.mjs';

test.use({ argomentiInPiu: ['--lang=it-IT'], envInPiu: { LANG: 'it_IT.UTF-8', LANGUAGE: 'it_IT' } });

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="en" style="display:block;width:900px;height:90px;font:20px monospace"></textarea>
  <textarea id="it" style="display:block;width:900px;height:90px;font:20px monospace;margin-top:12px"></textarea>
</body>`;
const INGLESE = 'seeng the current rate of improvemnts i honestly think the best comparison is agriculture. ';

// `modello`: il controllo rapido finto, che segna «seeng» e tiene i messaggi che riceve.
async function apri(app, testServer, openTab, { modello = false } = {}) {
  await app.evaluate(async (_e, modello) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: false },
      correttore: { modelloErrori: modello, automatica: false },
    });
    globalThis.__rapide = [];
    // Senza la lingua nel messaggio il modello finto fa quello che faceva il vero: traduce il refuso.
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      globalThis.__rapide.push(t);
      const corretta = t.includes('Il testo è scritto in inglese') ? 'seeing' : 'vedendo';
      const text = t.includes('seeng') ? `[seeng][${corretta}][refuso][errore]` : 'NIENTE';
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, modello);
  await expect.poll(() => app.evaluate(() => globalThis.__filoDizionarioDiFilo.stato()), { timeout: 20_000 })
    .toMatchObject({ fase: 'pronto', predefinite: ['it-IT'], lingue: expect.arrayContaining(['it-IT', 'en-US']) });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

async function primaProposta(page, segno) {
  const b = await riquadroDelSegno(segno);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  await expect(menu.primaVoce).toHaveClass(/sn-menu-correction/);
  return menu.primaVoce;
}

test('su un sistema italiano un testo inglese ha segni e proposte inglesi, e uno italiano accanto resta italiano', async ({ app, openTab, testServer }) => {
  const page = await apri(app, testServer, openTab);
  await page.locator('#en').click();
  await batti(page, INGLESE);
  const errori = segniDi(page, '.sn-spell-overlay .sn-errore');
  await expect(errori.filter({ hasText: 'improvemnts' })).toHaveCount(1, { timeout: 5000 });
  await expect(errori.filter({ hasText: 'seeng' })).toHaveCount(1);
  // Le parole inglesi giuste non sono più parole italiane sconosciute.
  await expect(errori).toHaveCount(2);
  await page.screenshot({ path: 'tests/.shots/correttore-lingua-inglese.png', clip: { x: 0, y: 0, width: 960, height: 240 } });

  const prima = await primaProposta(page, errori.filter({ hasText: 'improvemnts' }));
  await expect(prima).toHaveText(/improvements/);
  await prima.locator('.sn-menu-correction-main').click();
  await expect(page.locator('#en')).toHaveValue(INGLESE.replace('improvemnts', 'improvements'));

  await page.locator('#it').click();
  await batti(page, 'sono andatto al mare con mia sorella e non abbiamo trovato posto ');
  await expect(errori.filter({ hasText: 'andatto' })).toHaveCount(1, { timeout: 5000 });
  for (const giusta of ['sono', 'mare', 'sorella', 'abbiamo', 'trovato', 'posto']) await expect(errori.filter({ hasText: giusta })).toHaveCount(0);
  await expect(await primaProposta(page, errori.filter({ hasText: 'andatto' }))).toHaveText(/andato/);
});

test('il controllo rapido riceve solo la parola sbagliata del testo inglese, con la lingua, e la correzione è inglese', async ({ app, openTab, testServer }) => {
  const page = await apri(app, testServer, openTab, { modello: true });
  await page.locator('#en').click();
  const inizio = Date.now();
  await batti(page, 'I think the rate of improvement is seeng a slowdown, honestly. ');
  const segno = segniDi(page, '.sn-spell-overlay .sn-errore', { hasText: 'seeng' });
  await expect(segno).not.toHaveClass(/sn-dubbio/, { timeout: 8000 });
  console.log(`[misura] segno confermato ${Date.now() - inizio} ms dopo l'inizio della scrittura`);
  const rapide = await app.evaluate(() => globalThis.__rapide);
  const domanda = rapide.find((t) => t.includes('seeng'));
  expect(domanda).toContain('Il testo è scritto in inglese');
  const candidati = rapide.map((t) => t.slice(t.indexOf('<candidati>'), t.indexOf('</candidati>'))).join('\n');
  expect(candidati).toContain('[seeng]');
  for (const giusta of ['[rate]', '[improvement]', '[slowdown]', '[honestly]']) expect(candidati).not.toContain(giusta);
  await expect(await primaProposta(page, segno)).toHaveText(/seeing/);
});

// Il caso della segnalazione: «seeng» battuto per primo, da solo, quando la lingua non si sa ancora.
test('un refuso giudicato prima che la lingua si capisca non riceve una traduzione come correzione', async ({ app, openTab, testServer }) => {
  const page = await apri(app, testServer, openTab, { modello: true });
  await page.locator('#en').click();
  await batti(page, 'seeng ');
  const segno = segniDi(page, '.sn-spell-overlay .sn-errore', { hasText: 'seeng' });
  await expect(segno).not.toHaveClass(/sn-dubbio/, { timeout: 8000 });
  const prima = (await app.evaluate(() => globalThis.__rapide)).find((t) => t.includes('seeng'));
  expect(prima).toContain('La lingua del testo non si capisce ancora: un refuso si corregge nella lingua della parola, mai tradotto');
  await batti(page, INGLESE.slice('seeng '.length).replace('improvemnts', 'improvements'));
  const proposta = await primaProposta(page, segno);
  await expect(proposta).not.toHaveText(/vedendo/);
  await expect(proposta).not.toBeEmpty();
  await page.screenshot({ path: 'tests/.shots/correttore-lingua-menu.png' });
});
