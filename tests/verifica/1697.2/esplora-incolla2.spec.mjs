// #1697.2 giro 1: altre posizioni e contenuti dell'incolla lungo.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);

const righe = (n, f = (i) => `riga numero ${i} del testo incollato`) => Array.from({ length: n }, (_, i) => f(i)).join('\n');
async function incolla(page, testo) {
  return page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    const t0 = performance.now();
    document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return Math.round(performance.now() - t0);
  }, testo);
}
const entrate = (page) => page.evaluate(() => (document.getElementById('doc').innerText.match(/riga numero \d+ del testo incollato/g) || []).length);
async function apri(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  return page;
}
async function prepara(page, html, sel, off) {
  await page.evaluate(([html, sel, off]) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = html;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    const el = doc.querySelector(sel);
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const t = w.nextNode();
    getSelection().collapse(t, off);
  }, [html, sel, off]);
}

test('a metà di un titolo incolla 2000 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<h2>titolo lungo qui</h2><p>dopo</p>', 'h2', 6);
  const ms = await incolla(page, righe(2000));
  console.log('metà titolo ms', ms);
  expect(await entrate(page)).toBe(2000);
  expect(ms).toBeLessThan(2000);
});

for (const n of [2000, 4000]) {
  test(`a metà di una voce di elenco incolla ${n} righe`, async ({ openTab }) => {
    const page = await apri(openTab);
    await prepara(page, '<ul><li>voce uno</li><li>voce due</li></ul><p>dopo</p>', 'li', 4);
    const ms = await incolla(page, righe(n));
    console.log('metà voce', n, 'ms', ms);
    expect(await entrate(page)).toBe(n);
    expect(ms).toBeLessThan(3000);
  });
  test(`in fondo a una voce di elenco incolla ${n} righe`, async ({ openTab }) => {
    const page = await apri(openTab);
    await prepara(page, '<ul><li>voce uno</li><li>voce due</li></ul><p>dopo</p>', 'li', 8);
    const ms = await incolla(page, righe(n));
    console.log('fondo voce', n, 'ms', ms);
    expect(await entrate(page)).toBe(n);
  });
  test(`a metà di una citazione incolla ${n} righe`, async ({ openTab }) => {
    const page = await apri(openTab);
    await prepara(page, '<blockquote>citazione qui</blockquote><p>dopo</p>', 'blockquote', 4);
    const ms = await incolla(page, righe(n));
    console.log('metà citazione', n, 'ms', ms);
    expect(await entrate(page)).toBe(n);
    expect(ms).toBeLessThan(3000);
  });
}

test('documento già lungo 3000 righe, incolla 2000 righe a metà di un paragrafo in alto', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>in alto qui</p>' + Array.from({ length: 3000 }, (_, i) => `<p>esistente ${i}</p>`).join('');
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    getSelection().collapse(doc.querySelector('p').firstChild, 3);
  });
  const ms = await incolla(page, righe(2000));
  console.log('doc lungo ms', ms);
  expect(await entrate(page)).toBe(2000);
  expect(ms).toBeLessThan(3000);
});

test('righe con markup: entra come testo, nessun elemento nuovo', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('prima');
  await incolla(page, righe(200, (i) => `<img src=x onerror="window.__x=${i}"><b>grassetto ${i}</b> & &amp; <script>window.__y=1</script>`));
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    img: document.querySelectorAll('#doc img, #doc b, #doc script').length,
    x: window.__x, y: window.__y,
    testo: document.getElementById('doc').innerText.split('\n').slice(0, 2),
  }));
  console.log(JSON.stringify(r));
  expect(r.img).toBe(0);
  expect(r.x).toBeUndefined();
  expect(r.testo.join('\n')).toContain('<b>grassetto 0</b> & &amp;');
});

test('righe con a capo di Windows, righe vuote e spazi in testa', async ({ openTab }) => {
  const page = await apri(openTab);
  const t = Array.from({ length: 300 }, (_, i) => (i % 10 === 0 ? '' : `   rientro ${i}`)).join('\r\n');
  await incolla(page, t);
  const r = await page.evaluate(() => document.getElementById('doc').innerText);
  expect(r).not.toContain('\r');
  expect(r).toContain('rientro 299');
  const vuote = await page.evaluate(() => [...document.querySelectorAll('#doc > *')].length);
  console.log('blocchi', vuote, JSON.stringify(r.slice(0, 120)));
  const spazi = r.split('\n').find((l) => l.includes('rientro 1'));
  console.log('riga con rientro', JSON.stringify(spazi));
});

test('emoji e testo lunghissimo su una riga sola, 100 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await incolla(page, righe(100, (i) => `🙂👨‍👩‍👧 ${'x'.repeat(5000)} ${i}`));
  const r = await page.evaluate(() => document.getElementById('doc').innerText.split('\n').filter((l) => l.includes('🙂')).length);
  expect(r).toBe(100);
});
