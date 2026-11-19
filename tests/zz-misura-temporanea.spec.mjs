import { test } from './fixtures/electron.mjs';

test('misura', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<textarea id="t" style="width:400px;height:200px"></textarea><input id="i">');
  const r = await page.evaluate(() => {
    const out = {};
    const t = document.getElementById('t');
    const casi = {
      spazi: 'a    b\n   rientro\n\tTab\n\n\nvuote sopra  \nfine  ',
      crlf: 'uno\r\ndue\r\ntre',
      nbsp: 'x  y\nz',
      inizioA: '\nprima riga vuota',
      fineA: 'ultima\n',
      html: '<script>alert(1)</script>\n&lt; &amp;',
      emoji: '😀\n👍🏽 ok',
    };
    const tipi = [];
    t.addEventListener('input', (e) => tipi.push([e.inputType, e.isTrusted, e.composed]));
    for (const [k, s] of Object.entries(casi)) {
      t.value = 'AB'; t.focus(); t.setSelectionRange(1, 1);
      const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      document.execCommand('insertHTML', false, esc);
      const atteso = 'A' + s.replace(/\r\n?/g, '\n') + 'B';
      out[k] = t.value === atteso ? 'ok' : JSON.stringify(t.value);
      out[k + '_caret'] = t.selectionStart === 1 + s.replace(/\r\n?/g, '\n').length;
    }
    out.tipi = tipi.slice(0, 2);
    const i = document.getElementById('i');
    i.value = ''; i.focus();
    document.execCommand('insertHTML', false, 'riga uno\nriga due');
    out.input = JSON.stringify(i.value);
    i.value = ''; i.focus();
    document.execCommand('insertText', false, 'riga uno\nriga due');
    out.inputText = JSON.stringify(i.value);
    return out;
  });
  console.log('MISURA', JSON.stringify(r));
});
