import { test, expect } from './fixtures/electron.mjs';
import { writeFileSync } from 'node:fs';
import { nelMondoDiFilo, statoDi, clicca } from './helpers/riquadri.mjs';

const SPIA = `<script>
  window.__letti = [];
  const tipi = ['beforeinput','input','textInput','compositionstart','compositionupdate','compositionend','paste','copy','cut','drop','dragenter','dragover','select','change','keydown','keypress','keyup'];
  for (const t of tipi) for (const cap of [true, false]) {
    window.addEventListener(t, (e) => {
      let clip = '';
      try { clip = e.clipboardData ? e.clipboardData.getData('text/plain') : ''; } catch (_) {}
      let dt = '';
      try { dt = e.dataTransfer ? (e.dataTransfer.getData('text/plain') + '#' + e.dataTransfer.files.length) : ''; } catch (_) {}
      window.__letti.push([t, cap ? 'c' : 'b', e.data || '', clip, dt, e.inputType || '', String(e.isTrusted)].join('|'));
    }, cap);
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
  const f = '/tmp/claude-0/-home-user-Filo/308b05cd-23b8-56dd-ac98-0ac064eb577a/scratchpad/segreto.txt';
  writeFileSync(f, 'contenuto segreto del file');
  const m = await statoDi(app, page, '.sn-fb-modal');
  const x = m.x + m.width / 2; const y = m.y + m.height / 2;
  const data = { items: [], files: [f], dragOperationsMask: 1 };
  await s.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
  await s.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await s.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await page.waitForTimeout(800);
  console.log('VALORE', (await statoDi(app, page, '.sn-fb-text')).valore);
  console.log('THUMBS', (await statoDi(app, page, '.sn-fb-thumbs'))?.testo);
  console.log('LETTI\n' + (await page.evaluate(() => window.__letti)).join('\n'));
});
