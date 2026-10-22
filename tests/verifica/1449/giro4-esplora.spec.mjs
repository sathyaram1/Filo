// Verifica #1449 giro 4: esplorazione di «Valuta» su campi che i siti veri usano (componenti web, campi controllati,
// testo formattato, casella di una riga) e su risposte insolite del modello.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

async function prepara(app, parere) {
  await app.evaluate(async (_e, { parere }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: false, spellcheckContext: false },
    });
    globalThis.__chiamate = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__chiamate.push(JSON.stringify(messages[messages.length - 1]));
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: parere };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, { parere });
}

const parere = (correzioni, text = 'Un refuso.') => JSON.stringify({ text, correzioni, status: 'done' });

async function valutaSu(page, loc) {
  await loc.click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  await menu.voce('Valuta').click();
}

test('componente web: un campo dentro uno shadow root', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, parere([{ prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' }]));
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <x-box id="h"></x-box>
    <script>
      const r = document.getElementById('h').attachShadow({ mode: 'open' });
      r.innerHTML = '<textarea id="ta" style="width:500px;height:80px">Vado al mare con i mei amici.</textarea>';
    </script></body>`);
  const ta = page.locator('x-box textarea');
  await valutaSu(page, ta);
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 20_000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(ta).toHaveValue('Vado al mare con i miei amici.');
});

test('campo controllato dal sito: lo stato del sito vede la correzione', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, parere([{ prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' }]));
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <textarea id="ta" style="width:500px;height:80px"></textarea><div id="stato"></div>
    <script>
      let stato = '';
      const ta = document.getElementById('ta');
      ta.addEventListener('input', () => { stato = ta.value; document.getElementById('stato').textContent = stato; });
    </script></body>`);
  await page.locator('#ta').click();
  await page.keyboard.type('Vado al mare con i mei amici.');
  await valutaSu(page, page.locator('#ta'));
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 20_000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ta')).toHaveValue('Vado al mare con i miei amici.');
  await expect(page.locator('#stato')).toHaveText('Vado al mare con i miei amici.');
});

test('testo formattato: la correzione attraversa un grassetto', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, parere([{ prima: 'i mei amici', dopo: 'i miei amici', perche: 'refuso' }]));
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <div id="ce" contenteditable="true" style="width:500px;min-height:60px;border:1px solid #999"><p>Vado al mare con i <b>mei</b> amici.</p></div></body>`);
  await valutaSu(page, page.locator('#ce'));
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 20_000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ce')).toHaveText('Vado al mare con i miei amici.');
});

test('casella di una riga', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, parere([{ prima: 'Ciao a tuti', dopo: 'Ciao a tutti', perche: 'refuso' }]));
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <input id="in" type="text" style="width:400px" value="Ciao a tuti, come va?"></body>`);
  await valutaSu(page, page.locator('#in'));
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 20_000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#in')).toHaveValue('Ciao a tutti, come va?');
});

test('markup nel campo e nelle correzioni resta testo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, parere([{ prima: '<b>mei</b>', dopo: '<img src=x onerror="window.__xss=1">', perche: '<i>x</i>' }], '<img src=x onerror="window.__xss=2">'));
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <textarea id="ta" style="width:500px;height:80px">Scrivo <b>mei</b> qui.</textarea></body>`);
  await valutaSu(page, page.locator('#ta'));
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator('.sn-sidebar-correzione')).toContainText('<img src=x');
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ta')).toHaveValue('Scrivo <img src=x onerror="window.__xss=1"> qui.');
  expect(await page.evaluate(() => window.__xss || 0)).toBe(0);
});

test('una correzione su un pezzo che il campo non ha lo dice', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, parere([{ prima: 'non esiste', dopo: 'esiste', perche: 'x' }]));
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <textarea id="ta" style="width:500px;height:80px">Testo qualunque.</textarea></body>`);
  await valutaSu(page, page.locator('#ta'));
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 20_000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('.sn-sidebar-log', { hasText: 'non trovo' })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#ta')).toHaveValue('Testo qualunque.');
});

test('una correzione che toglie una parola si toglie col secondo clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await prepara(app, parere([{ prima: ' molto', dopo: '', perche: 'superfluo' }]));
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <textarea id="ta" style="width:500px;height:80px">Era molto bello.</textarea></body>`);
  await valutaSu(page, page.locator('#ta'));
  await expect(page.locator('.sn-sidebar-correzione')).toHaveCount(1, { timeout: 20_000 });
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ta')).toHaveValue('Era bello.');
  await page.locator('.sn-sidebar-correzione').click();
  await expect(page.locator('#ta')).toHaveValue('Era molto bello.');
});

test('menu da tastiera su un campo a fuoco', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, parere([]));
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><body style="padding:20px">
    <textarea id="ta" style="width:500px;height:80px">Testo qualunque.</textarea></body>`);
  await page.locator('#ta').click();
  await page.keyboard.press('Shift+F10');
  const menu = menuDi(page);
  await page.waitForTimeout(1500);
  console.log('pannelli dopo Shift+F10:', await menu.pannelli.count(), 'Valuta:', await menu.voce('Valuta').count());
});
