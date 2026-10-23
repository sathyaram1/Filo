// Esplorazione del giro 14: aspetto del valore velato (chiaro e scuro), campi con poco margine, contenteditable.

import { test, expect } from '../../fixtures/electron.mjs';

const COLOMBO = '[nel 14xx][nel 1492][Cristoforo Colombo sbarcò in America il 12 ottobre 1492][segnaposto]';
const RIGA_1 = 'Ieri sera a cena parlavamo di storia con gli amici di sempre, e ricordavo che ';
const SCRITTO = `${RIGA_1}l'America l'hanno scoperta nel 14xx, e allora abbiamo discusso. `;

async function prepara(app, tema) {
  await app.evaluate(async (_e, { riga, tema }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      theme: tema,
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, pausaRagionatoMs: 1000, segnaposti: true, segnapostiWeb: false },
    });
    const finto = async ({ messages }) => {
      const sistema = String(messages[0].content);
      const t = String(messages[messages.length - 1].content);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (sistema.includes('proponi SUGGERIMENTI') && t.includes('14xx')) return fine(riga);
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_FONTI_SEGNAPOSTO.wikipedia = async () => [];
    globalThis.SN_FONTI_SEGNAPOSTO.web = async () => [];
  }, { riga: COLOMBO, tema });
}

for (const tema of ['light', 'dark']) {
  test(`velato ${tema}`, async ({ app, openTab, testServer }) => {
    await prepara(app, tema);
    const bg = tema === 'dark' ? '#1d1b19' : '#fff';
    const fg = tema === 'dark' ? '#eee' : '#222';
    const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px;background:${bg};color:${fg}">
<textarea id="ta" lang="it" style="display:block;width:760px;height:140px;font:22px sans-serif;padding:8px;background:${bg};color:${fg}"></textarea></body>`, { pubblico: true });
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    await page.locator('#ta').click();
    await page.keyboard.type(SCRITTO);
    const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
    await expect(v).toBeVisible({ timeout: 10000 });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/.shots/1448-g14-velato-${tema}.png`, clip: { x: 0, y: 30, width: 820, height: 200 } });
    const vb = await v.boundingBox();
    await page.screenshot({ path: `tests/.shots/1448-g14-velato-zoom-${tema}.png`, clip: { x: vb.x - 30, y: vb.y - 6, width: vb.width + 60, height: vb.height + 40 } });
    const x = await page.locator('.sn-spell-overlay .sn-suggerimento', { hasText: '14xx' }).boundingBox();
    await page.mouse.move(x.x + x.width / 2, x.y + x.height / 2);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/1448-g14-sveglio-${tema}.png`, clip: { x: 0, y: 30, width: 820, height: 200 } });
  });
}

test('poco margine: link sopra il campo', async ({ app, openTab, testServer }) => {
  await prepara(app, 'light');
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px;font:14px sans-serif">
<div><a id="lnk" href="#cliccato" style="display:inline-block;padding-left:200px">Rispondi a tutti</a></div>
<textarea id="ta" lang="it" style="display:block;width:760px;height:100px;font:16px sans-serif;padding:2px"></textarea></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ta').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx, e allora abbiamo discusso. ");
  const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
  await expect(v).toBeVisible({ timeout: 10000 });
  const b = await v.boundingBox();
  const l = await page.locator('#lnk').boundingBox();
  const ta = await page.locator('#ta').boundingBox();
  console.log('valore', JSON.stringify(b), 'link', JSON.stringify(l), 'campo', JSON.stringify(ta), 'classi', await v.getAttribute('class'));
  await page.screenshot({ path: 'tests/.shots/1448-g14-poco-margine.png', clip: { x: 0, y: 30, width: 820, height: 160 } });
  await page.mouse.move(b.x + b.width / 2, b.y - 20);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(400);
  console.log('dopo clic sul link: testo', await page.locator('#ta').inputValue(), 'hash', await page.evaluate(() => location.hash));
});

test('input di una riga', async ({ app, openTab, testServer }) => {
  await prepara(app, 'light');
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px;font:14px sans-serif">
<input id="in" lang="it" style="display:block;width:760px;font:16px sans-serif;padding:4px"></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#in').click();
  await page.keyboard.type("l'America l'hanno scoperta nel 14xx, e allora abbiamo discusso. ");
  const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
  await expect(v).toBeVisible({ timeout: 10000 }).catch(() => console.log('input: nessun valore'));
  await page.screenshot({ path: 'tests/.shots/1448-g14-input.png', clip: { x: 0, y: 30, width: 820, height: 100 } });
});

test('contenteditable a capo', async ({ app, openTab, testServer }) => {
  await prepara(app, 'light');
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:60px 20px">
<div id="ce" contenteditable="true" lang="it" style="width:760px;min-height:90px;font:22px sans-serif;border:1px solid #999;padding:8px"></div></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await page.locator('#ce').click();
  await page.keyboard.type(SCRITTO);
  const v = page.locator('.sn-spell-valori .sn-spell-valore', { hasText: '1492' });
  await expect(v).toBeVisible({ timeout: 10000 });
  console.log('ce classi', await v.getAttribute('class'));
  const b = await v.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y - 30);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(300);
  console.log('ce testo', await page.locator('#ce').textContent());
});
