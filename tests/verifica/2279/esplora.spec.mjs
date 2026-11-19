import { test, expect } from '../../fixtures/electron.mjs';

async function apri(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  return page;
}
const html = (page) => page.evaluate(() => {
  const c = document.getElementById('doc').cloneNode(true);
  c.querySelectorAll('.ed-collapse-toggle').forEach((b) => b.remove());
  return c.innerHTML;
});
const salvato = (page) => page.evaluate(() => {
  const col = JSON.parse(localStorage.getItem('filo.editor.collection'));
  const f = col.files.find((x) => x.id === col.activeId);
  return JSON.stringify(f.content);
});
const imposta = (page, h, sel) => page.evaluate(({ h, sel }) => {
  const d = document.getElementById('doc');
  d.innerHTML = h;
  d.focus();
  const el = d.querySelector(sel);
  const r = document.createRange();
  r.setStart(el, 0); r.collapse(true);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}, { h, sel });

test('esplora', async ({ openTab }) => {
  test.setTimeout(240000);
  const page = await apri(openTab);
  const log = [];
  log.push(['nuovo iniziale', await html(page)]);
  await page.click('#doc');
  await page.keyboard.type('# ');
  log.push(['nuovo # ', await html(page)]);
  await page.keyboard.type('Titolo');
  log.push(['nuovo # Titolo', await html(page)]);
  await page.keyboard.press('Enter');
  await page.keyboard.type('corpo');
  log.push(['enter corpo', await html(page)]);
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(300);
  log.push(['salvato', await salvato(page)]);

  for (const k of ['## ', '### ', '> ', '- ', '* ', '1. ']) {
    await imposta(page, '<p><br></p>', 'p');
    await page.keyboard.type(k);
    const a = await html(page);
    await page.keyboard.type('xy');
    log.push([`vuoto ${k}`, a + ' | ' + await html(page)]);
  }
  // in mezzo
  await imposta(page, '<p>abc</p><p><br></p><p>def</p>', 'p:nth-child(2)');
  await page.keyboard.type('# T');
  log.push(['mezzo', await html(page)]);
  // ultimo vuoto dopo testo
  await imposta(page, '<p>abc</p><p><br></p>', 'p:nth-child(2)');
  await page.keyboard.type('> q');
  log.push(['ultimo', await html(page)]);
  // vuoto prima di un titolo
  await imposta(page, '<p><br></p><h2>sotto</h2>', 'p');
  await page.keyboard.type('# T');
  log.push(['prima di h2', await html(page)]);
  // div da Invio
  await imposta(page, '<p>abc</p>', 'p');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  log.push(['dopo enter', await html(page)]);
  await page.keyboard.type('# T');
  log.push(['enter poi #', await html(page)]);
  // undo / redo
  await imposta(page, '<p><br></p>', 'p');
  await page.keyboard.type('# ');
  await page.keyboard.press('ControlOrMeta+z');
  log.push(['undo1', await html(page)]);
  await page.keyboard.press('ControlOrMeta+z');
  log.push(['undo2', await html(page)]);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  log.push(['redo1', await html(page)]);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  log.push(['redo2', await html(page)]);
  // in una voce di elenco
  await imposta(page, '<ul><li><br></li></ul>', 'li');
  await page.keyboard.type('# T');
  log.push(['li #', await html(page)]);
  // in un titolo esistente vuoto
  await imposta(page, '<h2><br></h2>', 'h2');
  await page.keyboard.type('# T');
  log.push(['h2 #', await html(page)]);
  // citazione vuota
  await imposta(page, '<blockquote><br></blockquote>', 'blockquote');
  await page.keyboard.type('- T');
  log.push(['bq -', await html(page)]);
  // documento intero vuoto senza p
  await page.evaluate(() => { const d = document.getElementById('doc'); d.innerHTML = ''; d.focus(); });
  await page.keyboard.type('# T');
  log.push(['vuoto senza p', await html(page)]);
  // # poi backspace
  await imposta(page, '<p><br></p>', 'p');
  await page.keyboard.type('# ');
  await page.keyboard.press('Backspace');
  log.push(['# bksp', await html(page)]);
  await page.keyboard.type('x');
  log.push(['# bksp x', await html(page)]);
  // foglio svuotato con seleziona tutto
  await imposta(page, '<p>abc</p><p>def</p>', 'p');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  log.push(['svuotato', await html(page)]);
  await page.keyboard.type('# T');
  log.push(['svuotato # T', await html(page)]);
  // h2 vuoto e salvataggio
  await imposta(page, '<p>a</p><h2><br></h2>', 'h2');
  await page.keyboard.type('# T');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(300);
  log.push(['h2 salvato', await salvato(page)]);
  // h1 vuoto con ##
  await imposta(page, '<h1><br></h1><p>x</p>', 'h1');
  await page.keyboard.type('## T');
  log.push(['h1 ##', await html(page)]);
  // blockquote vuoto con #
  await imposta(page, '<blockquote><br></blockquote>', 'blockquote');
  await page.keyboard.type('# T');
  log.push(['bq #', await html(page)]);
  // li con >
  await imposta(page, '<ul><li>a</li><li><br></li></ul>', 'li:nth-child(2)');
  await page.keyboard.type('> T');
  log.push(['li >', await html(page)]);
  await imposta(page, '<ul><li>a</li><li><br></li></ul>', 'li:nth-child(2)');
  await page.keyboard.type('# T');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(300);
  log.push(['li # salvato', await html(page), await salvato(page)]);
  await imposta(page, '<p><br></p>', 'p');
  await page.keyboard.type('# ');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('# Titolo');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(300);
  log.push(['# bksp # Titolo', await html(page), await salvato(page)]);
  await imposta(page, '<h1>Vecchio</h1><p>corpo</p>', 'h1');
  await page.keyboard.press('End');
  for (let i = 0; i < 7; i++) await page.keyboard.press('Backspace');
  log.push(['h1 svuotato', await html(page)]);
  await page.keyboard.type('## Nuovo');
  log.push(['h1 svuotato ## Nuovo', await html(page)]);
  for (const [n, ...v] of log) console.log(n, '=>', ...v);
});
