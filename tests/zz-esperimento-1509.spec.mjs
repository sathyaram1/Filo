import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca } from './helpers/riquadri.mjs';

const SPIA = `<script>
  window.__letti = [];
  const tipi = ['beforeinput','input','textInput','compositionstart','compositionupdate','compositionend','paste','copy','cut','drop','dragstart','select','selectionchange','change','keydown','keypress','keyup','focusin'];
  for (const t of tipi) for (const cap of [true, false]) {
    window.addEventListener(t, (e) => {
      let clip = '';
      try { clip = e.clipboardData ? e.clipboardData.getData('text/plain') : ''; } catch (_) {}
      let dt = '';
      try { dt = e.dataTransfer ? e.dataTransfer.getData('text/plain') : ''; } catch (_) {}
      window.__letti.push([t, cap ? 'c' : 'b', e.data || '', clip, dt, e.inputType || '', String(e.isTrusted)].join('|'));
    }, cap);
    document.addEventListener(t, (e) => { if (t === 'selectionchange') window.__letti.push('doc-selchange'); }, true);
  }
</script>`;

test('esperimento: cosa vede il sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px"><p>x</p>${SPIA}</body></html>`);
  await nelMondoDiFilo(app, page, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, page, '.sn-fb-text')).not.toBeNull();
  await clicca(app, page, '.sn-fb-text');
  await page.evaluate(() => { window.__letti = []; });
  await page.keyboard.type('ab', { delay: 20 });
  await page.keyboard.insertText('xyz');
  const s = await page.context().newCDPSession(page);
  await s.send('Input.imeSetComposition', { text: 'ko', selectionStart: 2, selectionEnd: 2 });
  await s.send('Input.imeSetComposition', { text: 'kon', selectionStart: 3, selectionEnd: 3 });
  await s.send('Input.insertText', { text: 'こん' });
  await app.evaluate(({ clipboard }) => clipboard.writeText('incollato-segreto'));
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(500);
  console.log('VALORE', (await statoDi(app, page, '.sn-fb-text')).valore);
  console.log('LETTI\n' + (await page.evaluate(() => window.__letti)).join('\n'));
});
