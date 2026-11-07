// esplorazione #1697.2 giro 2: incolla lungo, tempi, annulla, ancora invisibile.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);
const Z = '​';
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
  return { html: d.innerHTML.slice(0, 400), coda: d.innerHTML.slice(-300), testo: d.innerText, zeta: (d.innerHTML.match(/​/g) || []).length, n: (d.innerText.match(/riga numero \d+ del/g) || []).length };
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

test('tempi', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  const casi = [
    ['voci fin fuori shift su', '<ul><li>uno</li><li>due</li><li>tre</li></ul><p>dopo il testo</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc p'); getSelection().collapse(p.firstChild, 0); });
      await page.keyboard.press('Shift+ArrowUp'); await page.keyboard.press('Shift+ArrowUp');
    }, 1000],
    ['meta voce a meta paragrafo', '<ul><li>voce uno</li><li>voce due</li><li>voce tre</li></ul><p>paragrafo sotto lungo</p>', async () => {
      await page.evaluate(() => { const li = document.querySelectorAll('#doc li')[1]; const p = document.querySelector('#doc p'); const r = document.createRange(); r.setStart(li.firstChild, 3); r.setEnd(p.firstChild, 9); getSelection().removeAllRanges(); getSelection().addRange(r); });
    }, 1000],
    ['meta paragrafo 3000', '<p>primo paragrafo di testo</p><p>secondo paragrafo di testo</p><p>terzo</p>', async () => {
      await page.evaluate(() => { const p = document.querySelectorAll('#doc p')[1]; getSelection().collapse(p.firstChild, 8); });
    }, 3000],
    ['meta paragrafo unico 3000', '<p>primo paragrafo di testo</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc p'); getSelection().collapse(p.firstChild, 6); });
    }, 3000],
    ['inizio paragrafo 3000', '<p>primo paragrafo</p><p>secondo</p>', async () => {
      await page.evaluate(() => { const p = document.querySelectorAll('#doc p')[1]; getSelection().collapse(p.firstChild, 0); });
    }, 3000],
    ['titolo meta 3000', '<h2>un titolo lungo</h2><p>sotto</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc h2'); getSelection().collapse(p.firstChild, 4); });
    }, 3000],
    ['citazione meta 3000', '<blockquote>una citazione lunga</blockquote><p>sotto</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc blockquote'); getSelection().collapse(p.firstChild, 4); });
    }, 3000],
    ['paragrafo a voce 1000', '<p>sopra il testo</p><ul><li>voce uno</li><li>voce due</li></ul>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc p'); const li = document.querySelectorAll('#doc li')[0]; const r = document.createRange(); r.setStart(p.firstChild, 5); r.setEnd(li.firstChild, 4); getSelection().removeAllRanges(); getSelection().addRange(r); });
    }, 1000],
    ['elenco numerato meta 3000', '<ol><li>voce uno</li><li>voce due</li></ol>', async () => {
      await page.evaluate(() => { const li = document.querySelector('#doc li'); getSelection().collapse(li.firstChild, 4); });
    }, 3000],
    ['voce annidata 2000', '<ul><li>voce uno<ul><li>sotto voce</li></ul></li><li>voce due</li></ul>', async () => {
      await page.evaluate(() => { const li = document.querySelector('#doc li li'); getSelection().collapse(li.firstChild, 5); });
    }, 2000],
    ['grassetto meta 3000', '<p>testo <b>grassetto lungo</b> dopo</p>', async () => {
      await page.evaluate(() => { const b = document.querySelector('#doc b'); getSelection().collapse(b.firstChild, 5); });
    }, 3000],
    ['tutto ctrl a 3000', '<h1>titolo</h1><p>testo uno</p><ul><li>voce</li></ul><blockquote>cit</blockquote>', async () => {
      await page.keyboard.press(`${ctrl}+a`);
    }, 3000],
    ['codice pre 3000', '<pre>codice uno\ncodice due</pre><p>sotto</p>', async () => {
      await page.evaluate(() => { const p = document.querySelector('#doc pre'); getSelection().collapse(p.firstChild, 4); });
    }, 3000],
  ];
  const out = [];
  for (const [nome, html, sel, n] of casi) {
    await apri(page, html);
    await sel();
    const ms = await incolla(page, righe(n));
    const s = await stato(page);
    out.push(`${nome}: ${ms} ms, entrate ${s.n}/${n}, zeta ${s.zeta}\n  ${s.html.slice(0, 200)}\n  ...${s.coda.slice(-200)}`);
  }
  console.log(out.join('\n'));
});

test('annulla foglio svuotato', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, null);
  await page.keyboard.type('abc def');
  await page.keyboard.press(`${ctrl}+a`);
  await page.keyboard.press('Delete');
  console.log('svuotato', JSON.stringify(await stato(page)));
  await incolla(page, righe(600));
  console.log('incollato', (await stato(page)).n);
  await page.keyboard.press(`${ctrl}+z`);
  console.log('z1', JSON.stringify(await stato(page)));
  await page.keyboard.press(`${ctrl}+z`);
  console.log('z2', JSON.stringify(await stato(page)));
  await page.keyboard.press(`${ctrl}+y`);
  console.log('y1', JSON.stringify(await stato(page)).slice(0, 300));
  await page.keyboard.press(`${ctrl}+Shift+z`);
  console.log('y2', (await stato(page)).n);
});

test('annulla titolo appena aperto e citazione', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, null);
  await page.keyboard.type('# ');
  console.log('aperto', JSON.stringify(await stato(page)));
  await incolla(page, righe(600));
  console.log('incollato', JSON.stringify(await stato(page)).slice(0, 300));
  await page.keyboard.press(`${ctrl}+z`);
  console.log('z1', JSON.stringify(await stato(page)));
  await page.keyboard.press(`${ctrl}+z`);
  console.log('z2', JSON.stringify(await stato(page)));
});

test('citazione appena aperta 60 righe e ancora', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, null);
  await page.keyboard.type('> ');
  console.log('aperta', JSON.stringify(await stato(page)));
  await incolla(page, righe(60));
  console.log('60', JSON.stringify(await stato(page)).slice(0, 500));
  await page.keyboard.type('X');
  console.log('dopo X', (await stato(page)).coda);
  await page.keyboard.press(`${ctrl}+z`);
  await page.keyboard.press(`${ctrl}+z`);
  console.log('dopo z', JSON.stringify(await stato(page)));
  await page.keyboard.press(`${ctrl}+y`);
  await page.keyboard.press(`${ctrl}+y`);
  console.log('dopo y', JSON.stringify(await stato(page)).slice(0, 300));
});

test('fondo citazione 600 copia e annulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, '<blockquote>una citazione con testo</blockquote>');
  await page.evaluate(() => { const b = document.querySelector('#doc blockquote'); getSelection().collapse(b.firstChild, b.firstChild.length); });
  await incolla(page, righe(600));
  console.log('600', JSON.stringify(await stato(page)).slice(0, 300));
  const copiato = await page.evaluate(() => {
    let got = null;
    const h = (e) => { setTimeout(() => {}, 0); };
    document.addEventListener('copy', h);
    getSelection().selectAllChildren(document.getElementById('doc'));
    return getSelection().toString().includes('​');
  });
  console.log('selezione con zeta', copiato);
  await page.keyboard.press(`${ctrl}+z`);
  console.log('dopo z', JSON.stringify(await stato(page)));
  await page.keyboard.press(`${ctrl}+y`);
  console.log('dopo y', JSON.stringify(await stato(page)).slice(0, 200));
  await page.keyboard.press(`${ctrl}+z`);
  await page.keyboard.press(`${ctrl}+z`);
  console.log('dopo zz', JSON.stringify(await stato(page)));
});

test('paragrafo vuoto in mezzo e righe vuote', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page, '<p>sopra</p><p><br></p><p>sotto</p>');
  await page.evaluate(() => { const p = document.querySelectorAll('#doc p')[1]; getSelection().collapse(p, 0); });
  const t = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? '' : `riga numero ${i} del testo incollato`)).join('\n') + '\n';
  const ms = await incolla(page, t);
  const s = await stato(page);
  console.log('vuoto in mezzo', ms, JSON.stringify(s).slice(0, 400), s.coda);
  await page.keyboard.press(`${ctrl}+z`);
  console.log('annulla', JSON.stringify(await stato(page)));
});
