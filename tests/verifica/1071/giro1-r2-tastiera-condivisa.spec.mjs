// Verifica #1071 giro 1, rilievo 2: quello che l'utente scrive in un riquadro di Filo su un sito non arriva al sito,
// e il sito non scrive nella casella.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca } from '../../helpers/riquadri.mjs';

const SPIA = `<script>window.__tasti = []; window.__dati = [];
  addEventListener('keydown', (e) => window.__tasti.push(e.key), true);
  addEventListener('input', (e) => window.__dati.push(e.data), true);</script>`;
const pagina = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif"><p>Sito</p>${SPIA}</body></html>`;

test('r2 il sito non sente i tasti scritti nel feedback e non scrive nella casella', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina);
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await clicca(app, page, '.sn-fb-text');
  await page.keyboard.type('pin 4821', { delay: 20 });
  await page.evaluate(() => document.execCommand('insertText', false, ' SCRITTO DAL SITO'));
  await page.waitForTimeout(600);
  const visto = await page.evaluate(() => window.__tasti.join('') + '|' + window.__dati.join(''));
  expect(visto, 'il sito non ricostruisce quello che l\'utente scrive').not.toContain('4821');
  expect((await statoDi(app, page, '.sn-fb-text')).valore, 'il sito non scrive nella casella').toBe('pin 4821');
});
