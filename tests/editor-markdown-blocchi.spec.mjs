// Le scorciatoie Markdown di blocco dell'editor («# », «## », «### », «> », «- », «1. »): il blocco dove si scrive
// diventa titolo, citazione o elenco, e nessun altro blocco cambia né se ne aggiunge uno vuoto (#2279).

import { test, expect } from './fixtures/electron.mjs';

// Tag e testo di ogni blocco del foglio, senza la freccia dei titoli.
const blocchi = (page) => page.evaluate(() => [...document.getElementById('doc').children].map((el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('.ed-collapse-toggle').forEach((b) => b.remove());
  return `${el.tagName.toLowerCase()}:${c.textContent}`;
}));

async function apriFoglioNuovo(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.locator('#doc').click();
  return page;
}

test('in un foglio nuovo «# » apre un titolo solo, senza un paragrafo vuoto sotto, e così resta dopo il salvataggio', async ({ openTab }) => {
  const page = await apriFoglioNuovo(openTab);
  await page.keyboard.type('# Titolo');
  expect(await blocchi(page)).toEqual(['h1:Titolo']);
  await page.keyboard.press('Enter');
  await page.keyboard.type('- voce');
  await page.keyboard.press('Enter');
  await page.keyboard.type('altra');
  expect(await blocchi(page)).toEqual(['h1:Titolo', 'ul:vocealtra']);
  expect(await page.locator('#doc li').allTextContents()).toEqual(['voce', 'altra']);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.ed-save-state')).toHaveText('Salvato');
  await page.reload();
  await page.waitForSelector('#doc h1');
  expect(await blocchi(page)).toEqual(['h1:Titolo', 'ul:vocealtra']);
  expect(await page.locator('#doc li').allTextContents()).toEqual(['voce', 'altra']);
});

test('ESPLORA undo', async ({ openTab }) => {
  const page = await apriFoglioNuovo(openTab);
  const errori = [];
  page.on('pageerror', (e) => errori.push(e.message));
  const html = () => page.evaluate(() => document.getElementById('doc').innerHTML.replace(/<button[^>]*>.*?<\/button>/g, ''));
  for (const seq of ['# Tit', '- voce', '- div']) {
    await page.evaluate((seq) => { const d = document.getElementById('doc'); d.innerHTML = seq === '- div' ? '<h1>sopra</h1><div><br></div>' : '<p>sopra</p><p><br></p>'; d.focus(); const r = document.createRange(); r.setStart(d.children[1], 0); getSelection().removeAllRanges(); getSelection().addRange(r); }, seq);
    await page.keyboard.type(seq);
    console.log('UNDO', seq, 'dopo', await html());
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Control+Z'); console.log('UNDO', seq, i, await html()); }
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Control+Shift+Z'); console.log('REDO', seq, i, await html()); }
  }
  console.log('UNDO errori', errori);
});

const CASI = [
  ['# ', 'h1'],
  ['## ', 'h2'],
  ['### ', 'h3'],
  ['> ', 'blockquote'],
  ['- ', 'ul'],
  ['1. ', 'ol'],
];

test('ogni scorciatoia in un foglio nuovo cambia solo il suo blocco, e il cursore resta lì dentro', async ({ openTab }) => {
  const page = await apriFoglioNuovo(openTab);
  for (const [seq, tag] of CASI) {
    await page.evaluate(() => {
      const d = document.getElementById('doc');
      d.innerHTML = '<p><br></p>';
      d.focus();
      const r = document.createRange();
      r.setStart(d.firstChild, 0);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.keyboard.type(`${seq}scritto`);
    expect(await blocchi(page), seq).toEqual([`${tag}:scritto`]);
  }
});

test('in una riga vuota fra due paragrafi la scorciatoia cambia quella riga, non il paragrafo dopo', async ({ openTab }) => {
  const page = await apriFoglioNuovo(openTab);
  for (const [seq, tag] of CASI) {
    await page.evaluate(() => {
      const d = document.getElementById('doc');
      d.innerHTML = '<p>sopra</p><p><br></p><p>sotto</p>';
      d.focus();
      const r = document.createRange();
      r.setStart(d.children[1], 0);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.keyboard.type(`${seq}mezzo`);
    expect(await blocchi(page), seq).toEqual(['p:sopra', `${tag}:mezzo`, 'p:sotto']);
  }
});
