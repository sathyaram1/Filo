// Esplorazione del giro 4 di #1071: modifica del testo coi tasti dentro i riquadri su un sito con scorciatoie in cattura.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca } from '../../helpers/riquadri.mjs';

const SITO = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">
<p>Video</p><input id="cerca">
<script>
  window.__comandi = []; window.__incollati = [];
  for (const b of [window, document]) for (const tipo of ['keydown', 'keyup', 'keypress']) b.addEventListener(tipo, (e) => {
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (tipo === 'keydown') window.__comandi.push(e.key);
    if (e.key === 'k' || e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'Backspace') e.preventDefault();
    if (e.key === '/' && tipo === 'keydown') { e.preventDefault(); document.querySelector('#cerca').focus(); }
  }, true);
  document.addEventListener('paste', (e) => { window.__incollati.push((e.clipboardData && e.clipboardData.getData('text')) || ''); }, true);
</script></body></html>`;

test('modifica col tastierino nel feedback su un sito con scorciatoie in cattura', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, SITO);
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await clicca(app, page, '.sn-fb-text');
  await page.keyboard.type('ok kiwi / poi', { delay: 15 });
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await page.keyboard.type('X k');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  const v = (await statoDi(app, page, '.sn-fb-text')).valore;
  console.log('VALORE', JSON.stringify(v));
  console.log('COMANDI', JSON.stringify(await page.evaluate(() => window.__comandi)));
  console.log('INCOLLATI', JSON.stringify(await page.evaluate(() => window.__incollati)));
  console.log('CERCA', JSON.stringify(await page.evaluate(() => document.querySelector('#cerca').value)));
  await page.keyboard.press('Tab');
  const fuoco = await nelMondoDiFilo(app, page, () => {
    const host = document.activeElement;
    return { host: host && host.tagName, sito: document.activeElement && document.activeElement.id };
  });
  console.log('FUOCO DOPO TAB', JSON.stringify(fuoco));
  await page.screenshot({ path: 'tests/.shots/1071-g4-feedback.png' });
  expect(v.startsWith('ok kiwi / p')).toBe(true);
});
