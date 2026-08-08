// #409 — Due avvisi ravvicinati DENTRO la pagina si sovrapponevano.
//
// Scritto black-box dal sintomo: tasto destro vero su un link, "Copia URL", e
// subito dopo "Salva link per dopo". Prima ogni avviso era ancorato da solo in
// basso a destra: il secondo veniva disegnato SOPRA il primo (stesso bordo
// superiore) e non se ne leggeva nessuno dei due.
//
// Assert di SUCCESSO (rossi senza il fix):
//   1. i due avvisi sono entrambi presenti e i loro riquadri NON si intersecano;
//   2. una raffica di avvisi resta dentro la finestra (nessuno finisce sopra il
//      bordo superiore) e non cresce all'infinito;
//   3. l'avviso di attesa e quello di esito (il caso "traduzione in corso" →
//      "tradotta") convivono senza coprirsi.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const PAGE = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
  <h1>Pagina con un collegamento</h1>
  <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
</body></html>`;

// Riquadri di tutti gli avvisi in pagina, nell'ordine del DOM.
async function toastBoxes(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.sn-toast')).map((el) => {
    const r = el.getBoundingClientRect();
    return { text: el.textContent, x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
  }));
}

function overlaps(a, b) {
  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

function firstOverlap(boxes) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) return [boxes[i], boxes[j]];
    }
  }
  return null;
}

async function clickMenuItem(page, selector, label, exclude) {
  await page.locator(selector).click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  let item = menu.locator('button', { hasText: label });
  if (exclude) item = item.filter({ hasNotText: exclude });
  await item.first().click();
  await expect(menu).toBeHidden();
}

test('due avvisi ravvicinati si impilano invece di sovrapporsi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // Il flusso della segnalazione: due azioni di fila sullo stesso link.
  await clickMenuItem(page, '#link', 'Copia URL', 'immagine');
  await clickMenuItem(page, '#link', 'Salva link per dopo');

  // Entrambi gli avvisi devono essere vivi insieme (durata 2200ms: qui siamo
  // ampiamente dentro la finestra in cui prima si coprivano).
  await expect(page.locator('.sn-toast')).toHaveCount(2, { timeout: 5000 });

  try { mkdirSync('tests/.shots', { recursive: true }); } catch (_) {}
  await page.screenshot({ path: 'tests/.shots/toast-stack-409.png' }).catch(() => {});

  const boxes = await toastBoxes(page);
  for (const b of boxes) {
    expect(b.w, `avviso senza larghezza: ${b.text}`).toBeGreaterThan(0);
    expect(b.h, `avviso senza altezza: ${b.text}`).toBeGreaterThan(0);
  }
  // Il cuore della segnalazione: prima i due avevano lo stesso bordo superiore.
  expect(boxes[0].y, 'i due avvisi partono dalla stessa altezza: sono sovrapposti')
    .not.toBe(boxes[1].y);
  expect(firstOverlap(boxes), 'due avvisi si intersecano').toBeNull();

  // E restano entrambi leggibili: nessuno esce dalla finestra.
  const vh = await page.evaluate(() => window.innerHeight);
  for (const b of boxes) {
    expect(b.y, `avviso fuori dal bordo superiore: ${b.text}`).toBeGreaterThanOrEqual(0);
    expect(b.bottom, `avviso fuori dal bordo inferiore: ${b.text}`).toBeLessThanOrEqual(vh + 1);
  }
});

test('una raffica di avvisi resta dentro la finestra e non si accavalla', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // Otto azioni di fila: ben oltre il tetto dello stack.
  for (let i = 0; i < 8; i++) {
    await clickMenuItem(page, '#link', 'Copia URL', 'immagine');
  }

  const boxes = await toastBoxes(page);
  expect(boxes.length, 'la raffica non ha prodotto avvisi').toBeGreaterThan(0);
  // Il tetto tiene la crescita sotto controllo (senza, sarebbero otto).
  expect(boxes.length, 'lo stack cresce senza tetto').toBeLessThanOrEqual(5);
  expect(firstOverlap(boxes), 'gli avvisi della raffica si intersecano').toBeNull();

  const vh = await page.evaluate(() => window.innerHeight);
  for (const b of boxes) {
    expect(b.y, 'un avviso della raffica è finito sopra il bordo della finestra')
      .toBeGreaterThanOrEqual(0);
    expect(b.bottom).toBeLessThanOrEqual(vh + 1);
  }
  await page.screenshot({ path: 'tests/.shots/toast-stack-409-raffica.png' }).catch(() => {});
});

test('l\'avviso di attesa e quello di esito convivono senza coprirsi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // Il caso "operazione lunga": un avviso che resta (durata 0) e l'esito che
  // arriva mentre il primo è ancora vivo — è quello che succede con la
  // traduzione della pagina o la trascrizione quando il modello risponde in
  // fretta. Qui lo riproduciamo con due azioni reali che generano due avvisi
  // mentre il primo è ancora sullo schermo.
  await clickMenuItem(page, '#link', 'Salva link per dopo');
  await clickMenuItem(page, '#link', 'Copia URL', 'immagine');
  await clickMenuItem(page, '#link', 'Salva link per dopo');

  await expect(page.locator('.sn-toast')).toHaveCount(3, { timeout: 5000 });
  const boxes = await toastBoxes(page);
  expect(firstOverlap(boxes), 'attesa ed esito si coprono a vicenda').toBeNull();

  // Ordine: il più recente è quello più vicino all'angolo (in basso).
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].y, 'gli avvisi non sono impilati in ordine').toBeGreaterThan(boxes[i - 1].y);
  }
});
