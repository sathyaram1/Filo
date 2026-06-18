// AUDIT (routine cloud) — i commenti dell'editor perdono l'ancora al reload.
//
// Flusso utente: nella pagina "Revisione" dell'editor il modulo "Commenta"
// permette di selezionare del testo e attaccarci un commento. Alla creazione il
// testo commentato viene evidenziato (span .ed-commented, tooltip col testo).
// Ipotesi del bug: dopo aver ricaricato l'editor (riapertura), il commento resta
// nella lista (il contatore segna 1) ma l'evidenziazione nel testo SPARISCE e non
// è più possibile sapere a quale frase si riferiva.
//
// Questo spec NON corregge nulla: serve a RIPRODURRE e documentare il problema.

import { test, expect } from './fixtures/electron.mjs';

test('editor: il commento perde l\'ancora nel testo dopo il reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  // 1) scrivi un po' di testo nel documento
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.focus();
    doc.innerHTML = '<p>La frase importante da commentare e poi altro testo.</p>';
    doc.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  // 2) vai alla pagina "Revisione" (seconda icona dello switch) dove vive il
  //    modulo Commenta
  const icons = page.locator('.ed-switch-icon');
  await icons.nth(1).click();
  await page.waitForSelector('.ed-comment-mod');

  // 3) avvia la modalità commento cliccando il modulo
  await page.locator('.ed-comment-mod .cm-count').first().click();

  // 4) seleziona "frase importante" nel documento e simula il mouseup che fa
  //    partire il prompt del commento
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    const tn = doc.querySelector('p').firstChild; // text node
    const txt = tn.nodeValue;
    const start = txt.indexOf('frase importante');
    const range = document.createRange();
    range.setStart(tn, start);
    range.setEnd(tn, start + 'frase importante'.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    doc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  // 5) compila il commento e salvalo
  await page.waitForSelector('#cmText');
  await page.fill('#cmText', 'Questo è il mio commento');
  await page.click('#cmSave');

  // 6) PRIMA del reload: l'evidenziazione esiste nel testo e il contatore è 1
  await expect(page.locator('#doc .ed-commented')).toHaveCount(1);
  await expect(page.locator('.ed-comment-mod .cm-count').first()).toHaveText('1');
  await page.screenshot({ path: 'tests/.shots/audit-editor-comment-before-reload.png' });

  // lascia che l'autosave (debounce 1200ms) scriva su localStorage
  await page.waitForTimeout(1500);

  // 7) ricarica l'editor (= riaprire la app/scheda)
  await page.reload();
  await page.waitForSelector('#doc');
  // torna sulla pagina Revisione per vedere il modulo commenti
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-comment-mod');

  // 8) DOPO il reload: il commento è ancora contato (1) MA l'evidenziazione nel
  //    testo è sparita → l'utente non sa più a quale frase si riferiva.
  const countAfter = await page.locator('.ed-comment-mod .cm-count').first().textContent();
  const highlightsAfter = await page.locator('#doc .ed-commented').count();
  await page.screenshot({ path: 'tests/.shots/audit-editor-comment-after-reload.png' });

  console.log(`[AUDIT] dopo reload: contatore commenti="${countAfter}", evidenziazioni nel testo=${highlightsAfter}`);

  // Il bug: contatore resta 1 ma le evidenziazioni nel testo sono 0.
  expect(countAfter).toBe('1');
  expect(highlightsAfter).toBe(0); // <- conferma la perdita dell'ancora
});
