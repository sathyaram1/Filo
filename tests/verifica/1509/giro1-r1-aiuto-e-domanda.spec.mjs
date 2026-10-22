// Verifica #1509, giro 1: quello che l'utente scrive nelle caselle di Filo aperte su un sito non deve arrivare al sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca } from '../../helpers/riquadri.mjs';

const LETTORE = `<script>
  window.__letti = [];
  const tipi = ['keydown', 'beforeinput', 'input', 'textInput', 'compositionend', 'paste'];
  for (const t of tipi) for (const dove of [window, document]) {
    dove.addEventListener(t, (e) => {
      let porta = e.data || e.key || '';
      try { if (e.clipboardData) porta += e.clipboardData.getData('text/plain'); } catch (_) {}
      window.__letti.push(t + ':' + porta);
    }, true);
  }
  window.leggiCaselle = () => [...document.querySelectorAll('textarea, input')].filter((c) => c.id !== 'campo').map((c) => c.value).join('|');
</script>`;
const pagina = (corpo) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">${corpo}${LETTORE}</body></html>`;

function premiAltH(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
}

test('r1 la casella dell\'Aiuto su un sito: il sito non legge quello che l\'utente scrive', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina('<p id="p">Una pagina qualsiasi.</p>'));
  await premiAltH(app);
  await expect.poll(() => nelMondoDiFilo(app, page, () => !!globalThis.SN_FILO_UI._test.trova('.sn-sidebar textarea')), { timeout: 10_000 }).toBe(true);
  await clicca(app, page, '.sn-sidebar textarea');
  await page.evaluate(() => { window.__letti = []; });
  await page.keyboard.type('il mio conto 1234', { delay: 15 });
  await expect.poll(async () => (await statoDi(app, page, '.sn-sidebar textarea'))?.valore).toBe('il mio conto 1234');
  expect(await page.evaluate(() => window.__letti), 'il sito non ha visto i tasti né gli inserimenti').toEqual([]);
  expect(await page.evaluate(() => window.leggiCaselle()), 'il sito non legge la casella').not.toContain('1234');
});

test('la domanda successiva della spiegazione su un sito: il sito non legge quello che l\'utente scrive', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'ok', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('Risposta del modello.'); return { text: 'Risposta del modello.', usage: {} }; },
    };
  });
  const page = await testServer.openReady(openTab, pagina('<p id="parola" style="font-size:20px">supercalifragilistico</p>'));
  await page.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('Risposta del modello');
  await clicca(app, page, '.sn-popup-input');
  await page.evaluate(() => { window.__letti = []; });
  await page.keyboard.type('e il mio iban?', { delay: 15 });
  await page.keyboard.insertText(' 9876');
  await expect.poll(async () => (await statoDi(app, page, '.sn-popup-input'))?.valore).toBe('e il mio iban? 9876');
  expect(await page.evaluate(() => window.__letti)).toEqual([]);
  expect(await page.evaluate(() => window.leggiCaselle())).not.toContain('9876');
});
