// esplorazione temporanea: cosa annuncia il browser in una textarea.
import { test } from '../../fixtures/electron.mjs';

test('eventi', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body><textarea id="t" style="width:400px;height:100px"></textarea><p id="p">trascina questo</p><script>
    window.__e = [];
    const t = document.getElementById('t');
    for (const k of ['keydown', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend', 'textInput'])
      t.addEventListener(k, (e) => window.__e.push([k, e.inputType || e.key || '', e.data === undefined ? 'u' : e.data, e.dataTransfer ? e.dataTransfer.getData('text/plain') : null, t.selectionStart + '-' + t.selectionEnd, JSON.stringify(t.value), performance.now().toFixed(2)]), true);
  </script></body></html>`);
  await page.click('#t');
  await page.keyboard.type('ab');
  await app.evaluate(({ clipboard }) => clipboard.writeText('X\r\nY'));
  await page.keyboard.press('Control+V');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Backspace');
  await page.keyboard.press('Control+Z');
  const s = await page.context().newCDPSession(page);
  await s.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await s.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
  await s.send('Input.insertText', { text: '日本' });
  await page.waitForTimeout(200);
  for (const r of await page.evaluate(() => window.__e)) console.log(JSON.stringify(r));
});
