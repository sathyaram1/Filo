import { test } from '../../fixtures/electron.mjs';

test('confronto incolla', async ({ openTab }) => {
  test.setTimeout(170_000);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  const out = await editor.evaluate(() => {
    const d = document.getElementById('doc');
    const righe = (n) => Array.from({ length: n }, (_, i) => `Riga ${i}: <x> & caldaia.`).join('\n');
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const res = {};
    d.innerHTML = '<p>prima</p>'; d.focus();
    const sel = window.getSelection(); sel.selectAllChildren(d.firstChild); sel.collapseToEnd();
    document.execCommand('insertText', false, 'A\nB\n\nC');
    res.strutturaInsertText = d.innerHTML;
    d.innerHTML = '<p>prima</p>'; d.focus();
    sel.selectAllChildren(d.firstChild); sel.collapseToEnd();
    let t0 = performance.now();
    document.execCommand('insertText', false, righe(300));
    res.insertText300 = Math.round(performance.now() - t0);
    for (const n of [300, 1500, 5000]) {
      d.innerHTML = '<p>prima</p>'; d.focus();
      sel.selectAllChildren(d.firstChild); sel.collapseToEnd();
      const html = righe(n).split('\n').map((r) => `<p>${r ? esc(r) : '<br>'}</p>`).join('');
      t0 = performance.now();
      document.execCommand('insertHTML', false, html);
      res[`insertHTML${n}`] = Math.round(performance.now() - t0);
      res[`ultimaRiga${n}`] = d.innerText.includes(`Riga ${n - 1}:`);
    }
    d.innerHTML = '<p><br></p>'; d.focus();
    sel.selectAllChildren(d.firstChild); sel.collapseToStart();
    document.execCommand('insertHTML', false, ['A', 'B', '', 'C'].map((r) => `<p>${r ? esc(r) : '<br>'}</p>`).join(''));
    res.strutturaInsertHTML = d.innerHTML;
    for (const base of ['<h1>tit</h1>', '<ul><li>voce</li></ul>', '<blockquote>cit</blockquote>', '<p>a<b>gras</b></p>']) {
      for (const modo of ['insertText', 'insertHTML']) {
        d.innerHTML = base; d.focus();
        const last = d.firstChild.lastChild;
        sel.selectAllChildren(last.nodeType === 1 ? last : d.firstChild); sel.collapseToEnd();
        if (modo === 'insertText') document.execCommand('insertText', false, 'A\nB\nC');
        else document.execCommand('insertHTML', false, 'A<p>B</p><p>C</p>');
        res[`${base} ${modo}`] = d.innerHTML;
      }
    }
    const nudo = document.createElement('div');
    nudo.contentEditable = 'true';
    document.body.appendChild(nudo);
    nudo.innerHTML = '<p>prima</p>'; nudo.focus();
    sel.selectAllChildren(nudo.firstChild); sel.collapseToEnd();
    t0 = performance.now();
    document.execCommand('insertText', false, righe(300));
    res.nudoInsertText300 = Math.round(performance.now() - t0);
    for (const pezzo of [10, 50]) {
      nudo.innerHTML = '<p>prima</p>'; nudo.focus();
      sel.selectAllChildren(nudo.firstChild); sel.collapseToEnd();
      const r = righe(300).split('\n');
      t0 = performance.now();
      for (let i = 0; i < r.length; i += pezzo) document.execCommand('insertText', false, (i ? '\n' : '') + r.slice(i, i + pezzo).join('\n'));
      res[`nudoPezzi${pezzo}`] = Math.round(performance.now() - t0);
    }
    nudo.innerHTML = '<p>prima</p>'; nudo.focus();
    sel.selectAllChildren(nudo.firstChild); sel.collapseToEnd();
    t0 = performance.now();
    document.execCommand('insertText', false, righe(300).replace(/\n/g, ' '));
    res.nudoUnaRiga = Math.round(performance.now() - t0);
    nudo.remove();
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
});
