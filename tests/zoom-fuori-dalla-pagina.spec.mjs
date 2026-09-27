// #686.1 — LO ZOOM È DELL'UTENTE ANCHE QUANDO IL SITO CI METTE LE MANI.
//
// Tre porte per cui un sito si riprendeva lo zoom o ne spegneva i gesti, tutte
// dalla stessa causa (gesti e campo della percentuale stavano solo dentro la
// pagina): il campo del riquadro scritto col comando di inserimento testo del
// browser, un documento riscritto da capo, il contenuto dentro un riquadro
// incorporato. Qui si fa quello che fa l'utente e si guarda la misura vera
// della scheda. Senza il fix: 25% invece di 200%, e tasti, Ctrl+rotella e
// clic centrale morti sulle ultime due.

import { test, expect } from './fixtures/electron.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>sito</title></head>
<body style="height:4000px"><h1>un sito qualunque</h1><p>testo</p></body></html>`;

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

// I tasti come li manda il sistema: passano da dove passano quelli veri, prima
// della pagina e di qualunque riquadro (Playwright li consegna al documento).
async function premi(app, page, keyCode) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, { u, keyCode }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
    }
  }, { u: url, keyCode });
}

const modalita = (page) => page.evaluate(() => document.documentElement.dataset.filoZoomMode || '');

test('il sito scrive nel campo col comando di inserimento testo ed esce: lo zoom resta quello dell\'utente', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 200 });
  await expect.poll(async () => percentOf(app, page)).toBe(200);
  await page.mouse.click(200, 200, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();

  const dopo = await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    i.focus();
    i.select();
    document.execCommand('insertText', false, '25');
    i.blur();
    return i.value;
  });
  await page.waitForTimeout(300);
  expect(await percentOf(app, page)).toBe(200);
  expect(dopo, 'il campo non deve mostrare un numero che non vale').toBe('200');

  // Anche mentre l'utente sta battendo: il sito inserisce e gli toglie il
  // fuoco a metà numero. Non vale niente di suo, e l'utente finisce il numero.
  await page.locator('#__filo-zoom-percent').click();
  await page.keyboard.type('1');
  await page.evaluate(() => {
    const i = document.getElementById('__filo-zoom-percent');
    document.execCommand('insertText', false, '25');
    i.blur();
  });
  await page.waitForTimeout(300);
  expect(await percentOf(app, page)).toBe(200);
  expect(await modalita(page)).toBe('1');
  await page.keyboard.type('50');
  await page.keyboard.press('Enter');
  await expect.poll(async () => percentOf(app, page)).toBe(150);
  await expect(page.locator('#__filo-zoom-percent')).toHaveValue('150');
  expect(await modalita(page), 'confermare il numero non chiude la modalità').toBe('1');

  // Esc dentro il campo annulla quello che si stava battendo.
  await page.locator('#__filo-zoom-percent').click();
  await page.keyboard.type('300');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(await percentOf(app, page)).toBe(150);
  await expect(page.locator('#__filo-zoom-percent')).toHaveValue('150');

  // Un numero battuto e lasciato lì vale quando si esce con un clic.
  await page.locator('#__filo-zoom-percent').click();
  await page.keyboard.type('80');
  await page.mouse.click(300, 400);
  await expect.poll(async () => percentOf(app, page)).toBe(80);
  expect(await modalita(page)).toBe('');
});

test('un sito che riscrive il proprio documento non spegne i gesti dello zoom', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.evaluate(() => {
    document.open();
    document.write('<!doctype html><html><body style="height:4000px"><h1 id=t>riscritta</h1><p>testo</p></body></html>');
    document.close();
  });
  await page.locator('#t').click();

  await premi(app, page, '=');
  await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
  await premi(app, page, '0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);
  await premi(app, page, '-');
  await expect.poll(async () => percentOf(app, page)).toBeLessThan(100);
  await premi(app, page, '0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);

  await page.mouse.move(300, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll, 'Ctrl+rotella zooma, non scorre').toBe(0);
  await premi(app, page, '0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);

  // Il clic centrale apre il riquadro, e lì la rotella zooma.
  await page.mouse.click(300, 300, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
  await page.mouse.click(300, 300);
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);

  // Riscritta una seconda volta, a modalità aperta: il riquadro vecchio se ne
  // va col documento, e il clic centrale ne apre uno nuovo.
  await page.mouse.click(300, 300, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.evaluate(() => {
    document.open();
    document.write('<!doctype html><html><body style="height:4000px"><h1 id=t>di nuovo</h1></body></html>');
    document.close();
  });
  await page.mouse.click(300, 300, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.keyboard.press('a');
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
});

for (const [nome, stessoSito] of [['di un altro sito', false], ['dello stesso sito', true]]) {
  test(`contenuto in un riquadro incorporato ${nome}: dopo un clic lì dentro lo zoom risponde`, async ({ app, openTab, testServer }) => {
    const dentro = testServer.html(`<!doctype html><html><body style="margin:0;height:3000px">
      <h2 id="c">il contenuto vero</h2><a id="l" href="#x">un link</a></body></html>`);
    const src = stessoSito ? dentro : dentro.replace('127.0.0.1', 'localhost');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
      <iframe id="f" src="${src}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
    const frame = page.frameLocator('#f');
    await expect(frame.locator('#c')).toBeVisible();
    await frame.locator('#c').click();

    await premi(app, page, '=');
    await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
    await premi(app, page, '0');
    await expect.poll(async () => percentOf(app, page)).toBe(100);

    await page.mouse.move(300, 300);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
    await premi(app, page, '0');
    await expect.poll(async () => percentOf(app, page)).toBe(100);

    // Il clic centrale sul contenuto apre il riquadro della scheda; la rotella
    // sul contenuto zooma invece di scorrerlo; un clic lì dentro chiude.
    await page.mouse.click(300, 300, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => percentOf(app, page)).toBeGreaterThan(100);
    const scorso = await frame.locator('body').evaluate(() => window.scrollY);
    expect(scorso, 'in modalità la rotella non scorre il riquadro').toBe(0);
    await page.mouse.click(300, 300);
    await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
    // Fuori dalla modalità la rotella torna a scorrere.
    await page.mouse.wheel(0, 300);
    await expect.poll(async () => frame.locator('body').evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // Un tasto qualsiasi, premuto col fuoco nel riquadro, chiude la modalità.
    await page.mouse.click(300, 300, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    await page.keyboard.press('a');
    await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);

    // Sul link il clic centrale resta quello del browser.
    await premi(app, page, '0');
    await expect.poll(async () => percentOf(app, page)).toBe(100);
    await frame.locator('#l').scrollIntoViewIfNeeded();
    const box = await frame.locator('#l').boundingBox();
    await page.mouse.click(box.x + 5, box.y + 5, { button: 'middle' });
    await page.waitForTimeout(300);
    await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
  });
}

test('col fuoco nel riquadro, il tasto destro sul contenuto offre la dimensione reale e la rimette', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html(`<!doctype html><html><body style="margin:0"><h2 id="c">contenuto</h2></body></html>`)
    .replace('127.0.0.1', 'localhost');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <iframe id="f" src="${dentro}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
  const frame = page.frameLocator('#f');
  await expect(frame.locator('#c')).toBeVisible();
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await expect.poll(async () => percentOf(app, page)).toBe(150);

  await frame.locator('#c').click({ button: 'right' });
  const voce = frame.locator('.sn-menu').first().getByText(/Dimensione reale \(ora 150%\)/);
  await expect(voce).toBeVisible({ timeout: 8000 });
  await voce.click();
  await expect.poll(async () => percentOf(app, page)).toBe(100);
});

// I gesti del mouse come li manda il sistema (Playwright passa dal protocollo
// di debug, che salta la strada dove il main vede il Ctrl+rotella non preso).
async function manda(app, page, eventi) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, { u, eventi }) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      for (const ev of eventi) wc.sendInputEvent(ev);
    }
  }, { u: url, eventi });
}
const pizzico = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 4, canScroll: true, hasPreciseScrollingDeltas: true, modifiers: ['control'] };
const rotella = { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120, wheelTicksY: 1, canScroll: true, modifiers: [] };
const medio = [
  { type: 'mouseDown', x: 300, y: 300, button: 'middle', clickCount: 1 },
  { type: 'mouseUp', x: 300, y: 300, button: 'middle', clickCount: 1 },
];

async function gestiDelMouse(app, page) {
  for (let i = 0; i < 10; i++) { await manda(app, page, [pizzico]); await page.waitForTimeout(30); }
  await expect.poll(async () => percentOf(app, page), { message: 'il pizzico del trackpad non zooma' }).not.toBe(100);
  expect(Math.abs((await percentOf(app, page)) - 100), 'il pizzico salta invece di scorrere').toBeLessThan(15);
  await premi(app, page, '0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);

  await manda(app, page, medio);
  await expect(page.locator('#__filo-zoom-badge'), 'la rotella premuta non apre il riquadro').toBeVisible();
  await manda(app, page, [rotella]);
  await expect.poll(async () => percentOf(app, page)).not.toBe(100);
  await manda(app, page, medio);
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
  await premi(app, page, '0');
  await expect.poll(async () => percentOf(app, page)).toBe(100);
}

test('riquadro che la pagina riempie da sé (editor di testo ricco): pizzico e rotella premuta rispondono, anche dopo una riscrittura', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <iframe id="f" style="border:0;width:100vw;height:100vh;display:block"></iframe>
    <script>
      window.scrivi = (t) => { const d = document.getElementById('f').contentDocument;
        d.open(); d.write('<!doctype html><html><body contenteditable style="margin:0;height:3000px"><h2>' + t + '</h2>' +
          '<iframe style="border:0;width:100%;height:600px"></iframe></body></html>'); d.close(); };
      scrivi('scrivi qui');
    </script></body></html>`);
  await page.mouse.click(300, 300);
  await gestiDelMouse(app, page);

  // L'editor riscrive il proprio riquadro mentre l'utente ci lavora.
  await page.evaluate(() => window.scrivi('di nuovo'));
  await page.mouse.click(300, 300);
  await gestiDelMouse(app, page);

  // Un riquadro vuoto dentro quello dell'editor, riempito anche lui dalla pagina.
  await page.evaluate(() => {
    const d = document.getElementById('f').contentDocument.querySelector('iframe').contentDocument;
    d.open(); d.write('<!doctype html><html><body style="margin:0;height:3000px">annidato</body></html>'); d.close();
  });
  await page.mouse.move(300, 250);
  await page.mouse.click(300, 300);
  await gestiDelMouse(app, page);
});

test('riquadro srcdoc e riquadro di un altro sito con un riquadro dentro: un gesto vale una volta sola', async ({ app, openTab, testServer }) => {
  const interno = testServer.html(`<!doctype html><html><body style="margin:0;height:3000px"><h2 style="margin:0">contenuto</h2></body></html>`);
  const esterno = testServer.html(`<!doctype html><html><body style="margin:0">
    <iframe src="${interno}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`).replace('127.0.0.1', 'localhost');
  for (const html of [
    `<!doctype html><html><body style="margin:0"><iframe srcdoc="<div style='height:3000px'>contenuto</div>" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
    `<!doctype html><html><body style="margin:0"><iframe src="${esterno}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
  ]) {
    const page = await testServer.openReady(openTab, html);
    await page.waitForTimeout(1000);
    await page.mouse.click(300, 300);
    await gestiDelMouse(app, page);
  }
});
