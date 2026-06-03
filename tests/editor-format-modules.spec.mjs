// Verifica i moduli di formattazione dell'editor (feedback alpha): grassetto,
// corsivo, sottolineato, indietro/avanti, dimensione testo e allineamento.
// I test asseriscono il SUCCESSO della formattazione (il testo cambia davvero),
// non solo la presenza dei bottoni.

import { test, expect } from './fixtures/electron.mjs';

// Aggiunge un modulo cliccando la prima cella vuota della griglia e scegliendolo
// dal menu "Aggiungi modulo".
async function addModule(page, type) {
  await page.locator('.ed-cell-empty').first().click();
  await page.locator(`.ed-overlay [data-add="${type}"]`).click();
  await page.waitForSelector(`.ed-module[data-type="${type}"]`);
}

// Imposta il contenuto dell'editor e seleziona l'intero primo paragrafo.
async function setContentAndSelect(page, html) {
  await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    const block = doc.querySelector('p, h1, h2, h3');
    const range = document.createRange();
    range.selectNodeContents(block);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, html);
}

test('il menu "Aggiungi modulo" elenca i nuovi moduli di formattazione', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await page.locator('.ed-cell-empty').first().click();
  for (const t of ['bold', 'italic', 'underline', 'undo', 'redo', 'text-size', 'align']) {
    await expect(page.locator(`.ed-overlay [data-add="${t}"]`)).toHaveCount(1);
  }
});

test('il modulo Grassetto rende grassetto il testo selezionato', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await addModule(page, 'bold');
  await setContentAndSelect(page, '<p>ciao mondo</p>');
  await page.locator('.ed-module[data-type="bold"] .ed-fmt-btn').click();
  const html = await page.locator('#doc').innerHTML();
  // Senza il fix il testo resterebbe non formattato: qui DEVE comparire un tag
  // bold (o uno stile font-weight) attorno al testo selezionato.
  expect(html).toMatch(/<(strong|b)\b|font-weight\s*:\s*bold/i);
});

test('il modulo Corsivo rende corsivo il testo selezionato', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await addModule(page, 'italic');
  await setContentAndSelect(page, '<p>ciao mondo</p>');
  await page.locator('.ed-module[data-type="italic"] .ed-fmt-btn').click();
  const html = await page.locator('#doc').innerHTML();
  expect(html).toMatch(/<(em|i)\b|font-style\s*:\s*italic/i);
});

test('il modulo Allineamento centra il testo e l\'allineamento viene salvato', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await addModule(page, 'align');
  await setContentAndSelect(page, '<p>centra questo</p>');
  await page.locator('.ed-module[data-type="align"] .ed-fmt-btn[data-align="center"]').click();

  // Effetto immediato: un blocco dell'editor ha text-align:center.
  await expect.poll(() => page.evaluate(() => {
    for (const el of document.querySelectorAll('#doc *')) {
      if (el.style && el.style.textAlign === 'center') return 'center';
    }
    return '';
  })).toBe('center');

  // Persistenza: salva e rileggi il JSON serializzato → l'allineamento deve
  // sopravvivere al round-trip (attrs.align sul blocco).
  await page.keyboard.press('Control+s');
  const align = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('filo.editor.doc'));
    const block = (raw.content.content || []).find((b) => b.attrs && b.attrs.align);
    return block ? block.attrs.align : '';
  });
  expect(align).toBe('center');
});

test('il modulo Dimensione testo ingrandisce il testo selezionato (e si salva)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await addModule(page, 'text-size');
  await setContentAndSelect(page, '<p>ingrandisci</p>');
  await page.locator('.ed-module[data-type="text-size"] .ed-fmt-btn[data-size="up"]').click();

  const html = await page.locator('#doc').innerHTML();
  expect(html).toMatch(/font-size/i);

  // La dimensione deve sopravvivere al salvataggio (marca fontSize inline).
  await page.keyboard.press('Control+s');
  const hasFontSize = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('filo.editor.doc'));
    const json = JSON.stringify(raw.content);
    return json.includes('fontSize');
  });
  expect(hasFontSize).toBe(true);
});

test('i moduli Indietro/Avanti annullano e ripetono una modifica', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  await addModule(page, 'undo');
  await addModule(page, 'redo');

  // Parti da un documento vuoto, poi digita un singolo carattere (una voce di
  // undo deterministica).
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p><br></p>';
  });
  await page.click('#doc');
  await page.keyboard.type('x');
  await expect.poll(() => page.locator('#doc').innerText()).toContain('x');

  await page.locator('.ed-module[data-type="undo"] .ed-fmt-btn').click();
  await expect.poll(() => page.locator('#doc').innerText()).not.toContain('x');

  await page.locator('.ed-module[data-type="redo"] .ed-fmt-btn').click();
  await expect.poll(() => page.locator('#doc').innerText()).toContain('x');
});
