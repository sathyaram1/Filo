// Modalità zoom con la rotella, attivata dal click centrale.
//
// FEEDBACK (alpha): il click centrale faceva partire l'autoscroll nativo di
// Chromium (scomodo). Ora un click sulla rotella attiva una "modalità zoom" in
// cui la rotella zooma/dezooma la pagina invece di scrollarla; un altro click
// (o Esc) la disattiva.
//
// Cosa asserisce (successo della feature, non assenza di errore):
//   - dopo il click centrale la pagina entra in modalità zoom (marker DOM +
//     badge visibile);
//   - in modalità zoom la rotella cambia lo zoom della pagina e NON scrolla;
//   - un secondo click centrale esce dalla modalità e la rotella torna a
//     scrollare.
//
// Pre-condizione che senza il fix fallirebbe: prima non esisteva alcuna
// modalità zoom — il click centrale non impostava filoZoomMode e la rotella
// scrollava sempre.

import { test, expect } from './fixtures/electron.mjs';

const TALL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>tall</title>
<style>html,body{margin:0} #spacer{height:5000px;background:linear-gradient(#fff,#eee)}</style>
</head><body><div id="spacer">contenuto alto per scrollare</div></body></html>`;

async function zoomFactorOf(app, hostNeedle) {
  return app.evaluate(({ webContents }, needle) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes(needle)) return wc.getZoomFactor();
    }
    return null;
  }, hostNeedle);
}

test('rotella: il click centrale attiva la modalità zoom, la rotella zooma e non scrolla', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);

  // Fuori dalla modalità zoom: nessun marker.
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');

  const z0 = await zoomFactorOf(app, '127.0.0.1');
  expect(z0).toBeCloseTo(1, 1);

  // Click centrale su area vuota → entra in modalità zoom.
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('1');
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();

  // In modalità zoom la rotella zooma (non scrolla).
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -300); // su = zoom in
  await page.mouse.wheel(0, -300);

  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(z0 + 0.01);
  const scrollAfterZoom = await page.evaluate(() => window.scrollY);
  expect(scrollAfterZoom).toBe(scrollBefore); // non ha scrollato

  // Secondo click centrale → esce dalla modalità zoom.
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);

  // Fuori dalla modalità, la rotella torna a scrollare.
  const zAfterExit = await zoomFactorOf(app, '127.0.0.1');
  await page.mouse.wheel(0, 300); // giù = scroll
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // ...e NON ha più cambiato lo zoom.
  expect(await zoomFactorOf(app, '127.0.0.1')).toBeCloseTo(zAfterExit, 2);
});

test('rotella: Esc esce dalla modalità zoom', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('1');
  await page.keyboard.press('Escape');
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');
});

// Feedback: "un qualsiasi tasto la chiude". Non solo Esc: anche una lettera
// qualunque deve uscire dalla modalità zoom.
test('rotella: un tasto qualsiasi esce dalla modalità zoom', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('1');
  await page.keyboard.press('a');
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');
});

// Feedback: "un qualsiasi tasto la chiude (anche tasto destro/sinistro)".
test('rotella: un click sinistro o destro esce dalla modalità zoom', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);

  // Click sinistro fuori dal badge → esce.
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('1');
  await page.mouse.click(300, 300, { button: 'left' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');

  // Click destro fuori dal badge → esce.
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('1');
  await page.mouse.click(300, 300, { button: 'right' });
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('');
});

// Feedback: il badge in alto dice "zoom <percentuale>%, rotella per zoomare",
// senza emoji e senza menzione di Esc.
test('rotella: il badge mostra "zoom %, rotella per zoomare" senza emoji né Esc', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.mouse.click(200, 200, { button: 'middle' });
  const badge = page.locator('#__filo-zoom-badge');
  await expect(badge).toBeVisible();

  const text = await badge.innerText();
  expect(text).toMatch(/zoom/i);
  expect(text).toMatch(/rotella per zoomare/i);
  expect(text).not.toMatch(/Esc/i);
  expect(text).not.toMatch(/🔍/);

  // Il campo percentuale esiste, è editabile e mostra 100 all'avvio.
  const percent = page.locator('#__filo-zoom-percent');
  await expect(percent).toBeVisible();
  await expect(percent).toHaveValue('100');
  const editable = await percent.evaluate((el) => !el.disabled && !el.readOnly);
  expect(editable).toBe(true);
});

// Feedback: "rendi editabile il campo della percentuale". Digitare un valore e
// premere Invio imposta lo zoom; editare il campo NON chiude la modalità.
test('rotella: digitare la percentuale imposta lo zoom', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  await page.mouse.click(200, 200, { button: 'middle' });
  const percent = page.locator('#__filo-zoom-percent');
  await expect(percent).toBeVisible();

  // Si batte davvero: il numero del campo lo scrivono solo i tasti (#686.1).
  await percent.click();
  await page.keyboard.type('150');
  await page.keyboard.press('Enter');

  // Lo zoom della pagina è cambiato a ~150% e la modalità è ancora attiva
  // (editare il campo non la chiude).
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(1.4);
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.dataset.filoZoomMode || '')
  ).toBe('1');
});

// Il riquadro è di Filo, non della pagina: sullo schermo resta della stessa misura e allo stesso
// posto a qualunque zoom (al 300% copriva il titolo, al 33% non si leggeva; #686.1 giro 10).
test('rotella: il riquadro ha la stessa misura sullo schermo a qualunque zoom, e il numero si batte lo stesso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, TALL_PAGE);
  const zoomA = (livello) => app.evaluate(({ webContents }, livello) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('127.0.0.1')) wc.setZoomLevel(livello);
    }
  }, livello);
  const misura = () => page.locator('#__filo-zoom-badge').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { alto: r.height * devicePixelRatio, margine: (innerWidth - r.right) * devicePixelRatio };
  });
  const badge = page.locator('#__filo-zoom-badge');

  await page.mouse.click(200, 200, { button: 'middle' });
  await expect(badge).toBeVisible();
  const base = await misura();
  await page.mouse.click(200, 200, { button: 'middle' });

  const livelli = { '300%': Math.log(3) / Math.log(1.2), '33%': Math.log(1 / 3) / Math.log(1.2) };
  for (const [nome, livello] of Object.entries(livelli)) {
    await zoomA(livello);
    await page.mouse.click(200, 200, { button: 'middle' });
    await expect(badge).toBeVisible();
    const m = await misura();
    expect(m.alto / base.alto, `altezza al ${nome}`).toBeGreaterThan(0.9);
    expect(m.alto / base.alto, `altezza al ${nome}`).toBeLessThan(1.1);
    expect(Math.abs(m.margine - base.margine), `distanza dal bordo al ${nome}`).toBeLessThan(3);
    await page.mouse.click(200, 200, { button: 'middle' });
    await expect(badge).toHaveCount(0);
  }

  // Lo zoom cambiato dalla rotella a riquadro aperto: il riquadro lo segue subito.
  await zoomA(0);
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect(badge).toBeVisible();
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100);
  await expect.poll(async () => zoomFactorOf(app, '127.0.0.1')).toBeGreaterThan(1.5);
  await expect.poll(async () => (await misura()).alto / base.alto).toBeLessThan(1.1);

  // Al 300% il clic sul numero apre ancora la modifica, e il numero battuto vale.
  await zoomA(livelli['300%']);
  await page.locator('#__filo-zoom-percent').click();
  await page.keyboard.type('120');
  await page.keyboard.press('Enter');
  await expect.poll(async () => Math.round((await zoomFactorOf(app, '127.0.0.1')) * 100)).toBe(120);
});
