// esplorazione #1697.2 giro 3: incolla lungo, tempi, annulla, carattere invisibile, stile prima riga.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(300_000);
const righe = (n) => Array.from({ length: n }, (_, i) => `riga numero ${i} del testo incollato`).join('\n');
async function incolla(page, testo) {
  return page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    const t0 = performance.now();
    document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return Math.round(performance.now() - t0);
  }, testo);
}
const stato = (page) => page.evaluate(() => {
  const d = document.getElementById('doc');
  return { html: d.innerHTML.slice(0, 400), coda: d.innerHTML.slice(-300), zeta: (d.innerHTML.match(/[​﻿]/g) || []).length, n: (d.innerText.match(/riga numero \d+ del/g) || []).length, testo: d.innerText.slice(0, 120) };
});
async function apri(page, html) {
  await page.waitForSelector('#doc');
  await page.click('#doc');
  if (html != null) await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
}
const ctrl = process.platform === 'darwin' ? 'Meta' : 'Control';
const pulisci = (s) => s.replace(/<button.*?<\/button>/g, '[btn]');

test('tempi', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  const casi = [
    ['voci fin fuori shift su 1000', '<ul><li>uno</li><li>due</li><li>tre</li></ul><p>dopo il testo</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc p'); getSelection().collapse(p.firstChild, 0); });
      await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+ArrowUp');
    }, 1000],
    ['meta voce a meta paragrafo 1000', '<ul><li>voce uno</li><li>voce due</li><li>voce tre</li></ul><p>paragrafo sotto lungo</p>', async () => {
      await page.evaluate(() => { const li = document.querySelectorAll('#doc li')[1]; const p = document.querySelector('#doc p'); const r = document.createRange(); r.setStart(li.firstChild, 3); r.setEnd(p.firstChild, 9); getSelection().removeAllRanges(); getSelection().addRange(r); });
    }, 1000],
    ['meta paragrafo 3000', '<p>primo paragrafo di testo</p><p>secondo paragrafo di testo</p><p>terzo</p>', async () => {
      await page.evaluate(() => { const p = document.querySelectorAll('#doc p')[1]; getSelection().collapse(p.firstChild, 8); });
    }, 3000],
    ['meta voce elenco 4000', '<ul><li>voce uno lunga</li><li>voce due</li></ul>', async () => {
      await page.evaluate(() => { const li = document.querySelector('#doc li'); getSelection().collapse(li.firstChild, 5); });
    }, 4000],
    ['fine voce elenco 4000', '<ul><li>voce uno</li><li>voce due</li></ul>', async () => {
      await page.evaluate(() => { const li = document.querySelector('#doc li'); getSelection().collapse(li.firstChild, li.firstChild.length); });
    }, 4000],
    ['paragrafo a meta voce 1000', '<p>sopra il testo</p><ul><li>voce uno</li><li>voce due</li></ul>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc p'); const li = document.querySelectorAll('#doc li')[0]; const r = document.createRange(); r.setStart(p.firstChild, 5); r.setEnd(li.firstChild, 4); getSelection().removeAllRanges(); getSelection().addRange(r); });
    }, 1000],
    ['inizio paragrafo a meta dopo 1000', '<p>primo paragrafo</p><p>secondo paragrafo</p>', async () => {
      await page.evaluate(() => { const ps = document.querySelectorAll('#doc p'); const r = document.createRange(); r.setStart(ps[0].firstChild, 0); r.setEnd(ps[1].firstChild, 7); getSelection().removeAllRanges(); getSelection().addRange(r); });
    }, 1000],
    ['titolo meta 3000', '<h2>un titolo lungo</h2><p>sotto</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc h2'); const t = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode(); getSelection().collapse(t, 4); });
    }, 3000],
    ['citazione meta 3000', '<blockquote>una citazione lunga</blockquote><p>sotto</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc blockquote'); getSelection().collapse(p.firstChild, 4); });
    }, 3000],
    ['elenco numerato meta 3000', '<ol><li>voce uno</li><li>voce due</li></ol>', async () => {
      await page.evaluate(() => { const li = document.querySelector('#doc li'); getSelection().collapse(li.firstChild, 4); });
    }, 3000],
    ['voce annidata 2000', '<ul><li>voce uno<ul><li>sotto voce</li></ul></li><li>voce due</li></ul>', async () => {
      await page.evaluate(() => { const li = document.querySelector('#doc li li'); getSelection().collapse(li.firstChild, 5); });
    }, 2000],
    ['casella da spuntare 3000', '<ul class="checklist"><li data-checked="false">da fare uno</li><li data-checked="false">da fare due</li></ul>', async () => {
      await page.evaluate(() => { const li = document.querySelector('#doc li'); const t = document.createTreeWalker(li, NodeFilter.SHOW_TEXT).nextNode(); getSelection().collapse(t, 3); });
    }, 3000],
    ['grassetto meta 3000', '<p>testo <b>grassetto lungo</b> dopo</p>', async () => {
      await page.evaluate(() => { const b = document.querySelector('#doc b'); getSelection().collapse(b.firstChild, 5); });
    }, 3000],
    ['tutto ctrl a 3000', '<h1>titolo</h1><p>testo uno</p><ul><li>voce</li></ul><blockquote>cit</blockquote>', async () => {
      await page.keyboard.press(`${ctrl}+a`);
    }, 3000],
    ['fra due blocchi 2000', '<p>primo</p><p>secondo</p>', async () => {
      await page.evaluate(() => { const d = document.getElementById('doc'); getSelection().collapse(d, 1); });
    }, 2000],
    ['codice pre 3000', '<pre>codice uno\ncodice due</pre><p>sotto</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc pre'); getSelection().collapse(p.firstChild, 4); });
    }, 3000],
    ['tabella cella 2000', '<table><tbody><tr><td>cella uno</td><td>due</td></tr></tbody></table><p>sotto</p>', async () => {
      await page.evaluate(() => { const c = document.querySelector('#doc td'); getSelection().collapse(c.firstChild, 3); });
    }, 2000],
  ];
  for (const [nome, html, sel, n] of casi) {
    await apri(page, html);
    try { await sel(); } catch (e) { console.log(nome, 'SEL FALLITA', e.message.slice(0, 100)); continue; }
    const ms = await incolla(page, righe(n));
    await page.waitForTimeout(200);
    const s = await stato(page);
    const span = await page.evaluate(() => [...document.querySelectorAll('#doc [style]')].map((x) => x.tagName + ':' + x.getAttribute('style')).slice(0, 3));
    console.log(`${nome}: ${ms} ms, entrate ${s.n}/${n}, zeta ${s.zeta}, stili ${JSON.stringify(span)}`);
    console.log('   TESTA ' + pulisci(s.html).slice(0, 260));
    console.log('   CODA ' + pulisci(s.coda).slice(-200));
  }
});

test('annulla foglio svuotato', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, null);
  await page.keyboard.type('abc def');
  await page.waitForTimeout(600);
  await page.keyboard.press(`${ctrl}+a`);
  await page.keyboard.press('Delete');
  await incolla(page, righe(600));
  console.log('incollato', (await stato(page)).n);
  await page.keyboard.press(`${ctrl}+z`);
  console.log('z1', JSON.stringify(await stato(page)));
  await page.keyboard.press(`${ctrl}+z`);
  console.log('z2', JSON.stringify(await stato(page)));
  await page.keyboard.press(`${ctrl}+z`);
  console.log('z3', JSON.stringify(await stato(page)));
});

test('annulla titolo appena aperto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, null);
  await page.keyboard.type('# ');
  console.log('aperto', JSON.stringify(await stato(page)));
  await incolla(page, righe(600));
  console.log('incollato', JSON.stringify(await stato(page)).slice(0, 300));
  await page.keyboard.press(`${ctrl}+z`);
  console.log('z1', JSON.stringify(await stato(page)));
});

test('citazione appena aperta 60 righe', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, null);
  await page.keyboard.type('> ');
  await incolla(page, righe(60));
  console.log('60', JSON.stringify(await stato(page)).slice(0, 500));
});

test('fondo citazione 600 copia e annulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, '<blockquote>una citazione con testo</blockquote>');
  await page.evaluate(() => { const b = document.querySelector('#doc blockquote'); getSelection().collapse(b.firstChild, b.firstChild.length); });
  await incolla(page, righe(600));
  console.log('600', JSON.stringify(await stato(page)).slice(0, 300));
  const sel = await page.evaluate(() => { getSelection().selectAllChildren(document.getElementById('doc')); return /[​﻿]/.test(getSelection().toString()); });
  console.log('selezione con zeta', sel);
  await page.keyboard.press(`${ctrl}+z`);
  console.log('dopo z', JSON.stringify(await stato(page)));
});

test('stile prima riga titolo e citazione', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  for (const [html, s, dove] of [['<h2>Un titolo</h2><p>sotto</p>', 'h2', 'fine'], ['<blockquote>Una citazione</blockquote><p>sotto</p>', 'blockquote', 4]]) {
    await apri(page, html);
    await page.evaluate(({ s, dove }) => { const t = document.createTreeWalker(document.querySelector('#doc ' + s), NodeFilter.SHOW_TEXT).nextNode(); getSelection().collapse(t, dove === 'fine' ? t.length : dove); }, { s, dove });
    await incolla(page, righe(60));
    console.log(s, pulisci(await page.evaluate(() => document.getElementById('doc').innerHTML.slice(0, 300))));
  }
});

test('riga vuota fra paragrafi, 100 righe con a capo finale', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  for (const n of [10, 100]) {
    await apri(page, '<p>sopra</p><p><br></p><p>sotto</p>');
    await page.evaluate(() => { const p = document.querySelectorAll('#doc p')[1]; getSelection().collapse(p, 0); });
    await incolla(page, righe(n) + '\n');
    console.log(n, pulisci(await page.evaluate(() => document.getElementById('doc').innerHTML.slice(-200))));
  }
});
