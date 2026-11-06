// Esplorazione (si cancella): tempi e esiti dell'incolla lungo in vari punti del foglio.
import { test, expect } from '../../fixtures/electron.mjs';

test.setTimeout(240_000);

const righe = (n, prima = null) => Array.from({ length: n }, (_, i) => (i === 0 && prima != null ? prima : `riga numero ${i} del testo incollato`)).join('\n');

async function prepara(page, html, posa) {
  await page.evaluate(({ html, posa }) => {
    const doc = document.getElementById('doc');
    doc.focus();
    doc.innerHTML = html;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
    const sel = window.getSelection();
    const r = document.createRange();
    const [selettore, idx, off, fine] = posa;
    const el = doc.querySelectorAll(selettore)[idx];
    if (fine === 'tutto') { r.selectNodeContents(doc); }
    else if (typeof fine === 'number') { r.setStart(el.firstChild, off); r.setEnd(el.firstChild, fine); }
    else if (Array.isArray(fine)) { const el2 = doc.querySelectorAll(fine[0])[fine[1]]; r.setStart(el.firstChild, off); r.setEnd(el2.firstChild, fine[2]); }
    else {
      const t = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : el;
      r.setStart(t, off === 'fine' ? (t.nodeType === 3 ? t.length : t.childNodes.length) : off);
      r.collapse(true);
    }
    sel.removeAllRanges(); sel.addRange(r);
  }, { html, posa });
}

async function incolla(page, testo) {
  return page.evaluate((t) => {
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    const t0 = performance.now();
    document.getElementById('doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return Math.round(performance.now() - t0);
  }, testo);
}

const stato = (page) => page.evaluate(() => {
  const d = document.getElementById('doc');
  return { html: d.innerHTML.slice(0, 400), len: d.innerHTML.length, testo: d.innerText.slice(0, 300), li: d.querySelectorAll('li').length, ul: d.querySelectorAll('ul,ol').length, ulInLi: d.querySelectorAll('li ul, li ol').length, p: d.querySelectorAll('p').length, nbsp: (d.innerHTML.match(/&nbsp;/g) || []).length };
});

const casi = [
  ['A secondo paragrafo inizio, 60 righe prima vuota', '<p>primo paragrafo</p><p>secondo paragrafo</p>', ['p', 1, 0], righe(60, '')],
  ['B fine paragrafo 100 righe', '<p>alpha beta</p>', ['p', 0, 'fine'], righe(100)],
  ['C vuoto 600 prima vuota', '<p><br></p>', ['p', 0, 0], righe(600, '')],
  ['C2 vuoto 1500 prima vuota', '<p><br></p>', ['p', 0, 0], righe(1500, '')],
  ['D elenco voce 2 fine 600', '<ul><li>uno</li><li>due</li><li>tre</li></ul>', ['li', 1, 'fine'], righe(600)],
  ['D2 elenco voce 2 fine 600 prima vuota', '<ul><li>uno</li><li>due</li><li>tre</li></ul>', ['li', 1, 'fine'], righe(600, '')],
  ['D3 elenco voce vuota 600', '<ul><li>uno</li><li><br></li></ul>', ['li', 1, 0], righe(600)],
  ['E paragrafo vuoto dopo elenco 600', '<ul><li>uno</li><li>due</li></ul><p><br></p>', ['p', 0, 0], righe(600)],
  ['E2 paragrafo vuoto dopo elenco 600 prima vuota', '<ul><li>uno</li><li>due</li></ul><p><br></p>', ['p', 0, 0], righe(600, '')],
  ['E3 paragrafo vuoto fra due titoli 600', '<h2>Uno</h2><p><br></p><h2>Due</h2>', ['p', 0, 0], righe(600)],
  ['E4 paragrafo vuoto dopo citazione 600', '<blockquote>citato</blockquote><p><br></p>', ['p', 0, 0], righe(600)],
  ['F seleziona tutto 600', '<p>uno</p><p>due</p><p>tre</p>', ['p', 0, 0, 'tutto'], righe(600)],
  ['G dopo spazio 60', '<p>alpha beta</p>', ['p', 0, 6], righe(60)],
  ['H prima riga un carattere 600', '<p>testo</p><p><br></p>', ['p', 1, 0], righe(600, 'x')],
  ['J titolo fine 600', '<h1>Titolo</h1>', ['h1', 0, 'fine'], righe(600)],
  ['K citazione fine 600', '<blockquote>citato</blockquote>', ['blockquote', 0, 'fine'], righe(600)],
  ['L emoji intorno 600', '<p>ciao 😀😀</p><ul><li>x</li></ul>', ['p', 0, 6], righe(600)],
];

for (const [nome, html, posa, testo] of casi) {
  test(nome, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    const errori = [];
    page.on('pageerror', (e) => errori.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errori.push(m.text()); });
    await prepara(page, html, posa);
    const prima = await stato(page);
    const ms = await incolla(page, testo);
    const dopo = await stato(page);
    await page.keyboard.press('Control+z');
    const annullato = await stato(page);
    console.log(JSON.stringify({ nome, ms, errori, prima, dopo, annullatoUguale: annullato.html === prima.html && annullato.len === prima.len, annullato: annullato.len === prima.len ? 'stessa lunghezza' : annullato.html }));
    expect(true).toBe(true);
  });
}
