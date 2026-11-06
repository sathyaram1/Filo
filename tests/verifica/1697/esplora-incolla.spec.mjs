// Esplorazione giro 2 #1697: incolla lungo in casi insoliti. Solo log.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);

const righe = (n, sep = '\n', pre = 'riga numero') => Array.from({ length: n }, (_, i) => `${pre} ${i} del testo incollato`).join(sep);

async function incolla(page, testo) {
  return page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    const t0 = performance.now();
    document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return Math.round(performance.now() - t0);
  }, testo);
}
const entrate = (page) => page.evaluate(() => (document.getElementById('doc').innerText.match(/riga numero \d+ del testo incollato/g) || []).length);
const html = (page) => page.evaluate(() => document.getElementById('doc').innerHTML);
const testo = (page) => page.evaluate(() => document.getElementById('doc').innerText);

async function apri(page) {
  await page.waitForSelector('#doc');
  await page.click('#doc');
}
async function prepara(page, h, fn) {
  await page.evaluate(({ h, fn }) => {
    const doc = document.getElementById('doc');
    doc.focus();
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    // eslint-disable-next-line no-new-func
    new Function('doc', fn)(doc);
  }, { h, fn });
}
function log(...a) { console.log('[ESPLORA]', ...a); }

test('E1 testo scritto a tastiera in un documento nuovo, poi incolla 1000 righe in fondo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await page.keyboard.type('ciao a tutti');
  log('E1 html prima', await html(page));
  const prima = await html(page);
  const ms = await incolla(page, righe(1000));
  log('E1 ms', ms, 'entrate', await entrate(page));
  await page.keyboard.press('Control+z');
  log('E1 dopo undo uguale?', (await html(page)) === prima, (await html(page)).slice(0, 200));
});

test('E2 selezione da meta voce di elenco a meta paragrafo, incolla 1000', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<ul><li>voce uno</li><li>voce due</li></ul><p>paragrafo dopo</p>', `
    const li = doc.querySelectorAll('li')[1].firstChild; const p = doc.querySelector('p').firstChild;
    const r = document.createRange(); r.setStart(li, 3); r.setEnd(p, 5);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);`);
  const prima = await html(page);
  const ms = await incolla(page, righe(1000));
  log('E2 ms', ms, 'entrate', await entrate(page));
  await page.keyboard.press('Control+z');
  log('E2 undo uguale?', (await html(page)) === prima);
});

test('E3 righe con a capo di Windows a meta paragrafo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<p>prima parte dopo parte</p>', `
    const t = doc.querySelector('p').firstChild; const s = getSelection(); s.collapse(t, 12);`);
  const ms = await incolla(page, righe(600, '\r\n'));
  const h = await html(page);
  log('E3 ms', ms, 'entrate', await entrate(page), 'CR?', h.includes('\r'), 'p', (h.match(/<p>/g) || []).length, 'br', (h.match(/<br>/g) || []).length);
});

test('E4 annulla e ripeti dopo incolla lungo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<p>uno</p><p>due</p>', `
    const t = doc.querySelectorAll('p')[1].firstChild; getSelection().collapse(t, 3);`);
  const prima = await html(page);
  await incolla(page, righe(200));
  const dopo = await html(page);
  await page.keyboard.press('Control+z');
  log('E4 undo uguale?', (await html(page)) === prima);
  await page.keyboard.press('Control+y');
  log('E4 redo Ctrl+Y uguale a dopo?', (await html(page)) === dopo, await entrate(page));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  log('E4 redo Ctrl+Shift+Z entrate', await entrate(page));
});

test('E5 testo scritto, cancellato tutto, incolla 600, due annulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await page.keyboard.type('abc def');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  log('E5 vuoto html', await html(page));
  await incolla(page, righe(600));
  log('E5 entrate', await entrate(page));
  await page.keyboard.press('Control+z');
  log('E5 dopo 1 undo', JSON.stringify(await testo(page)).slice(0, 100));
  await page.keyboard.press('Control+z');
  log('E5 dopo 2 undo', JSON.stringify(await testo(page)).slice(0, 100));
});

for (const [nome, md, sel] of [['elenco', '- ', 'li'], ['numerato', '1. ', 'ol li'], ['citazione', '> ', 'blockquote'], ['titolo', '# ', 'h1']]) {
  test(`E6 documento vuoto aperto con ${nome}, incolla 60 righe`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await apri(page);
    await page.keyboard.type(md);
    const prima = await html(page);
    log(`E6 ${nome} prima`, prima);
    const ms = await incolla(page, righe(60));
    const h = await html(page);
    log(`E6 ${nome} ms`, ms, 'entrate', await entrate(page), 'blocchi', await page.locator(`#doc ${sel}`).count(), h.slice(0, 160));
    await page.keyboard.press('Control+z');
    log(`E6 ${nome} undo uguale?`, (await html(page)) === prima, (await html(page)).slice(0, 120));
  });
}

test('E7 titolo con testo, cursore in fondo, incolla 600', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<h2>Capitolo</h2><p>testo</p>', `
    const t = doc.querySelector('h2').firstChild; getSelection().collapse(t, t.length);`);
  const prima = await html(page);
  const ms = await incolla(page, righe(600));
  log('E7 ms', ms, 'entrate', await entrate(page), 'h2', await page.locator('#doc h2').count());
  await page.keyboard.press('Control+z');
  log('E7 undo uguale?', (await html(page)) === prima);
});

test('E8 righe che sembrano HTML entrano come testo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<p>uno</p>', `const t = doc.querySelector('p').firstChild; getSelection().collapse(t, 3);`);
  const t = Array.from({ length: 60 }, (_, i) => `<img src=x onerror="window.__x=${i}"> <b>riga ${i}</b> &amp;`).join('\n');
  await incolla(page, t);
  log('E8 __x', await page.evaluate(() => window.__x), 'img', await page.locator('#doc img').count(), 'b', await page.locator('#doc b').count(), (await testo(page)).includes('<b>riga 5</b> &amp;'));
});

test('E9 cursore in mezzo a una parola in grassetto, incolla 600, annulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<p>uno <b>grassetto</b> due</p>', `const t = doc.querySelector('b').firstChild; getSelection().collapse(t, 4);`);
  const prima = await html(page);
  const ms = await incolla(page, righe(600));
  log('E9 ms', ms, 'entrate', await entrate(page), 'testo inizio', JSON.stringify((await testo(page)).slice(0, 60)));
  await page.keyboard.press('Control+z');
  log('E9 undo uguale?', (await html(page)) === prima, (await html(page)).slice(0, 120));
});

test('E10 incolla 600, scrivi, due annulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<p>uno</p><p>due</p>', `const t = doc.querySelectorAll('p')[0].firstChild; getSelection().collapse(t, 3);`);
  const prima = await html(page);
  await incolla(page, righe(600));
  await page.keyboard.type('xyz');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  log('E10 uguale?', (await html(page)) === prima, (await html(page)).slice(0, 120));
});

test('E11 selezione fra due paragrafi, incolla 1000, annulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<p>primo paragrafo</p><p>secondo paragrafo</p><p>terzo</p>', `
    const a = doc.querySelectorAll('p')[0].firstChild; const b = doc.querySelectorAll('p')[1].firstChild;
    const r = document.createRange(); r.setStart(a, 6); r.setEnd(b, 7); const s = getSelection(); s.removeAllRanges(); s.addRange(r);`);
  const prima = await html(page);
  const ms = await incolla(page, righe(1000));
  log('E11 ms', ms, 'entrate', await entrate(page), JSON.stringify((await testo(page)).slice(0, 50)), JSON.stringify((await testo(page)).slice(-40)));
  await page.keyboard.press('Control+z');
  log('E11 undo uguale?', (await html(page)) === prima);
});

test('E12 incolla 600 nel mezzo di una voce di elenco, poi copia tutto', async ({ openTab, app }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<blockquote>citato qui</blockquote><p>dopo</p>', `const t = doc.querySelector('blockquote').firstChild; getSelection().collapse(t, t.length);`);
  await incolla(page, righe(600));
  const zw = await page.evaluate(() => (document.getElementById('doc').innerText.match(/​/g) || []).length);
  log('E12 zero-width nel foglio', zw);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  log('E12 zero-width negli appunti', (clip.match(/​/g) || []).length, clip.length);
});

test('E13 righe di un solo carattere e righe vuote alternate, in fondo a un paragrafo non primo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<p>uno</p><p>x</p><p>tre</p>', `const t = doc.querySelectorAll('p')[1].firstChild; getSelection().collapse(t, 1);`);
  const prima = await html(page);
  const t = Array.from({ length: 1500 }, (_, i) => (i % 2 ? '' : 'a')).join('\n');
  const ms = await incolla(page, t);
  log('E13 ms', ms, 'p', await page.locator('#doc p').count());
  await page.keyboard.press('Control+z');
  log('E13 undo uguale?', (await html(page)) === prima);
});

test('E14 una tabella o un elenco annidato', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<ul><li>a<ul><li>annidata</li></ul></li><li>b</li></ul>', `const t = doc.querySelectorAll('li')[1].firstChild; getSelection().collapse(t, t.length);`);
  const prima = await html(page);
  const ms = await incolla(page, righe(600));
  log('E14 ms', ms, 'entrate', await entrate(page), 'li', await page.locator('#doc li').count());
  await page.keyboard.press('Control+z');
  log('E14 undo uguale?', (await html(page)) === prima);
});
