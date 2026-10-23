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
