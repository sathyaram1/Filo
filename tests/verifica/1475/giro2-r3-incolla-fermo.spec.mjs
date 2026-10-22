// Verifica #1475, giro 2, rilievo 3: un testo di 600 righe incollato non ferma la pagina nemmeno quando comincia con una
// riga vuota o quando si incolla dentro un elenco.
import { test, expect } from '../../fixtures/electron.mjs';

const RIGHE = Array.from({ length: 600 }, (_, i) => `Riga ${i}: si discute di ferie e turni.`).join('\n');

async function incollaIn(openTab, html, sel, offset, testo) {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.evaluate(({ html, sel, offset, testo }) => {
    const d = document.getElementById('doc');
    d.innerHTML = html;
    d.focus();
    const el = d.querySelector(sel);
    const r = document.createRange();
    r.setStart(el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : el, offset);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    const dt = new DataTransfer();
    dt.setData('text/plain', testo);
    window.__ms = null;
    setTimeout(() => {
      const t0 = performance.now();
      d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      window.__ms = performance.now() - t0;
    }, 0);
  }, { html, sel, offset, testo });
  await expect.poll(() => editor.evaluate(() => window.__ms), { timeout: 120_000, intervals: [500] }).not.toBeNull();
  expect(await editor.evaluate(() => document.getElementById('doc').innerText)).toContain('Riga 599:');
  return editor.evaluate(() => window.__ms);
}

test('r3 un testo che comincia con una riga vuota, in un documento vuoto', async ({ openTab }) => {
  test.setTimeout(180_000);
  const ms = await incollaIn(openTab, '<p><br></p>', 'p', 0, `\n${RIGHE}`);
  expect(ms, `la pagina è rimasta ferma ${Math.round(ms / 1000)} secondi`).toBeLessThan(3_000);
});

test('r3 un testo incollato dentro una voce di elenco', async ({ openTab }) => {
  test.setTimeout(180_000);
  const ms = await incollaIn(openTab, '<ul><li>voce</li></ul>', 'li', 4, RIGHE);
  expect(ms, `la pagina è rimasta ferma ${Math.round(ms / 1000)} secondi`).toBeLessThan(3_000);
});
