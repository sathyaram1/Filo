import { test } from './fixtures/electron.mjs';

test('misura', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<textarea id="t" style="width:400px;height:200px"></textarea><input id="i" maxlength="5">');
  const r = await page.evaluate(() => {
    const out = {};
    const t = document.getElementById('t');
    for (const n of [100, 300, 1000]) {
      t.value = ''; t.focus();
      const s = Array.from({ length: n }, (_, i) => `riga ${i}`).join('\n');
      const a = performance.now();
      document.execCommand('insertText', false, s);
      out['righe' + n] = Math.round(performance.now() - a);
    }
    for (const n of [1000, 5000]) {
      t.value = ''; t.focus();
      const s = Array.from({ length: n }, (_, i) => `riga ${i} <b>&amp;</b>`).join('\n');
      const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const a = performance.now();
      const ok = document.execCommand('insertHTML', false, esc);
      out['html' + n] = [Math.round(performance.now() - a), ok, t.value === s, t.value.length, s.length];
    }
    t.value = ''; t.focus();
    const lungo = 'x'.repeat(200000);
    const b = performance.now();
    document.execCommand('insertText', false, lungo);
    out.unaRiga200k = Math.round(performance.now() - b);
    return out;
  });
  console.log('MISURA', JSON.stringify(r));
});
