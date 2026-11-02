// Verifica #1434 giro 2, rilievo 1: la fila legge la formattazione che il testo selezionato ha già. L'Evidenzia premuto
// sul testo evidenziato lo toglie; sul testo in grassetto l'icona Grassetto si mostra accesa e il Corsivo no.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SITO = `<!doctype html><html><head><title>Fila</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="ricco" contenteditable="true" style="border:1px solid #999;padding:6px;width:400px">Una <b>parola</b> da formattare.</div>
  </body></html>`;

// Seleziona la parola nel campo e dà il punto dove cliccare.
const seleziona = (page, parola) => page.evaluate((p) => {
  const el = document.getElementById('ricco');
  el.focus();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = w.nextNode())) {
    const i = t.nodeValue.indexOf(p);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + p.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  return null;
}, parola);

const stato = (b) => b.evaluate((e) => `${e.getAttribute('aria-pressed') || ''}|${[...e.classList].sort().join(' ')}`);
// Il fondo che il testo ha davvero, risalendo fino al campo.
const fondo = (page, parola) => page.evaluate((p) => {
  const el = document.getElementById('ricco');
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = w.nextNode())) {
    if (!t.nodeValue.includes(p)) continue;
    for (let n = t.parentElement; n && n !== el.parentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c;
    }
    return '';
  }
  return 'non trovato';
}, parola);

test('r1 Evidenzia premuto di nuovo sul testo evidenziato lo toglie', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  for (const atteso of [/./, /^$/]) {
    const p = await seleziona(page, 'formattare');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await menuDi(page).locator('.sn-menu-row [data-sn-icon-id="scrivibile:highlight"]').click();
    await expect.poll(() => fondo(page, 'formattare')).toMatch(atteso);
  }
});

test('r1 sul testo in grassetto l\'icona Grassetto della fila è accesa e il Corsivo no', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, SITO);
  const p = await seleziona(page, 'parola');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = menuDi(page);
  const grassetto = menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:bold"]');
  const corsivo = menu.locator('.sn-menu-row [data-sn-icon-id="scrivibile:italic"]');
  await expect(grassetto).toBeVisible();
  const [g, c] = [await stato(grassetto), await stato(corsivo)];
  expect(g, `grassetto «${g}», corsivo «${c}»`).not.toBe(c);
});
