// #409 — Due avvisi ravvicinati DENTRO la pagina si sovrapponevano.
//
// Scritto black-box dal sintomo: tasto destro vero su un link, "Copia URL", e
// subito dopo "Salva link per dopo". Prima ogni avviso era ancorato da solo in
// basso a destra: il secondo veniva disegnato SOPRA il primo (stesso bordo
// superiore) e non se ne leggeva nessuno dei due.
//
// Assert di SUCCESSO (rossi senza il fix):
//   1. i due avvisi sono entrambi presenti, partono da altezze diverse e i loro
//      riquadri NON si intersecano;
//   2. una raffica di avvisi non si accavalla, non straripa dalla finestra e non
//      cresce senza tetto;
//   3. anche la conferma cliccabile di "Salva per dopo" — ancorata allo stesso
//      angolo — sta nella pila invece di finire sotto/sopra un avviso.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const PAGE = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
  <h1>Pagina con un collegamento</h1>
  <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
</body></html>`;

// Riquadri di TUTTI gli avvisi ancorati all'angolo (toast + conferme cliccabili),
// nell'ordine del DOM.
const OVERLAY_SEL = '.sn-toast, .sn-save-confirm, .sn-dictate-pill';

async function overlayBoxes(page) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      text: (el.textContent || '').trim(),
      x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right,
    };
  }), OVERLAY_SEL);
}

function overlaps(a, b) {
  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

function firstOverlap(boxes) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i], boxes[j])) return [boxes[i].text, boxes[j].text];
    }
  }
  return null;
}

// Un'azione vera dal menu del tasto destro sul link. Subito dopo la chiusura del
// menu precedente un click destro può cadere a vuoto: si riprova finché la voce
// cercata non è davvero sullo schermo.
async function runLinkAction(page, label, { exclude = null, settle = 300 } = {}) {
  const menu = page.locator('.sn-menu');
  let item = null;
  for (let i = 0; i < 6 && !item; i++) {
    await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
    let cand = menu.locator('button', { hasText: label });
    if (exclude) cand = cand.filter({ hasNotText: exclude });
    try {
      await cand.first().waitFor({ state: 'visible', timeout: 1500 });
      item = cand;
    } catch (_) { await page.waitForTimeout(200); }
  }
  if (!item) throw new Error(`voce di menu non raggiungibile: ${label}`);
  await item.first().click();
  await expect(menu).toHaveCount(0);
  if (settle) await page.waitForTimeout(settle);
}

function shot(page, name) {
  try { mkdirSync('tests/.shots', { recursive: true }); } catch (_) {}
  return page.screenshot({ path: `tests/.shots/${name}.png` }).catch(() => {});
}

test('due avvisi ravvicinati si impilano invece di sovrapporsi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // Il flusso esatto della segnalazione: due azioni di fila sullo stesso link.
  await runLinkAction(page, 'Copia URL', { exclude: 'immagine' });
  await runLinkAction(page, 'Salva link per dopo');

  // Entrambi vivi insieme (durata 2200ms: siamo ampiamente dentro la finestra
  // in cui prima si coprivano).
  await expect(page.locator('.sn-toast')).toHaveCount(2, { timeout: 5000 });
  await shot(page, 'toast-stack-409');

  const boxes = await overlayBoxes(page);
  for (const b of boxes) {
    expect(b.w, `avviso senza larghezza: ${b.text}`).toBeGreaterThan(0);
    expect(b.h, `avviso senza altezza: ${b.text}`).toBeGreaterThan(0);
  }
  // Il cuore della segnalazione: prima i due avevano lo stesso bordo superiore.
  expect(boxes[0].y, 'i due avvisi partono dalla stessa altezza: sono sovrapposti')
    .not.toBeCloseTo(boxes[1].y, 0);
  expect(firstOverlap(boxes), 'due avvisi si intersecano').toBeNull();
  // Il più recente sta più in basso, vicino all'angolo.
  expect(boxes[1].y, 'gli avvisi non sono impilati in ordine').toBeGreaterThan(boxes[0].y);

  // E restano entrambi leggibili: nessuno esce dalla finestra.
  const vh = await page.evaluate(() => window.innerHeight);
  for (const b of boxes) {
    expect(b.y, `avviso fuori dal bordo superiore: ${b.text}`).toBeGreaterThanOrEqual(0);
    expect(b.bottom, `avviso fuori dal bordo inferiore: ${b.text}`).toBeLessThanOrEqual(vh + 1);
  }
});

test('una raffica di avvisi non si accavalla e non straripa dalla finestra', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const vh = await page.evaluate(() => window.innerHeight);

  let maxLive = 0;
  // Dieci azioni di fila, il più rapidamente possibile: dopo ognuna guardiamo
  // com'è messa la pila.
  for (let i = 0; i < 10; i++) {
    await runLinkAction(page, 'Copia URL', { exclude: 'immagine' });
    const boxes = await overlayBoxes(page);
    maxLive = Math.max(maxLive, boxes.length);
    expect(firstOverlap(boxes), `gli avvisi si intersecano al giro ${i + 1}`).toBeNull();
    for (const b of boxes) {
      expect(b.y, `avviso sopra il bordo della finestra al giro ${i + 1}`).toBeGreaterThanOrEqual(0);
      expect(b.bottom, `avviso sotto il bordo della finestra al giro ${i + 1}`)
        .toBeLessThanOrEqual(vh + 1);
    }
  }
  await shot(page, 'toast-stack-409-raffica');

  expect(maxLive, 'la raffica non ha prodotto avvisi').toBeGreaterThan(1);
  // Tetto: 4 vivi + al massimo uno in dissolvenza.
  expect(maxLive, 'la pila di avvisi cresce senza tetto').toBeLessThanOrEqual(5);
});

test('la conferma cliccabile di "Salva per dopo" sta nella pila con gli avvisi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // "Salva per dopo" mostra una conferma cliccabile ancorata allo STESSO angolo
  // dei toast: prima si sovrapponeva a qualunque avviso arrivasse nel frattempo.
  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  const saveBtn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();
  await expect(page.locator('.sn-save-confirm')).toBeVisible({ timeout: 5000 });

  // Mentre la conferma è ancora sullo schermo, un avviso normale.
  await runLinkAction(page, 'Copia URL', { exclude: 'immagine' });

  const boxes = await overlayBoxes(page);
  expect(boxes.length, 'la conferma e l\'avviso non sono entrambi presenti').toBe(2);
  await shot(page, 'toast-stack-409-conferma');
  expect(firstOverlap(boxes), 'la conferma e l\'avviso si coprono a vicenda').toBeNull();

  // La conferma resta cliccabile: è l'unica strada verso la lista.
  await expect(page.locator('.sn-save-confirm')).toBeVisible();
  const clickable = await page.evaluate(() => {
    const el = document.querySelector('.sn-save-confirm');
    return el ? getComputedStyle(el).pointerEvents : null;
  });
  expect(clickable, 'la conferma non riceve più i click').not.toBe('none');
});
