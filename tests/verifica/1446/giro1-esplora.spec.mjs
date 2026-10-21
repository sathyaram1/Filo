// Verifica #1446 giro 1: esplorazione del correttore a due segni, col modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<main>
  <p>Anna: ciao! ci vediamo martedì?</p>
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
  <textarea id="gr" lang="it" data-enable-grammarly="false" style="display:block;width:300px;height:40px"></textarea>
  <div class="monaco-editor"><textarea id="mon" class="inputarea" style="width:300px;height:40px"></textarea></div>
  <div class="ace_editor"><textarea id="ace" class="ace_text-input" style="width:300px;height:40px"></textarea></div>
  <div spellcheck="false"><div id="ceno" contenteditable="true" style="width:300px;min-height:30px;border:1px solid #999"></div></div>
</main>
</body>`;

async function apri(app, openTab, testServer, opz = {}) {
  await app.evaluate(async (_e, opz) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true },
    });
    Object.assign(globalThis, { __rapide: [], __ragionate: [], __rispRapida: opz.rapida || '[][][][nessuno]', __rispRag: opz.ragionata || '[][][][nessuno]' });
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('Sei il controllo rapido di un correttore')) { globalThis.__rapide.push({ t, alle: Date.now() }); return fine(globalThis.__rispRapida); }
      if (t.includes('proponi SUGGERIMENTI')) { globalThis.__ragionate.push({ t, alle: Date.now() }); return fine(globalThis.__rispRag); }
      return fine('');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, opz);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => nelMondoDelMenu(app, page, 'globalThis.SN_DIZIONARIO.sbagliata("quseta")'), { timeout: 20_000 }).toBe(true);
  return page;
}

const errore = (page, testo) => page.locator('.sn-spell-overlay .sn-errore', { hasText: testo });
const sugg = (page, testo) => page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: testo });
async function destro(page, loc) {
  const b = await riquadroDelSegno(loc);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect(menuDi(page).pannelli.first()).toBeVisible({ timeout: 5000 });
  return menuDi(page);
}

test('ignora e dizionario', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { rapida: '[quseta][questa][Refuso.][errore]' });
  await page.locator('#ta').click();
  await page.keyboard.type('ciao quseta ');
  await expect(errore(page, 'quseta')).not.toHaveClass(/sn-dubbio/, { timeout: 5000 });
  let menu = await destro(page, errore(page, 'quseta'));
  await menu.voce('Ignora').click();
  await expect(errore(page, 'quseta')).toHaveCount(0);
  await page.keyboard.type('e poi altro testo ');
  await page.waitForTimeout(1500);
  await expect(errore(page, 'quseta')).toHaveCount(0);
  // dizionario
  await page.locator('#ta').fill('');
  await page.keyboard.type('ciao quseta ');
  await page.waitForTimeout(1500);
  console.log('dopo fill', await page.locator('.sn-spell-overlay .sn-errore').allTextContents());
});

test('suggerimento: menu, correzione, html nel motivo', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    rapida: '[quseta][questa][<b>grassetto</b><img src=x onerror="document.title=\'xss\'">][errore]',
    ragionata: '[mercoledì][martedì][Prima si era detto martedì.][contraddizione][ci vediamo martedì?]',
  });
  await page.locator('#ta').click();
  await page.keyboard.type('ciao quseta, sì ci vediamo mercoledì. ');
  await expect(errore(page, 'quseta')).not.toHaveClass(/sn-dubbio/, { timeout: 5000 });
  await expect(sugg(page, 'mercoledì')).toHaveCount(1, { timeout: 10000 });
  let menu = await destro(page, errore(page, 'quseta'));
  console.log('motivo', await menu.locator('.sn-menu-segno').innerHTML());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  menu = await destro(page, sugg(page, 'mercoledì'));
  console.log('sugg menu', JSON.stringify(await menu.principale.locator(':scope > *').allInnerTexts()));
  await page.screenshot({ path: 'tests/.shots/v1446-sugg-menu.png' });
  expect(await page.title()).not.toBe('xss');
});

test('esclusi grammarly monaco ace antenato', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { rapida: '[quseta][questa][Refuso.][errore]' });
  for (const id of ['#gr', '#mon', '#ace', '#ceno']) {
    await page.locator(id).click();
    await page.keyboard.type('ciao quseta il il cane ');
    await page.waitForTimeout(700);
    console.log(id, await page.locator('.sn-spell-overlay .sn-errore').count());
  }
  console.log('rapide', await app.evaluate(() => globalThis.__rapide.length));
});

test('pezzo doppio, emoji, scrittura continua', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { rapida: '[sonno][sono][verbo][errore]\n[quseta][questa][Refuso.][errore]' });
  await page.locator('#ta').click();
  await page.keyboard.type('ho sonno e sonno 😀😀 quseta 👍 ');
  await page.waitForTimeout(2000);
  console.log('segni', await page.locator('.sn-spell-overlay .sn-errore').allTextContents());
  const pos = await page.evaluate(() => {
    const t = document.getElementById('ta');
    const s = [...document.querySelectorAll('.sn-spell-overlay .sn-errore')].map((e) => e.getBoundingClientRect().left - t.getBoundingClientRect().left);
    return s;
  });
  console.log('pos', pos);
  await page.screenshot({ path: 'tests/.shots/v1446-emoji.png', clip: { x: 0, y: 0, width: 820, height: 220 } });
  // scrittura continua senza pause per 8 s
  await app.evaluate(() => { globalThis.__rapide = []; });
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) await page.keyboard.type('bla ', { delay: 90 });
  const r = await app.evaluate(() => globalThis.__rapide.map((x) => x.alle));
  console.log('rapide durante scrittura', r.length, r.map((x) => x - t0));
});

test('fatto dal ragionato diventa errore, e dark', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, {
    ragionata: '[nel 1429][nel 1492][L\'America fu scoperta nel 1492.][errore]\n[filo di rame spesso 2m][][Spessore impossibile?][suggerimento]',
  });
  await page.locator('#ta').click();
  await page.keyboard.type('L\'America è stata scoperta nel 1429. Ho un filo di rame spesso 2m. ');
  await page.waitForTimeout(6000);
  console.log('err', await page.locator('.sn-spell-overlay .sn-errore').allTextContents(), 'sugg', await page.locator('.sn-spell-overlay .sn-suggerimento').allTextContents());
  console.log('ragionate', await app.evaluate(() => globalThis.__ragionate.length));
});
