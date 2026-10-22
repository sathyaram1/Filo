import { test } from '../../fixtures/electron.mjs';

test('profilo incolla', async ({ openTab }) => {
  test.setTimeout(170_000);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  const cdp = null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  const out = await editor.evaluate(async () => {
    const d = document.getElementById('doc');
    d.focus();
    const testo = Array.from({ length: 300 }, (_, i) => `Riga ${i}: caldaia.`).join('\n');
    const dt = new DataTransfer();
    dt.setData('text/plain', testo);
    const t0 = performance.now();
    d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const sync = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 0));
    const dopo = performance.now() - t0;
    const res = { sync: Math.round(sync), dopo: Math.round(dopo), p: d.querySelectorAll('p').length, html0: '' };
    const sel = window.getSelection();
    for (const [base, fine] of [['<p>prima</p>', true], ['<p><br></p>', false], ['<p>prima</p><p>dopo</p>', true]]) {
      d.innerHTML = base; d.focus(); sel.selectAllChildren(d.firstChild); if (fine) sel.collapseToEnd(); else sel.collapseToStart();
      const t = performance.now();
      document.execCommand('insertHTML', false, Array.from({ length: 300 }, (_, i) => `<p>Riga ${i}</p>`).join(''));
      res[base + fine] = Math.round(performance.now() - t);
    }
    const P300 = Array.from({ length: 300 }, (_, i) => `<p>Riga ${i}</p>`).join('');
    {
      d.innerHTML = '<p><br></p>'; d.focus(); const r = document.createRange(); r.selectNode(d.firstChild); sel.removeAllRanges(); sel.addRange(r);
      const t = performance.now(); document.execCommand('insertHTML', false, P300); res.selezionaNodo = Math.round(performance.now() - t); res.selezionaNodoHtml = d.innerHTML.slice(0, 80);
    }
    {
      d.innerHTML = '<p><br></p>'; d.focus(); sel.selectAllChildren(d.firstChild); sel.collapseToStart();
      const t = performance.now(); document.execCommand('insertText', false, 'Riga x'); document.execCommand('insertHTML', false, P300); res.primaTesto = Math.round(performance.now() - t); res.primaTestoHtml = d.innerHTML.slice(0, 80);
    }
    {
      d.innerHTML = '<p><br></p>'; d.focus(); sel.selectAllChildren(d); 
      const t = performance.now(); document.execCommand('insertHTML', false, P300); res.tutto = Math.round(performance.now() - t); res.tuttoHtml = d.innerHTML.slice(0, 80);
    }
    for (const [base, pos] of [['<p><br></p>', 0], ['<p>ab</p>', 1], ['<ul><li>voce</li></ul>', 9], ['<blockquote>cit</blockquote>', 9]]) {
      d.innerHTML = base; d.focus();
      const tn = d.firstChild.lastChild && d.firstChild.lastChild.nodeType === 3 ? d.firstChild.lastChild : (d.firstChild.querySelector('li') || d.firstChild).firstChild;
      const r = document.createRange();
      if (tn && tn.nodeType === 3) { r.setStart(tn, Math.min(pos, tn.length)); } else { r.setStart(d.firstChild, 0); }
      r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
      const t = performance.now();
      document.execCommand('insertText', false, 'X1');
      document.execCommand('insertHTML', false, '<p><br></p>' + Array.from({ length: 300 }, (_, i) => `<p>Y${i}</p>`).join(''));
      res['trucco ' + base] = Math.round(performance.now() - t) + ' ' + d.innerHTML.replace(/<button.*?<\/button>/g, '').slice(0, 70) + ' … ' + d.innerHTML.slice(-50);
    }
    {
      d.innerHTML = '<p><br></p>'; d.focus(); sel.selectAllChildren(d.firstChild); sel.collapseToStart();
      const t = performance.now();
      document.execCommand('insertText', false, 'X1');
      const tn = d.firstChild.firstChild; const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, 2); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('insertHTML', false, '<p>X1</p>' + Array.from({ length: 300 }, (_, i) => `<p>Y${i}</p>`).join(''));
      res.sostituisci = Math.round(performance.now() - t) + ' ' + d.innerHTML.slice(0, 60);
    }
    {
      d.innerHTML = '<p>prima</p><p><br></p>'; d.focus(); sel.selectAllChildren(d.lastChild); sel.collapseToStart();
      const t = performance.now();
      document.execCommand('insertHTML', false, Array.from({ length: 300 }, (_, i) => `<p>Y${i}</p>`).join(''));
      res.vuotoSecondo = Math.round(performance.now() - t);
    }
    {
      d.innerHTML = '<p><br></p>'; d.focus(); sel.selectAllChildren(d.firstChild); sel.collapseToStart();
      const t = performance.now();
      document.execCommand('insertHTML', false, Array.from({ length: 300 }, (_, i) => `Y${i}<br>`).join(''));
      res.conBr = Math.round(performance.now() - t) + ' ' + d.innerHTML.slice(0, 60);
    }
    {
      d.innerHTML = '<p><br></p>'; d.focus(); sel.selectAllChildren(d.firstChild); sel.collapseToStart();
      const t = performance.now();
      document.execCommand('insertHTML', false, '<div>' + Array.from({ length: 300 }, (_, i) => `<p>Y${i}</p>`).join('') + '</div>');
      res.inDiv = Math.round(performance.now() - t) + ' ' + d.innerHTML.slice(0, 60);
    }
    for (const [nome, testa] of [['span', '<span></span>'], ['br', '<br>'], ['ultimo', null]]) {
      d.innerHTML = '<p><br></p>'; d.focus(); sel.selectAllChildren(d.firstChild); sel.collapseToStart();
      const t = performance.now();
      document.execCommand('insertText', false, 'X1');
      const corpo = Array.from({ length: 300 }, (_, i) => `<p>Y${i}</p>`).join('');
      if (testa != null) document.execCommand('insertHTML', false, testa + corpo);
      else {
        const tn = d.firstChild.firstChild; const r = document.createRange(); r.setStart(tn, 1); r.setEnd(tn, 2); sel.removeAllRanges(); sel.addRange(r);
        document.execCommand('insertHTML', false, '<p>1</p>' + corpo);
      }
      res['testa-' + nome] = Math.round(performance.now() - t) + ' ' + d.innerHTML.slice(0, 50) + ' … ' + d.innerHTML.slice(-30);
    }
    for (const base of ['<h1>tit</h1>', '<ul><li>voce</li></ul>', '<blockquote>cit</blockquote>', '<p>a<b>gras</b></p>', '<p><br></p>', '<h2><br></h2>']) {
      d.innerHTML = base; d.focus();
      const blocco = d.firstChild.tagName === 'UL' ? d.firstChild.firstChild : d.firstChild;
      sel.selectAllChildren(blocco); sel.collapseToEnd();
      const t = performance.now();
      document.execCommand('insertText', false, 'XZ');
      sel.modify('extend', 'backward', 'character');
      const c = sel.toString();
      const tag = blocco.tagName.toLowerCase();
      document.execCommand('insertHTML', false, `<${tag}>${c}</${tag}>` + Array.from({ length: 300 }, (_, i) => `<p>Y${i}</p>`).join(''));
      res['tag ' + base] = Math.round(performance.now() - t) + ' ' + d.innerHTML.replace(/<button.*?<\/button>/g, '').slice(0, 90);
    }
    for (const [nome, html] of [['tuttiP', Array.from({ length: 300 }, (_, i) => `<p>Riga ${i}</p>`).join('')], ['inlinePoiP', 'Riga x' + Array.from({ length: 299 }, (_, i) => `<p>Riga ${i}</p>`).join('')]]) {
      d.innerHTML = '<p><br></p>'; d.focus(); sel.selectAllChildren(d.firstChild); sel.collapseToStart();
      const t = performance.now();
      document.execCommand('insertHTML', false, html);
      res[nome] = Math.round(performance.now() - t);
    }
    return res;
  });
  console.log(JSON.stringify(out));
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
    console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`).join('\n'));
  }
});
