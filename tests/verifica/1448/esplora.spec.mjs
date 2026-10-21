// Esplorazione verifica #1448 giro 3.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:60px 20px 20px;font:16px sans-serif">
<p>Scrivi qui sotto il tuo messaggio, con calma.</p>
<textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:24px 8px 8px"></textarea>
<div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px sans-serif;border:1px solid #999;margin-top:40px;padding:24px 8px 8px"></div>
<div style="height:2000px"></div>
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
      correttore: { modelloErrori: true, ripetizioni: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: true },
      ...(opz.tema ? { theme: opz.tema } : {}),
    });
    globalThis.__webChieste = [];
    globalThis.__ragionate = 0;
    const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
    const finto = async ({ messages }) => {
      const t = String(messages[messages.length - 1].content);
      if (t.includes('Chi scrive ha messo delle x')) return fine('[27][Rapporto prezzo/utili di Alphabet][1][20 ottobre 2026]');
      if (t.includes('proponi SUGGERIMENTI') && t.includes('p/e di soli xx')) {
        globalThis.__ragionate++;
        // Un modello vero non scrive due volte la stessa domanda con le stesse parole.
        const d = opz.domandeVarie && globalThis.__ragionate > 1 ? 'Google P/E ratio' : 'Alphabet P/E ratio';
        return fine(`[di soli xx][][${d}][cerca][web]`);
      }
      if (t.includes('proponi SUGGERIMENTI') && t.includes('14xx')) return fine('[nel 14xx][nel 1492][Colombo sbarcò in America il 12 ottobre 1492][segnaposto]');
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    const F = globalThis.SN_FONTI_SEGNAPOSTO;
    F.wikipedia = async () => [];
    F.web = async (q) => {
      globalThis.__webChieste.push(q);
      await new Promise((r) => setTimeout(r, 1500));
      return [{ titolo: 'Alphabet PE ratio', sito: 'borsa.example', url: 'https://borsa.example/goog', data: '', testo: 'Alphabet P/E ratio: 27.1' }];
    };
  }, opz);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const valore = (page, t) => page.locator('.sn-spell-valori .sn-spell-valore', { hasText: t });
const ocra = (page, t) => page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: t });

test('e1 domanda scritta con altre parole: il dato si ricerca?', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { domandeVarie: true });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, ');
  await expect(valore(page, '27')).toBeVisible({ timeout: 10000 });
  await page.keyboard.type('davvero basso per una azienda così. ');
  let puntini = false;
  for (let i = 0; i < 25; i++) {
    if (await page.locator('.sn-spell-valori .sn-spell-valore.sn-cercando').count()) puntini = true;
    await page.waitForTimeout(200);
  }
  console.log('PUNTINI', puntini, 'RICERCHE', JSON.stringify(await app.evaluate(() => globalThis.__webChieste)), 'RAGIONATE', await app.evaluate(() => globalThis.__ragionate));
});

test('e2 il sito svuota il campo (messaggio inviato): il valore resta a galla?', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(valore(page, '1492')).toBeVisible({ timeout: 10000 });
  await page.locator('#ta').evaluate((e) => { e.value = ''; });
  await page.waitForTimeout(1500);
  console.log('DOPO SVUOTA', await page.locator('.sn-spell-valori .sn-spell-valore').count());
  await page.keyboard.type('a');
  await page.waitForTimeout(800);
  console.log('DOPO TASTO', await page.locator('.sn-spell-valori .sn-spell-valore').count());
});

test('e3 il sito toglie il campo: il valore resta a galla?', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(valore(page, '1492')).toBeVisible({ timeout: 10000 });
  await page.locator('#ta').evaluate((e) => e.remove());
  await page.waitForTimeout(1500);
  console.log('DOPO RIMOZIONE', await page.locator('.sn-spell-valori .sn-spell-valore').count());
});

test('e4 scroll della pagina: il valore segue le x?', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(valore(page, '1492')).toBeVisible({ timeout: 10000 });
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(600);
  const s = await riquadroDelSegno(ocra(page, '14xx'));
  const v = await valore(page, '1492').boundingBox();
  console.log('SCROLL segno', JSON.stringify(s), 'valore', JSON.stringify(v));
  await page.screenshot({ path: 'tests/.shots/1448-g3-scroll.png' });
});

test('e5 testo scritto prima delle x dopo il valore, poi clic', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(valore(page, '1492')).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Sai che ');
  await page.waitForTimeout(300);
  await valore(page, '1492').click();
  console.log('TESTO', await page.locator('#ta').inputValue());
});

test('e6 tema scuro e contenteditable: aspetto', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { tema: 'dark' });
  await page.locator('#ce').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. Google ha un p/e di soli xx, davvero basso. ");
  await expect(valore(page, '1492')).toBeVisible({ timeout: 10000 });
  await expect(valore(page, '27')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: 'tests/.shots/1448-g3-scuro.png' });
  await valore(page, '27').hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/1448-g3-scuro-hover.png' });
});

test('e7 Ignora e poi riscrivo la stessa frase altrove', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx. ");
  await expect(valore(page, '1492')).toBeVisible({ timeout: 10000 });
  const b = await valore(page, '1492').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 5000 });
  console.log('VOCI', JSON.stringify(await menu.pannelli.first().innerText()));
  await page.screenshot({ path: 'tests/.shots/1448-g3-menu.png' });
  await menu.voce('Ignora').click();
  await expect(valore(page, '1492')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1500);
  console.log('DOPO UNDO testo', JSON.stringify(await page.locator('#ta').inputValue()), 'valori', await page.locator('.sn-spell-valori .sn-spell-valore').count());
});
