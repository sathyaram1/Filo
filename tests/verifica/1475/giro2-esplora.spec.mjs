// Esplorazione giro 2 #1475: incolla lungo in posizioni e forme diverse.
import { test, expect } from '../../fixtures/electron.mjs';

async function incolla(editor, testo) {
  await editor.evaluate((t) => {
    const d = document.getElementById('doc');
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    window.__fine = null;
    setTimeout(() => {
      const t0 = performance.now();
      d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      window.__fine = performance.now() - t0;
    }, 0);
  }, testo);
  await expect.poll(() => editor.evaluate(() => window.__fine), { timeout: 200_000, intervals: [500] }).not.toBeNull();
  return editor.evaluate(() => window.__fine);
}

const righe = (n, pre = '') => Array.from({ length: n }, (_, i) => `${pre}Riga ${i} con testo qualsiasi.`).join('\n');

async function apri(openTab, html) {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.evaluate((h) => {
    const d = document.getElementById('doc');
    d.innerHTML = h;
    d.focus();
  }, html);
  return editor;
}

async function caret(editor, sel, offset) {
  await editor.evaluate(({ sel, offset }) => {
    const el = document.querySelector(sel);
    const node = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : el;
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, { sel, offset });
}

test('a testo che comincia con un a capo, documento vuoto', async ({ openTab }) => {
  test.setTimeout(240_000);
  const editor = await apri(openTab, '<p><br></p>');
  await caret(editor, '#doc p', 0);
  const ms = await incolla(editor, `\n${righe(600)}`);
  console.log('a ms', Math.round(ms));
});

test('b prima riga di un carattere, documento vuoto', async ({ openTab }) => {
  test.setTimeout(240_000);
  const editor = await apri(openTab, '<p><br></p>');
  await caret(editor, '#doc p', 0);
  const ms = await incolla(editor, `1\n${righe(600)}`);
  console.log('b ms', Math.round(ms));
});

test('c a metà di un paragrafo', async ({ openTab }) => {
  test.setTimeout(240_000);
  const editor = await apri(openTab, '<p>Ciao mondo</p>');
  await caret(editor, '#doc p', 5);
  const ms = await incolla(editor, righe(60));
  const t = await editor.evaluate(() => document.getElementById('doc').innerText);
  console.log('c ms', Math.round(ms), JSON.stringify(t.slice(0, 80)), JSON.stringify(t.slice(-80)));
});

test('d dentro un elenco', async ({ openTab }) => {
  test.setTimeout(240_000);
  const editor = await apri(openTab, '<ul><li>voce</li></ul>');
  await caret(editor, '#doc li', 4);
  const ms = await incolla(editor, righe(600));
  console.log('d ms', Math.round(ms));
});

test('e markup, spazi e emoji arrivano come testo', async ({ openTab }) => {
  test.setTimeout(240_000);
  const editor = await apri(openTab, '<p>X</p>');
  await caret(editor, '#doc p', 1);
  const testo = `prima 😀\n${Array.from({ length: 60 }, (_, i) => `<b>r${i}</b> &amp;  doppio\t tab <img src=x onerror="window.__x=1">`).join('\n')}\nultima 😀`;
  await incolla(editor, testo);
  const t = await editor.evaluate(() => ({ txt: document.getElementById('doc').innerText, img: document.querySelectorAll('#doc img, #doc b').length, x: window.__x || 0 }));
  console.log('e', t.img, t.x, JSON.stringify(t.txt.slice(0, 120)), JSON.stringify(t.txt.slice(-30)));
});

test('f annulla dopo un incolla lungo', async ({ openTab }) => {
  test.setTimeout(240_000);
  const editor = await apri(openTab, '<p>Inizio</p>');
  await caret(editor, '#doc p', 6);
  await incolla(editor, righe(100));
  await editor.keyboard.press('Control+z');
  const t = await editor.evaluate(() => document.getElementById('doc').innerText);
  console.log('f dopo un annulla', JSON.stringify(t.slice(0, 100)), t.length);
});
