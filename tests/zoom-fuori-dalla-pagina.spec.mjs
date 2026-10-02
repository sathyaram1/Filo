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
import { createServer } from 'node:http';

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

// Una pagina per test: openTab restituisce la prima scheda con lo stesso host.
const PIENO = 'border:0;width:100vw;height:100vh;display:block';
const editorInComponente = (modo) => `<!doctype html><html><head>
  <meta http-equiv="Content-Security-Policy" content="script-src 'nonce-n1'"></head><body style="margin:0"><div id="h"></div>
  <script nonce="n1">
    const r = document.getElementById('h').attachShadow({ mode: '${modo}' });
    const f = document.createElement('iframe'); f.style.cssText = '${PIENO}'; r.appendChild(f);
    const d = f.contentDocument; d.open();
    d.write('<body style="margin:0;height:3000px"><h2 contenteditable>scrivi qui</h2></body>'); d.close();
  </script></body></html>`;
const casiRiquadro = {
  'srcdoc': () => `<!doctype html><html><body style="margin:0"><iframe srcdoc="<div style='height:3000px'>contenuto</div>" style="${PIENO}"></iframe></body></html>`,
  'di un altro sito con un riquadro dentro': (s) => {
    const interno = s.html(`<!doctype html><html><body style="margin:0;height:3000px"><h2 style="margin:0">contenuto</h2></body></html>`);
    const esterno = s.html(`<!doctype html><html><body style="margin:0"><iframe src="${interno}" style="${PIENO}"></iframe></body></html>`).replace('127.0.0.1', 'localhost');
    return `<!doctype html><html><body style="margin:0"><iframe src="${esterno}" style="${PIENO}"></iframe></body></html>`;
  },
  // Editor di testo ricco costruito dentro un componente della pagina (shadow DOM).
  // I gesti cadono fuori dal testo: su Linux nel testo la rotella premuta incolla.
  'riempito dalla pagina dentro un componente aperto': () => editorInComponente('open'),
  'riempito dalla pagina dentro un componente chiuso': () => editorInComponente('closed'),
  'riempito dalla pagina dentro un componente chiuso, in un riquadro di un altro sito': (s) =>
    `<!doctype html><html><body style="margin:0"><iframe src="${s.html(editorInComponente('closed')).replace('127.0.0.1', 'localhost')}" style="${PIENO}"></iframe></body></html>`,
};
for (const [nome, html] of Object.entries(casiRiquadro)) {
  test(`riquadro ${nome}: pizzico e rotella premuta rispondono, e un gesto vale una volta sola`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, html(testServer));
    await page.waitForTimeout(1000);
    await page.mouse.click(300, 300);
    await gestiDelMouse(app, page);
  });
}

// Chromium segnala il Ctrl+rotella anche quando Filo l'ha già preso: uno scatto
// deve valere un passo solo, e quello che nessuno prende deve valere lo stesso.
const scatto = (verso) => ({ type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: 120 * verso, wheelTicksY: verso, canScroll: true, modifiers: ['control'] });
const casiScatto = {
  'una pagina qualunque': () => PAGINA,
  'il contenuto in un riquadro di un altro sito': (s) => `<!doctype html><html><body style="margin:0">
    <iframe src="${s.html(`<!doctype html><html><body style="margin:0;height:3000px">contenuto</body></html>`).replace('127.0.0.1', 'localhost')}"
      style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`,
  'un documento riscritto che si prende la rotella prima di Filo': () => PAGINA,
};
for (const [nome, html] of Object.entries(casiScatto)) {
  test(`uno scatto di Ctrl+rotella vale un passo solo: ${nome}`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, html(testServer));
    if (nome.startsWith('un documento riscritto')) {
      await page.evaluate(() => {
        document.open();
        document.write('<!doctype html><html><body style="height:4000px"><scr' + 'ipt>window.addEventListener("wheel", e => e.stopImmediatePropagation(), { capture: true, passive: false });</scr' + 'ipt><h1>riscritta</h1></body></html>');
        document.close();
      });
    }
    await page.waitForTimeout(800);
    await page.mouse.click(300, 300);
    for (const [verso, min, max] of [[1, 101, 115], [-1, 86, 99]]) {
      await premi(app, page, '0');
      await expect.poll(async () => percentOf(app, page)).toBe(100);
      await manda(app, page, [scatto(verso)]);
      await page.waitForTimeout(700);
      const p = await percentOf(app, page);
      expect(p, `uno scatto ${verso > 0 ? 'in su' : 'in giù'}`).toBeGreaterThanOrEqual(min);
      expect(p, `uno scatto ${verso > 0 ? 'in su' : 'in giù'}`).toBeLessThanOrEqual(max);
    }
  });
}

// Il riquadro con la percentuale sta nel documento: dove la pagina non lo sa
// disegnare o lo rende intoccabile, la rotella premuta apriva una modalità che
// non si vedeva (frameset, immagine SVG, dialogo modale; #686.1 giro 5).
const clicIn = (x, y, button = 'left') => [
  { type: 'mouseDown', x, y, button, clickCount: 1 },
  { type: 'mouseUp', x, y, button, clickCount: 1 },
];
async function battiNelCampo(page, testo) {
  await page.locator('#__filo-zoom-percent').click();
  await page.keyboard.type(testo);
  await page.keyboard.press('Enter');
}

test('pagina a frame: la rotella premuta su un frame mostra il riquadro, e il numero battuto vale', async ({ app, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>indice</h2></body></html>');
  const b = testServer.html('<!doctype html><html><body style="margin:0;height:3000px"><h2>contenuto</h2></body></html>');
  const page = await openTab(testServer.html(`<html><frameset cols="70%,*"><frame src="${a}"><frame src="${b}"></frameset></html>`));
  await page.waitForTimeout(1500);
  await manda(app, page, clicIn(300, 300));
  await manda(app, page, clicIn(300, 300, 'middle'));
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await battiNelCampo(page, '130');
  await expect.poll(async () => percentOf(app, page)).toBe(130);
});

test('immagine SVG aperta da sola: la rotella premuta mostra il riquadro, e il numero battuto vale', async ({ app, openTab }) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="3000"><rect x="10" y="10" width="400" height="300" fill="#c96"/></svg>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const page = await openTab(`http://127.0.0.1:${server.address().port}/logo.svg`);
    await page.waitForTimeout(1500);
    await manda(app, page, clicIn(300, 300, 'middle'));
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    await battiNelCampo(page, '130');
    await expect.poll(async () => percentOf(app, page)).toBe(130);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});

test('con un dialogo modale aperto il riquadro si tocca, anche se il dialogo si apre a riquadro già aperto', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(`<!doctype html><html><body style="height:4000px"><h1>sito</h1>
    <dialog id="d"><p>Accetti i cookie?</p><button>Accetta</button></dialog>
    <script>document.getElementById('d').showModal();</script></body></html>`));
  await page.waitForTimeout(1500);
  await manda(app, page, clicIn(150, 600, 'middle'));
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await battiNelCampo(page, '150');
  await expect.poll(async () => percentOf(app, page)).toBe(150);
  expect(await modalita(page), 'confermare il numero non chiude la modalità').toBe('1');

  // Il dialogo si chiude e se ne apre un altro mentre la modalità è aperta: al
  // primo scatto di rotella il riquadro lo segue.
  await page.evaluate(() => {
    document.getElementById('d').close();
    const n = document.createElement('dialog');
    n.innerHTML = '<p>Iscriviti</p>';
    document.body.appendChild(n);
    n.showModal();
  });
  await manda(app, page, [rotella]);
  await expect.poll(async () => percentOf(app, page)).not.toBe(150);
  await battiNelCampo(page, '120');
  await expect.poll(async () => percentOf(app, page)).toBe(120);
});

// Un clic vero dove si vede il numero vale per il numero, anche quando la pagina
// ha reso intoccabile il riquadro: un dialogo modale dentro un componente, o
// aperto dopo il riquadro (un banner dei cookie in ritardo). #686.1 giro 6.
const cifra = (k) => [{ type: 'keyDown', keyCode: k }, { type: 'char', keyCode: k }, { type: 'keyUp', keyCode: k }];
async function clicSulNumeroE(app, page, numero) {
  const b = await page.locator('#__filo-zoom-percent').boundingBox();
  expect(b, 'il riquadro dello zoom non c\'è').not.toBeNull();
  const z = (await percentOf(app, page)) / 100; // il riquadro misura in pixel della pagina, il clic in quelli della finestra
  await manda(app, page, clicIn(Math.round((b.x + b.width / 2) * z), Math.round((b.y + b.height / 2) * z)));
  for (const k of String(numero)) await manda(app, page, cifra(k));
  await manda(app, page, [{ type: 'keyDown', keyCode: 'Enter' }, { type: 'keyUp', keyCode: 'Enter' }]);
  await expect.poll(async () => percentOf(app, page)).toBe(numero);
}

for (const modo of ['open', 'closed']) {
  test(`dialogo modale dentro un componente ${modo === 'open' ? 'aperto' : 'chiuso'}: il numero battuto nel riquadro vale`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>sito</h1><div id="h"></div>
      <script>const r = document.getElementById('h').attachShadow({ mode: '${modo}' });
      r.innerHTML = '<dialog id="d"><p>Accetti i cookie?</p><button>Accetta</button></dialog>';
      r.getElementById('d').showModal();</script></body></html>`);
    await page.waitForTimeout(800);
    await manda(app, page, clicIn(150, 600, 'middle'));
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    await clicSulNumeroE(app, page, 130);
    expect(await modalita(page), 'confermare il numero non chiude la modalità').toBe('1');
    // Uno scatto di rotella e un altro numero: il riquadro resta suo.
    await manda(app, page, [rotella]);
    await expect.poll(async () => percentOf(app, page)).not.toBe(130);
    await clicSulNumeroE(app, page, 150);
  });
}

test('dialogo modale che si apre dopo il riquadro: il numero battuto vale anche senza girare la rotella', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>sito</h1>
    <dialog id="d"><p>Accetti i cookie?</p><button>Accetta</button></dialog></body></html>`);
  await manda(app, page, clicIn(150, 600, 'middle'));
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.evaluate(() => document.getElementById('d').showModal());
  await page.waitForTimeout(300);
  await clicSulNumeroE(app, page, 130);
});

test('il riquadro dello zoom non vela la pagina su un sito che dà uno sfondo ai livelli in primo piano', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head>
    <style>::backdrop { background: rgba(0,0,0,.6) !important; backdrop-filter: blur(6px) !important; }</style></head>
    <body style="height:4000px"><h1>un sito qualunque</h1><p>testo da leggere</p></body></html>`);
  const velo = () => page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('__filo-zoom-badge'), '::backdrop');
    return `${s.backgroundColor} ${s.backdropFilter}`;
  });
  // Due volte: la regola se ne va all'uscita e torna all'ingresso.
  for (let i = 0; i < 2; i++) {
    await manda(app, page, clicIn(150, 600, 'middle'));
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    expect(await velo(), 'la pagina si scurisce o si sfoca').toBe('rgba(0, 0, 0, 0) none');
    await page.keyboard.press('Escape');
    await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
  }
});

// Il riquadro con la percentuale sta nel documento, ma la pagina non ne decide
// il fuoco, il posto in cima né lo stile del testo (#686.1 giro 7).
const INPUT_CHE_PRENDE_IL_FUOCO = `<!doctype html><html><body style="margin:0"><input id="i">
  <script>addEventListener('message', () => document.getElementById('i').focus());</script></body></html>`;
const SITO_CHE_RUBA_IL_FUOCO = (src) => `<!doctype html><html><body style="height:4000px"><h1>un sito</h1>
  <iframe id="f" src="${src}" style="width:300px;height:80px"></iframe><script>
  addEventListener('focusin', (e) => {
    if (e.target.id !== '__filo-zoom-percent') return;
    setTimeout(() => { const f = document.getElementById('f'); f.contentWindow.focus(); f.contentWindow.postMessage('fuoco', '*'); }, 0);
  }, true);
  </script></body></html>`;
// Un riquadro di un altro sito il fuoco non se lo prende senza un gesto: lì Chromium basta.
for (const [nome, tastiDelSistema] of [
  ['', true],
  [', coi tasti consegnati al riquadro', false],
]) {
  test(`il sito porta il fuoco in un suo riquadro mentre si batte il numero${nome}: vale il numero battuto`, async ({ app, openTab, testServer }) => {
    const src = testServer.html(INPUT_CHE_PRENDE_IL_FUOCO);
    const page = await testServer.openReady(openTab, SITO_CHE_RUBA_IL_FUOCO(src));
    await page.waitForTimeout(800);
    await manda(app, page, clicIn(600, 400, 'middle'));
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    if (tastiDelSistema) {
      await clicSulNumeroE(app, page, 150);
    } else {
      await page.locator('#__filo-zoom-percent').click();
      await page.waitForTimeout(300);
      await page.keyboard.type('150');
      await page.keyboard.press('Enter');
      await expect.poll(async () => percentOf(app, page)).toBe(150);
    }
    const riquadro = page.frames().find((f) => f !== page.mainFrame());
    expect(await riquadro.evaluate(() => document.getElementById('i').value), 'le cifre finiscono nel campo del sito').toBe('');
  });
}

// Una notifica che non prende i clic (pointer-events: none) copre lo stesso.
for (const [nome, stileNotifica] of [
  ['', ''],
  [' anche se non prende i clic', 'pointer-events:none;'],
]) {
  test(`una notifica del sito che arriva col riquadro aperto non lo copre${nome}, e il numero battuto vale`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>sito con notifiche</h1>
      <div id="t" popover="manual" style="${stileNotifica}position:fixed;inset:auto;top:8px;right:8px;margin:0;width:320px;padding:16px;background:#335;color:#fff">Nuovo messaggio</div></body></html>`);
    await manda(app, page, clicIn(600, 500, 'middle'));
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    // Nessun gesto dopo la notifica: il riquadro torna sopra da solo.
    await page.evaluate(() => document.getElementById('t').showPopover());
    await expect.poll(() => page.evaluate(() => {
      const b = document.getElementById('__filo-zoom-badge');
      const t = document.getElementById('t');
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      // Il punto si chiede con la notifica che prende i clic: così si vede chi sta sopra.
      const prima = t.style.pointerEvents;
      t.style.pointerEvents = 'auto';
      const sopra = document.elementFromPoint(x, y);
      t.style.pointerEvents = prima;
      return !!(sopra && b.contains(sopra));
    }), { message: 'al posto del riquadro si vede la notifica del sito', timeout: 2000 }).toBe(true);
    await clicSulNumeroE(app, page, 130);
  });
}

for (const [nome, regola, dialogo] of [
  ['dentro un dialogo modale', 'dialog', true],
  ['sotto la radice della pagina', 'html', false],
]) {
  test(`il riquadro non prende lo stile del testo del sito ${nome}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><style>
      ${regola} { text-transform: uppercase; letter-spacing: 3px; text-shadow: 0 0 2px red; }
    </style></head><body style="height:4000px"><h1>sito</h1>${dialogo ? '<dialog id="d"><p>Accetti i cookie?</p><button>Sì</button></dialog><script>document.getElementById("d").showModal();</script>' : ''}</body></html>`);
    await page.mouse.click(600, 700, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    const stile = (sel) => page.evaluate((s) => {
      const c = getComputedStyle(document.querySelector(s));
      return `${c.textTransform} ${c.letterSpacing} ${c.textShadow}`;
    }, sel);
    expect(await stile('#__filo-zoom-badge')).toBe('none normal none');
    expect(await stile('#__filo-zoom-percent')).toBe('none normal none');
    await page.screenshot({ path: `tests/.shots/zoom-riquadro-stile-${regola}.png` });
  });
}

// Fuori da Mac e Windows il clic centrale in un campo incolla la selezione del
// sistema: la rotella premuta lì resta del sistema, anche dentro i riquadri (#686.1 giro 8).
const MODULO = '<p id=s style="font:20px sans-serif;margin:0;padding:10px">ciaomondo</p>'
  + '<textarea id=t style="position:absolute;left:0;top:100px;width:400px;height:200px"></textarea>'
  + '<textarea id=ro readonly style="position:absolute;left:0;top:320px;width:400px;height:100px"></textarea>';

for (const [nome, dove] of [['nella pagina', 'pagina'], ['in un riquadro di un altro sito', 'riquadro']]) {
  test(`Linux: il clic centrale in un campo di testo ${nome} incolla la selezione, fuori dai campi apre lo zoom`, async ({ openTab, testServer }) => {
    test.skip(process.platform === 'win32' || process.platform === 'darwin', 'la selezione primaria non c\'è su Mac e Windows');
    let page; let doc;
    if (dove === 'pagina') {
      page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">${MODULO}</body></html>`);
      doc = page.locator('html');
    } else {
      const dentro = testServer.html(`<!doctype html><html><body style="margin:0">${MODULO}</body></html>`).replace('127.0.0.1', 'localhost');
      page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
        <iframe id=f src="${dentro}" style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>`);
      doc = page.frameLocator('#f').locator('html');
    }
    await expect(doc.locator('#s')).toBeVisible();
    await page.mouse.dblclick(40, 22);
    await page.mouse.click(100, 200, { button: 'middle' });
    await expect.poll(() => doc.locator('#t').inputValue()).toBe('ciaomondo');
    await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);

    // Dove non si scrive, la rotella premuta apre lo zoom; a modalità aperta, nel campo la chiude.
    await page.mouse.click(100, 360, { button: 'middle' });
    await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
    expect(await doc.locator('#t').inputValue(), 'il clic centrale preso dallo zoom incolla nel campo che ha il fuoco').toBe('ciaomondo');
    await page.mouse.click(100, 200, { button: 'middle' });
    await page.waitForTimeout(300);
    await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
    expect(await doc.locator('#t').inputValue()).toBe('ciaomondo');
  });
}

test('Linux: il clic centrale nell\'editor che la pagina riempie in un riquadro incolla la selezione', async ({ openTab, testServer }) => {
  test.skip(process.platform === 'win32' || process.platform === 'darwin', 'la selezione primaria non c\'è su Mac e Windows');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <p id=s style="font:20px sans-serif;margin:0;padding:10px">ciaomondo</p>
    <iframe id=ed style="border:0;position:absolute;left:0;top:100px;width:400px;height:200px"></iframe>
    <script>const d = document.getElementById('ed').contentDocument; d.open(); d.write('<!doctype html><html><body style="margin:0;height:200px"></body></html>'); d.close(); d.designMode = 'on';</script>
    </body></html>`);
  await page.mouse.move(100, 200);
  await page.mouse.dblclick(40, 22);
  await page.mouse.click(100, 200, { button: 'middle' });
  await expect.poll(() => page.evaluate(() => document.getElementById('ed').contentDocument.body.textContent)).toContain('ciaomondo');
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
});

// Il clic centrale guarda tutto il percorso dell'evento: dentro un componente
// aperto della pagina il bersaglio è solo il guscio, e il link si apriva insieme
// alla modalità dello zoom (#686.1 giro 9).
const urlAperti = (app) => app.evaluate(({ webContents }) =>
  webContents.getAllWebContents().map((w) => { try { return w.getURL(); } catch (_) { return ''; } }));
for (const [nome, dove] of [['nella pagina', 'pagina'], ['in un riquadro di un altro sito', 'riquadro']]) {
  test(`clic centrale su un link dentro un componente ${nome}: si apre il link e basta`, async ({ app, openTab, testServer }) => {
    const meta = testServer.html('<!doctype html><html><body><h1>arrivato</h1></body></html>');
    const link = `<a href="${meta}" style="display:block;font:30px sans-serif;padding:20px;background:#eee">apri questo articolo</a>`;
    const docHtml = `<!doctype html><html><body style="margin:0;padding-top:250px"><div id=host></div>
      <script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(link)};</script></body></html>`;
    let page;
    if (dove === 'pagina') page = await testServer.openReady(openTab, docHtml);
    else {
      page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
        <iframe id=f src="${testServer.html(docHtml).replace('127.0.0.1', 'localhost')}" style="${PIENO}"></iframe></body></html>`);
      await expect(page.frameLocator('#f').locator('#host')).toBeAttached();
      await page.waitForTimeout(500);
    }
    const prima = (await urlAperti(app)).filter((u) => u === meta).length;
    await page.mouse.move(100, 285);
    await page.mouse.click(100, 285, { button: 'middle' });
    await expect.poll(async () => (await urlAperti(app)).filter((u) => u === meta).length, { timeout: 5000 }).toBeGreaterThan(prima);
    await page.waitForTimeout(400);
    await expect(page.locator('#__filo-zoom-badge'), 'col link si è aperta anche la modalità dello zoom').toHaveCount(0);
  });
}

// Un riquadro che la pagina riempie da sé passa gesti, come ogni riquadro: un
// punto del suo documento misurato contro il riquadro dello zoom cadeva sul
// numero, e il testo battuto nell'editor cambiava lo zoom (#686.1 giro 9).
test('a modalità aperta, un clic nella prima riga dell\'editor riempito dalla pagina chiude lo zoom, e il testo va nell\'editor', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:2000px">
    <h1 style="margin:0;height:300px">sopra</h1>
    <iframe id=ed style="border:0;position:absolute;left:0;top:300px;width:100vw;height:300px"></iframe>
    <script>const d = document.getElementById('ed').contentDocument; d.open(); d.write('<!doctype html><html><body style="margin:0;height:300px;font:16px sans-serif"><p>prima riga</p></body></html>'); d.close(); d.designMode = 'on';</script>
    </body></html>`);
  await page.mouse.move(400, 450);
  await page.mouse.click(400, 150, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  const box = await page.locator('#__filo-zoom-percent').boundingBox();
  // Lo stesso punto del numero, ma dentro l'editor: 300 px più in basso.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 300);
  await expect(page.locator('#__filo-zoom-badge'), 'il clic nell\'editor non chiude la modalità').toHaveCount(0);
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  expect(await percentOf(app, page), 'il testo battuto nell\'editor ha cambiato lo zoom').toBe(100);
  expect(await page.evaluate(() => document.getElementById('ed').contentDocument.body.textContent)).toContain('30');
});

test('a modalità aperta, il clic che la chiude su un campo della pagina ci mette anche il cursore', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:2000px">
    <textarea id=t style="position:absolute;left:0;top:300px;width:400px;height:100px"></textarea></body></html>`);
  await page.mouse.click(600, 150, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await page.mouse.click(100, 350);
  await expect(page.locator('#__filo-zoom-badge')).toHaveCount(0);
  await page.keyboard.type('30');
  await expect(page.locator('#t')).toHaveValue('30');
  expect(await percentOf(app, page)).toBe(100);
});
