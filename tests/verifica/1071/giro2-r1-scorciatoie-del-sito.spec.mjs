// Verifica #1071 giro 2, rilievo 1: scrivendo in un riquadro di Filo su un sito con scorciatoie da tastiera
// (YouTube, GitHub, Gmail…), i tasti vanno nella casella e non comandano il sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi, clicca } from '../../helpers/riquadri.mjs';

// Il gestore tipico di un sito: ignora i tasti scritti in un campo, gli altri sono comandi.
const SITO = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">
<p id="parola" style="font-size:20px">supercalifragilistico</p>
<script>
  window.__comandi = [];
  function aggiungiCerca() { const i = document.createElement('input'); i.id = 'cerca'; document.body.appendChild(i); return i; }
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'k') { e.preventDefault(); window.__comandi.push('pausa'); }
    if (e.key === '/') { e.preventDefault(); (document.querySelector('#cerca') || aggiungiCerca()).focus(); }
  });
</script></body></html>`;

test('r1 nel feedback su un sito con scorciatoie i tasti scritti restano nella casella', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await clicca(app, page, '.sn-fb-text');
  await page.keyboard.type('ok kiwi / poi', { delay: 20 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__comandi), 'il sito non prende i tasti come comandi').toEqual([]);
  expect(await page.evaluate(() => (document.querySelector('#cerca') || {}).value || ''), 'il testo non finisce nella casella del sito').toBe('');
  expect((await statoDi(app, page, '.sn-fb-text')).valore).toBe('ok kiwi / poi');
});

test('r1 nella domanda sotto la spiegazione su un sito con scorciatoie i tasti scritti restano nella casella', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig,
      complete: async () => ({ text: 'x', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('Vuol dire straordinario.'); return { text: 'Vuol dire straordinario.', usage: {} }; } };
  });
  const page = await testServer.openReady(openTab, SITO);
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('straordinario');
  await clicca(app, page, '.sn-popup-input');
  await page.keyboard.type('e kiwi / poi', { delay: 20 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__comandi), 'il sito non prende i tasti come comandi').toEqual([]);
  expect(await page.evaluate(() => (document.querySelector('#cerca') || {}).value || ''), 'il testo non finisce nella casella del sito').toBe('');
  expect((await statoDi(app, page, '.sn-popup-input')).valore).toBe('e kiwi / poi');
});

test('r1 nell\'istruzione della Modifica su un sito con scorciatoie i tasti scritti restano nella casella', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SITO);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea>'));
  await page.locator('#campo').click();
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await page.locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, page, '.sn-editbox-instruction')).not.toBeNull();
  await clicca(app, page, '.sn-editbox-instruction');
  await page.keyboard.type('ok kiwi / poi', { delay: 20 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__comandi), 'il sito non prende i tasti come comandi').toEqual([]);
  expect((await statoDi(app, page, '.sn-editbox-instruction')).valore).toBe('ok kiwi / poi');
});
