// Verifica #1475, giro 2, rilievo 2: un annulla subito dopo un incolla lungo toglie tutto l'incollato, come per un
// incolla corto.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 un annulla dopo un incolla di 100 righe riporta il documento com\'era', async ({ openTab }) => {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.evaluate(() => {
    const d = document.getElementById('doc');
    d.innerHTML = '<p>Inizio</p>';
    d.focus();
    const r = document.createRange();
    r.setStart(d.querySelector('p').firstChild, 6);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const dt = new DataTransfer();
    dt.setData('text/plain', Array.from({ length: 100 }, (_, i) => `Riga ${i}.`).join('\n'));
    d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => editor.evaluate(() => document.getElementById('doc').innerText)).toContain('Riga 99.');
  await editor.keyboard.press('Control+z');
  await expect.poll(() => editor.evaluate(() => document.getElementById('doc').innerText.trim())).toBe('Inizio');
});
