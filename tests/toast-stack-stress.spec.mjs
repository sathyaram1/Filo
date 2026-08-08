// #409 — stress test avversariale sulla pila degli avvisi in pagina.
//
// Scritto dal sintomo utente ("due avvisi ravvicinati si coprono"), ma provando
// a ROMPERE la pila: casi limite che l'happy path non tocca.
//   1. il menu del tasto destro non deve chiudersi da solo mentre gli avvisi
//      compaiono e scadono (la pila vive nella stessa pagina e un suo scroll
//      chiuderebbe il menu);
//   2. una pagina che rifà il DOM (SPA) non deve far sparire gli avvisi
//      successivi;
//   3. finestra bassissima: gli avvisi restano dentro il viewport e il più
//      recente resta visibile;
//   4. gli avvisi non introducono barre di scorrimento nella pagina ospite.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const PAGE = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
  <h1>Pagina con un collegamento</h1>
  <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
</body></html>`;

const OVERLAY_SEL = '.sn-toast, .sn-save-confirm, .sn-dictate-pill';

async function overlayBoxes(page) {
  return page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((el) => {
    const r = el.getBoundingClientRect();
    return { text: (el.textContent || '').trim(), x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
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

async function runLinkAction(page, label, { exclude = null, settle = 200 } = {}) {
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

test('il menu del tasto destro resta aperto mentre gli avvisi compaiono e scadono', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // Riempiamo la pila, poi apriamo il menu: gli avvisi scadranno mentre il menu
  // è sullo schermo. Se la pila muove il proprio scorrimento, il menu si chiude
  // da solo e l'utente perde il click a metà.
  for (let i = 0; i < 4; i++) await runLinkAction(page, 'Copia URL', { exclude: 'immagine', settle: 60 });

  await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await shot(page, 'toast-stack-409-menu-aperto');

  // 2.5s: tutti gli avvisi vivi scadono in questa finestra.
  await page.waitForTimeout(2600);
  await expect(page.locator('.sn-toast')).toHaveCount(0);
  await expect(menu, 'il menu del tasto destro si è chiuso da solo mentre gli avvisi scadevano').toBeVisible();
});

test('gli avvisi continuano ad apparire dopo che la pagina rifà il proprio DOM', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  await runLinkAction(page, 'Copia URL', { exclude: 'immagine' });
  await expect(page.locator('.sn-toast')).toHaveCount(1);

  // Una SPA che rimpiazza il contenuto può portarsi via il contenitore degli
  // avvisi: i successivi non devono finire nel vuoto.
  await page.evaluate(() => { document.querySelectorAll('.sn-toasts').forEach((n) => n.remove()); });
  await expect(page.locator('.sn-toast')).toHaveCount(0);

  await runLinkAction(page, 'Copia URL', { exclude: 'immagine' });
  await expect(page.locator('.sn-toast'), 'dopo che la pagina ha rifatto il DOM gli avvisi non compaiono più').toHaveCount(1);

  const boxes = await overlayBoxes(page);
  expect(boxes[0].w).toBeGreaterThan(0);
  expect(boxes[0].h).toBeGreaterThan(0);
});

test('finestra bassissima: gli avvisi restano dentro la finestra e il più recente è visibile', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  const restore = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const b = w.getBounds();
    w.setBounds({ ...b, height: 260 });
    return b;
  });

  try {
    await page.waitForTimeout(300);
    for (let i = 0; i < 4; i++) await runLinkAction(page, 'Copia URL', { exclude: 'immagine', settle: 60 });
    await page.waitForTimeout(200);

    const vh = await page.evaluate(() => window.innerHeight);
    const boxes = await overlayBoxes(page);
    await shot(page, 'toast-stack-409-finestra-bassa');
    expect(boxes.length, 'nessun avviso vivo').toBeGreaterThan(0);
    expect(firstOverlap(boxes), 'gli avvisi si intersecano in finestra bassa').toBeNull();
    for (const b of boxes) {
      expect(b.bottom, `avviso oltre il bordo inferiore: ${b.text}`).toBeLessThanOrEqual(vh + 1);
    }
    // Il più recente (ultimo del DOM) deve essere leggibile per intero.
    const last = boxes[boxes.length - 1];
    expect(last.y, 'il più recente esce dal bordo superiore della finestra').toBeGreaterThanOrEqual(0);
  } finally {
    await app.evaluate(async ({ BrowserWindow }, b) => {
      BrowserWindow.getAllWindows()[0].setBounds(b);
    }, restore);
  }
});

test('gli avvisi non aggiungono barre di scorrimento alla pagina ospite', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  const before = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight,
  }));

  for (let i = 0; i < 4; i++) await runLinkAction(page, 'Copia URL', { exclude: 'immagine', settle: 60 });

  const after = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight,
  }));
  expect(after.w, 'gli avvisi allargano la pagina in orizzontale').toBeLessThanOrEqual(before.w);
  expect(after.h, 'gli avvisi allungano la pagina in verticale').toBeLessThanOrEqual(before.h);
});
