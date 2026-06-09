// Feedback alpha:
//   - oLi0ckc4Y3w52cN7vX9P: incollare testo deve inserire SOLO testo semplice,
//     senza lo sfondo/formattazione della sorgente.
//   - BPjht0vaCGbs7QGGzx82: zoom del foglio con Ctrl+= / Ctrl+0 e Ctrl+rotella
//     (pinch del trackpad).
//
// Entrambi asseriscono il SUCCESSO della feature e sarebbero rossi senza il fix
// (prima non c'era né handler di paste né gestione dello zoom).

import { test, expect } from './fixtures/electron.mjs';

test('incollare testo inserisce solo testo semplice (niente sfondo né span)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');

  const result = await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(doc);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    const dt = new DataTransfer();
    dt.setData('text/plain', 'testo incollato');
    dt.setData('text/html', '<span style="background-color: rgb(200,0,0); color:#fff">testo incollato</span>');
    doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));

    return { html: doc.innerHTML.toLowerCase(), text: doc.textContent };
  });

  expect(result.text).toContain('testo incollato');
  expect(result.html).not.toContain('background');
  expect(result.html).not.toContain('<span');
});

test('zoom: Ctrl+= ingrandisce, Ctrl+0 ripristina, Ctrl+rotella (pinch) ingrandisce', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');

  // Ctrl+= ingrandisce
  await page.keyboard.press('Control+Equal');
  let zoom = await page.evaluate(() => document.getElementById('doc').style.zoom);
  expect(parseFloat(zoom)).toBeGreaterThan(1);

  // Ctrl+0 ripristina a 1 (zoom rimosso)
  await page.keyboard.press('Control+Digit0');
  zoom = await page.evaluate(() => document.getElementById('doc').style.zoom);
  expect(zoom === '' || parseFloat(zoom) === 1).toBeTruthy();

  // Ctrl+rotella (come il pinch del trackpad) ingrandisce
  await page.evaluate(() => {
    document.getElementById('docWrap').dispatchEvent(
      new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true })
    );
  });
  zoom = await page.evaluate(() => document.getElementById('doc').style.zoom);
  expect(parseFloat(zoom)).toBeGreaterThan(1);
});
