// Esplorazione giro 2 #1697, seconda tornata. Solo log.
import { test } from '../../fixtures/electron.mjs';

test.setTimeout(400_000);

const righe = (n) => Array.from({ length: n }, (_, i) => `riga numero ${i} del testo incollato`).join('\n');
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
async function apri(page) { await page.waitForSelector('#doc'); await page.click('#doc'); }
async function prepara(page, h, fn) {
  await page.evaluate(({ h, fn }) => {
    const doc = document.getElementById('doc');
    doc.focus();
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    new Function('doc', fn)(doc);
  }, { h, fn });
}
function log(...a) { console.log('[ESPLORA]', ...a); }

test('F1 titolo con testo, cursore in fondo da tastiera, incolla 600', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  const errori = [];
  page.on('pageerror', (e) => errori.push(e.message));
  await apri(page);
  await page.keyboard.type('# Capitolo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('testo sotto');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  const prima = await html(page);
  const ms = await incolla(page, righe(600));
  log('F1 ms', ms, 'entrate', await entrate(page), 'errori', JSON.stringify(errori), (await html(page)).slice(0, 400));
  await page.keyboard.press('Control+z');
  log('F1 undo uguale?', (await html(page)) === prima);
});

for (const n of [30, 600]) {
  test(`F2 incolla ${n}, scrivi, quanti annulla per tornare`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await apri(page);
    await page.keyboard.type('uno');
    await page.keyboard.press('Enter');
    await page.keyboard.type('due');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('End');
    const prima = await testo(page);
    await incolla(page, righe(n));
    await page.keyboard.type('xyz');
    let k = 0;
    for (; k < 6; k++) {
      if ((await testo(page)) === prima) break;
      await page.keyboard.press('Control+z');
    }
    log(`F2 ${n} righe: annulla serviti`, k, 'uguale?', (await testo(page)) === prima, JSON.stringify((await testo(page)).slice(0, 80)));
  });
}

for (const n of [30, 600]) {
  test(`F3 testo scritto, cancellato, incolla ${n}, due annulla`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await apri(page);
    await page.keyboard.type('abc def');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await incolla(page, righe(n));
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    log(`F3 ${n}: dopo due annulla`, JSON.stringify(await testo(page)), await html(page));
  });
}

for (const n of [600, 1500, 3000]) {
  test(`F4 a meta paragrafo ${n} righe`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await apri(page);
    await prepara(page, '<p>primo</p><p>prima parte dopo parte</p>', `const t = doc.querySelectorAll('p')[1].firstChild; getSelection().collapse(t, 12);`);
    const ms = await incolla(page, righe(n));
    log(`F4 meta ${n} ms`, ms, 'entrate', await entrate(page));
  });
  test(`F4b in fondo a un documento scritto ${n} righe`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await apri(page);
    await page.keyboard.type('ciao a tutti');
    const ms = await incolla(page, righe(n));
    log(`F4b fondo ${n} ms`, ms, 'entrate', await entrate(page));
  });
}

test('F5 piu voci di elenco selezionate, incolla 1000', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await prepara(page, '<ul><li>voce uno</li><li>voce due</li><li>voce tre</li></ul><p>dopo</p>', `
    const a = doc.querySelectorAll('li')[0].firstChild; const b = doc.querySelectorAll('li')[2].firstChild;
    const r = document.createRange(); r.setStart(a, 0); r.setEnd(b, b.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r);`);
  const ms = await incolla(page, righe(1000));
  log('F5 ms', ms, 'entrate', await entrate(page), 'li', await page.locator('#doc li').count());
});

test('F6 da tastiera: elenco di tre voci, Maiusc+frecce su due voci, incolla 600', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await apri(page);
  await page.keyboard.type('- uno');
  await page.keyboard.press('Enter');
  await page.keyboard.type('due');
  await page.keyboard.press('Enter');
  await page.keyboard.type('tre');
  await page.keyboard.press('Shift+ArrowUp');
  const ms = await incolla(page, righe(600));
  log('F6 ms', ms, 'entrate', await entrate(page), 'li', await page.locator('#doc li').count());
});
