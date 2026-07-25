// Verifier stress test — feedback #267 (Ctrl+Z torna indietro).
// Il resolver ha testato solo pagine web esterne (testServer). L'utente però ha
// segnalato dalla pagina interna "Cronologia" (filo://history). Qui verifico:
//   1) navigazione tra pagine INTERNE filo:// con Ctrl+Z;
//   2) guardia su contenteditable (non solo <input>);
//   3) Shift+Ctrl+Z NON naviga (deve restare "ripeti"/redo);
//   4) no back-history: Ctrl+Z sulla prima pagina non crasha, non naviga.
import { test, expect } from './fixtures/electron.mjs';

async function gotoInternalReady(page, url) {
  await page.evaluate((u) => { window.location.href = u; }, url);
  await page.waitForURL((u) => u.href.startsWith(url), { timeout: 10_000 });
  await page.waitForFunction(
    () => document.documentElement.dataset.filoReady === '1',
    null, { timeout: 8_000 },
  );
}

test('Ctrl+Z torna indietro tra pagine INTERNE filo://', async ({ openTab }) => {
  // Apro newtab, poi navigo alla Cronologia: la scheda ha newtab nell'indietro.
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await gotoInternalReady(page, 'filo://history/history.html');
  expect(page.url()).toContain('history');

  // Fuoco fuori da campi di testo.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');

  await page.waitForURL((u) => u.href.startsWith('filo://newtab'), { timeout: 8_000 });
  expect(page.url()).toContain('newtab');
});

test('Ctrl+Z resta undo dentro un contenteditable', async ({ openTab, testServer }) => {
  const A = testServer.html('<!doctype html><title>A</title><h1 id="a">A</h1>');
  const B = testServer.html('<!doctype html><title>B</title><h1 id="b">B</h1>'
    + '<div id="ce" contenteditable="true" style="min-height:40px">edit</div>');
  const page = await testServer.openReady(openTab, '<!doctype html><h1>seed</h1>');
  for (const u of [A, B]) {
    await page.evaluate((x) => { window.location.href = x; }, u);
    await page.waitForURL(u, { timeout: 10_000 });
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  }
  const ce = page.locator('#ce');
  await ce.click();
  await page.keyboard.type('xyz');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  // Non deve aver navigato: siamo ancora su B.
  expect(page.url()).toBe(B);
  await expect(page.locator('#b')).toBeVisible();
});

test('Shift+Ctrl+Z NON naviga (resta redo)', async ({ openTab, testServer }) => {
  const A = testServer.html('<!doctype html><title>A</title><h1 id="a">A</h1>');
  const B = testServer.html('<!doctype html><title>B</title><h1 id="b">B</h1>');
  const page = await testServer.openReady(openTab, '<!doctype html><h1>seed</h1>');
  for (const u of [A, B]) {
    await page.evaluate((x) => { window.location.href = x; }, u);
    await page.waitForURL(u, { timeout: 10_000 });
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  }
  await page.locator('#b').click();
  await page.keyboard.press('Shift+Control+z');
  await page.waitForTimeout(500);
  // Shift+Ctrl+Z è "ripeti": NON deve tornare indietro. Restiamo su B.
  expect(page.url()).toBe(B);
  await expect(page.locator('#b')).toBeVisible();
});

test('Ctrl+Z senza pagina precedente non crasha e non naviga', async ({ openTab, testServer }) => {
  // Scheda FRESCA aperta direttamente sulla pagina: nessuna cronologia indietro.
  const page = await testServer.openReady(openTab,
    '<!doctype html><title>ONLY</title><h1 id="only">unica</h1>');
  const startUrl = page.url();
  await page.locator('#only').click();
  // Premo Ctrl+Z ripetutamente: no-op, la pagina resta viva e reattiva.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  await expect(page.locator('#only')).toBeVisible();
  // La pagina risponde ancora al JS (non è crashata).
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
});
