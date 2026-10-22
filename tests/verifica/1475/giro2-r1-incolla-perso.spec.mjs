// Verifica #1475, giro 2, rilievo 1: un testo lungo che comincia con una riga vuota, incollato all'inizio di un
// paragrafo che non è il primo, deve entrare nel documento (prima non entrava niente, senza un avviso).
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 un testo di 60 righe con una riga vuota in testa, incollato all\'inizio del secondo paragrafo, entra', async ({ openTab }) => {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  const errori = [];
  editor.on('pageerror', (e) => errori.push(e.message));
  await editor.evaluate(() => {
    const d = document.getElementById('doc');
    d.innerHTML = '<p>Uno</p><p>Due</p>';
    d.focus();
    const r = document.createRange();
    r.setStart(d.querySelectorAll('p')[1].firstChild, 0);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const testo = `\n${Array.from({ length: 60 }, (_, i) => `Riga ${i} del verbale.`).join('\n')}`;
    const dt = new DataTransfer();
    dt.setData('text/plain', testo);
    d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const testo = await editor.evaluate(() => document.getElementById('doc').innerText);
  expect(testo, `errori della pagina: ${errori.join(' | ')}`).toContain('Riga 0 del verbale.');
  expect(testo).toContain('Riga 59 del verbale.');
  expect(testo.indexOf('Uno')).toBeLessThan(testo.indexOf('Riga 0 del verbale.'));
  expect(testo.indexOf('Riga 59 del verbale.')).toBeLessThan(testo.indexOf('Due'));
});
