// #1697.2 giro 1: incolla lungo nelle posizioni lente, annulla dopo un incolla in un foglio vuoto, carattere invisibile.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);

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
const invisibili = (page) => page.evaluate(() => (document.getElementById('doc').textContent.match(/[​﻿]/g) || []).length);
async function apri(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  return page;
}
async function prepara(page, html, fn) {
  await page.evaluate(([html, fn]) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = html;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    new Function('doc', fn)(doc);
  }, [html, fn]);
}

test('tre voci di elenco selezionate a tastiera, incolla 1000 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('- uno');
  await page.keyboard.press('Enter');
  await page.keyboard.type('due');
  await page.keyboard.press('Enter');
  await page.keyboard.type('tre');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  const ms = await incolla(page, righe(1000));
  console.log('elenco tastiera ms', ms);
  expect(await entrate(page)).toBe(1000);
  expect(ms, `incolla durato ${ms} ms`).toBeLessThan(2000);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc')).not.toContainText('riga numero');
  await expect(page.locator('#doc')).toContainText('tre');
});

test('da metà di una voce a metà del paragrafo sotto, incolla 1000 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<ul><li>voce uno</li><li>voce due</li></ul><p>paragrafo dopo</p>', `
    const r = document.createRange();
    r.setStart(doc.querySelectorAll('li')[1].firstChild, 3);
    r.setEnd(doc.querySelector('p').firstChild, 5);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);`);
  const ms = await incolla(page, righe(1000));
  console.log('voce->paragrafo ms', ms);
  expect(await entrate(page)).toBe(1000);
  await expect(page.locator('#doc')).toContainText('voc');
  await expect(page.locator('#doc')).toContainText('rafo dopo');
  expect(ms).toBeLessThan(2000);
  const testo = await page.evaluate(() => document.getElementById('doc').innerText);
  console.log('inizio', JSON.stringify(testo.slice(0, 80)), 'fine', JSON.stringify(testo.slice(-60)));
});

for (const n of [600, 1500, 3000]) {
  test(`a metà di un paragrafo incolla ${n} righe`, async ({ openTab }) => {
    const page = await apri(openTab);
    await prepara(page, '<p>primo</p><p>prima parte dopo parte</p><p>ultimo</p>', `getSelection().collapse(doc.querySelectorAll('p')[1].firstChild, 12);`);
    const ms = await incolla(page, righe(n));
    console.log('metà paragrafo', n, 'ms', ms);
    expect(await entrate(page)).toBe(n);
    const testo = await page.evaluate(() => document.getElementById('doc').innerText);
    expect(testo).toMatch(/prima parte riga numero 0 del testo incollato/);
    expect(testo).toMatch(new RegExp(`riga numero ${n - 1} del testo incollatodopo parte`));
    expect(testo.trim().endsWith('ultimo')).toBe(true);
    expect(ms).toBeLessThan(2000);
    expect(await invisibili(page)).toBe(0);
  });
}

test('a metà di una voce di elenco incolla 2000 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<ul><li>voce uno</li><li>voce due</li></ul><p>dopo</p>', `getSelection().collapse(doc.querySelectorAll('li')[0].firstChild, 4);`);
  const ms = await incolla(page, righe(2000));
  console.log('metà voce ms', ms);
  expect(await entrate(page)).toBe(2000);
  expect(ms).toBeLessThan(2000);
});

test('a metà di un titolo incolla 2000 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<h2>titolo lungo qui</h2><p>dopo</p>', `getSelection().collapse(doc.querySelector('h2').firstChild, 6);`);
  const ms = await incolla(page, righe(2000));
  console.log('metà titolo ms', ms);
  expect(await entrate(page)).toBe(2000);
  expect(ms).toBeLessThan(2000);
});

test('selezione da metà di un paragrafo a metà di una voce sotto, incolla 1000 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<p>paragrafo prima</p><ul><li>voce uno</li><li>voce due</li></ul>', `
    const r = document.createRange();
    r.setStart(doc.querySelector('p').firstChild, 5);
    r.setEnd(doc.querySelectorAll('li')[0].firstChild, 4);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);`);
  const ms = await incolla(page, righe(1000));
  console.log('paragrafo->voce ms', ms);
  expect(await entrate(page)).toBe(1000);
  expect(ms).toBeLessThan(2000);
});

test('selezione da una citazione a un paragrafo, incolla 1000 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<blockquote>citazione qui</blockquote><p>paragrafo dopo</p>', `
    const r = document.createRange();
    r.setStart(doc.querySelector('blockquote').firstChild, 4);
    r.setEnd(doc.querySelector('p').firstChild, 4);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);`);
  const ms = await incolla(page, righe(1000));
  console.log('citazione->paragrafo ms', ms);
  expect(await entrate(page)).toBe(1000);
  expect(ms).toBeLessThan(2000);
});

test('tutto selezionato con Ctrl+A in un documento misto, incolla 1000 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<h1>t</h1><ul><li>a</li><li>b</li></ul><blockquote>c</blockquote><p>d</p>', `getSelection().collapse(doc.querySelector('p').firstChild, 1);`);
  await page.keyboard.press('Control+a');
  const ms = await incolla(page, righe(1000));
  console.log('ctrl+a misto ms', ms);
  expect(await entrate(page)).toBe(1000);
  expect(ms).toBeLessThan(2000);
});

test('testo scritto e cancellato tutto, incolla 600 righe: due annulla riportano il testo', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('abc def');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await incolla(page, righe(600));
  await expect(page.locator('#doc')).toContainText('riga numero 599');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc')).not.toContainText('riga numero');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc')).toHaveText('abc def');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#doc')).toContainText('riga numero 599');
});

test('documento nuovo, incolla 600 righe, annulla e ripeti', async ({ openTab }) => {
  const page = await apri(openTab);
  await incolla(page, righe(600));
  await expect(page.locator('#doc')).toContainText('riga numero 599');
  expect(await invisibili(page)).toBe(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc')).not.toContainText('riga numero');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#doc')).toContainText('riga numero 599');
  expect(await entrate(page)).toBe(600);
});

test('titolo vuoto appena aperto, incolla 600 righe e annulla: il titolo vuoto torna', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('# ');
  await expect(page.locator('#doc h1')).toHaveCount(1);
  await incolla(page, righe(600));
  await expect(page.locator('#doc')).toContainText('riga numero 599');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc h1')).toHaveCount(1);
  await expect(page.locator('#doc')).not.toContainText('riga numero');
  await page.keyboard.type('Ciao');
  await expect(page.locator('#doc h1')).toHaveText('Ciao');
});

test('due incolla lunghi di fila e due annulla: torna il foglio vuoto', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('abc');
  await incolla(page, righe(300));
  await incolla(page, righe(300));
  expect(await entrate(page)).toBe(600);
  await page.keyboard.press('Control+z');
  expect(await entrate(page)).toBe(300);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc')).toHaveText('abc');
});

test('citazione appena aperta, incolla 60 righe: la prima riga incollata è la prima della citazione', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('> ');
  await incolla(page, righe(60));
  const primo = await page.evaluate(() => document.querySelector('#doc blockquote').innerText.split('\n')[0]);
  expect(primo).toBe('riga numero 0 del testo incollato');
  expect(await invisibili(page)).toBe(0);
});

test('voce di elenco appena aperta, incolla 600 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('- ');
  await incolla(page, righe(600));
  expect(await entrate(page)).toBe(600);
  expect(await invisibili(page)).toBe(0);
  const primo = await page.evaluate(() => document.querySelector('#doc li') && document.querySelector('#doc li').innerText);
  console.log('prima voce', JSON.stringify(primo));
});

test('in fondo a una citazione con testo incolla 600 righe: nessun carattere invisibile, nemmeno nel copiato o dopo annulla', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.keyboard.type('> citazione');
  await incolla(page, righe(600));
  expect(await entrate(page)).toBe(600);
  expect(await invisibili(page)).toBe(0);
  const copiato = await page.evaluate(() => {
    const doc = document.getElementById('doc');
    const r = document.createRange(); r.selectNodeContents(doc);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return s.toString();
  });
  expect((copiato.match(/[​﻿]/g) || []).length).toBe(0);
  await page.keyboard.press('Control+z');
  expect(await invisibili(page)).toBe(0);
  await expect(page.locator('#doc')).toHaveText('citazione');
});

test('cursore sul foglio fra due blocchi, incolla 600 righe: il testo entra nel blocco accanto', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<p>primo</p><p>secondo</p>', `getSelection().collapse(doc, 1);`);
  await incolla(page, righe(600));
  expect(await entrate(page)).toBe(600);
  const fuori = await page.evaluate(() => [...document.getElementById('doc').childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).length);
  expect(fuori).toBe(0);
  const testo = await page.evaluate(() => document.getElementById('doc').innerText);
  expect(testo.indexOf('primo')).toBeLessThan(testo.indexOf('riga numero 0'));
  expect(testo.indexOf('riga numero 599')).toBeLessThan(testo.indexOf('secondo'));
  await page.keyboard.press('Control+z');
  await expect(page.locator('#doc')).not.toContainText('riga numero');
});

test('cursore sul foglio in fondo, dopo una lista, incolla 600 righe', async ({ openTab }) => {
  const page = await apri(openTab);
  await prepara(page, '<ul><li>uno</li></ul>', `getSelection().collapse(doc, 1);`);
  await incolla(page, righe(600));
  expect(await entrate(page)).toBe(600);
  const testo = await page.evaluate(() => document.getElementById('doc').innerText);
  expect(testo.indexOf('uno')).toBeLessThan(testo.indexOf('riga numero 0'));
});
