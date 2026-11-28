// #2374 — Trascrivi lascia la porzione a schermo con sopra il suo testo, selezionabile come in un PDF: si copia solo la
// parola che serve, «Copia tutto» copia tutto, e il tasto destro su un'immagine apre lo stesso riquadro.
// Su un sito il riquadro sta nello strato sopra la scheda: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';
import { paginaDelloStrato, nelMondoDiFilo, nelloStrato } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const W = 600;
const H = 160;
const RIGHE = [['Fattura numero 4821', 20, 56], ['Totale 1250 euro', 20, 126]];
const FONT = '32px sans-serif';

// Un testo noto disegnato dentro un'immagine: le parole non sono nel DOM, solo nei pixel.
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Fattura</title></head>
<body style="margin:0;padding:60px 40px;font:16px sans-serif;background:#eee">
<img id="foto" width="${W}" height="${H}" alt="fattura">
<script>
  const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${W}, ${H});
  g.fillStyle = '#222'; g.font = '${FONT}';
  for (const [t, x, y] of ${JSON.stringify(RIGHE)}) g.fillText(t, x, y);
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misure = ${JSON.stringify(RIGHE)}.map(([t, x, y]) => ({ t, x, y, w: g.measureText(t).width, parola: g.measureText('Fattura numero ').width, quattro: g.measureText('4821').width }));
</script></body></html>`;

// Il lettore finto risponde come quello vero: le righe col riquadro in 0..1000 dell'immagine.
async function lettoreFinto(app, righe, { attesaMs = 0, tema = 'light' } = {}) {
  await app.evaluate(async (_e, { righe, attesaMs, tema }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSCRIBE_IMAGE]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: tema,
    });
    globalThis.__letture = [];
    const P = globalThis.__veri || (globalThis.__veri = { c: globalThis.SN_PROVIDERS.completeWithFallback, s: globalThis.SN_PROVIDERS.streamCompleteWithFallback });
    const finto = (vero) => async (opts) => {
      const t = JSON.stringify(opts.messages || '');
      if (!t.includes('Trascrivi ESATTAMENTE il testo')) return vero(opts);
      globalThis.__letture.push({ immagine: /data:image\/(png|jpeg)/.test(t) });
      globalThis.__immagini = (globalThis.__immagini || []).concat([(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/.exec(t) || [''])[0]]);
      if (attesaMs) await new Promise((r) => setTimeout(r, attesaMs));
      return { text: JSON.stringify({ righe }), model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto(P.c);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto(P.s);
  }, { righe, attesaMs, tema });
}

async function apri(app, openTab, testServer, opz) {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misure);
  const m = await page.evaluate(() => window.misure);
  const righe = m.map((r) => ({
    testo: r.t,
    x1: Math.round((r.x / 600) * 1000), y1: Math.round(((r.y - 28) / 160) * 1000),
    x2: Math.round(((r.x + r.w) / 600) * 1000), y2: Math.round(((r.y + 8) / 160) * 1000),
  }));
  await lettoreFinto(app, righe, opz);
  return { page, m, righe };
}

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const letture = (app) => app.evaluate(() => globalThis.__letture.length);

test('Trascrivi dalla barra: la porzione resta a schermo, una parola selezionata si copia da sola, «Copia tutto» copia tutto', async ({ app, openTab, testServer }) => {
  const { page, m } = await apri(app, openTab, testServer);
  const box = await page.locator('#foto').boundingBox();
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));

  await premiNellaBarra(app, 'transcribe');
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 10_000 });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 4 });
  await page.mouse.up();

  const strato = await paginaDelloStrato(app, page);
  const riquadro = strato.locator('.sn-tr-overlay.sn-tr-pronto');
  await expect(riquadro).toBeVisible({ timeout: 10_000 });
  expect(await letture(app)).toBe(1);
  await expect(strato.locator('.sn-tr-riga')).toHaveText(['Fattura numero 4821', 'Totale 1250 euro']);
  // L'immagine sta dove stava la porzione.
  const scena = await strato.locator('.sn-tr-scena').boundingBox();
  expect(Math.abs(scena.x - box.x)).toBeLessThan(2);
  expect(Math.abs(scena.y - box.y)).toBeLessThan(2);
  await strato.screenshot({ path: 'tests/.shots/trascrivi-riquadro.png' }).catch(() => {});

  // Doppio clic sopra «4821» disegnato nell'immagine, poi Ctrl+C: negli appunti c'è solo quella parola.
  const r0 = m[0];
  await strato.mouse.dblclick(box.x + r0.x + r0.parola + r0.quattro / 2, box.y + r0.y - 12);
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe('4821');
  await strato.screenshot({ path: 'tests/.shots/trascrivi-selezione.png' }).catch(() => {});

  // Il tasto destro sulla selezione ha le azioni del testo, e «Copia» copia la parola.
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await strato.mouse.click(box.x + r0.x + r0.parola + r0.quattro / 2, box.y + r0.y - 12, { button: 'right' });
  const menu = menuDi(strato).locator('.sn-menu').first();
  await expect(menu).toBeVisible({ timeout: 5000 });
  await expect(menu.getByText('Cerca', { exact: false }).first()).toBeVisible();
  await strato.screenshot({ path: 'tests/.shots/trascrivi-tasto-destro.png' }).catch(() => {});
  // Esc chiude prima il menu, poi il riquadro.
  await strato.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(strato.locator('.sn-tr-overlay')).toBeVisible();
  await strato.mouse.click(box.x + r0.x + r0.parola + r0.quattro / 2, box.y + r0.y - 12, { button: 'right' });
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('button', { hasText: /^Copia$/ }).first().click();
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe('4821');

  await strato.locator('.sn-tr-copia').click();
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe('Fattura numero 4821\nTotale 1250 euro');

  await strato.keyboard.press('Escape');
  await expect(strato.locator('.sn-tr-overlay')).toHaveCount(0);
});

test('tasto destro su un\'immagine: «Trascrivi» apre lo stesso riquadro sopra di lei, e mentre legge lo dice', async ({ app, openTab, testServer }) => {
  const { page } = await apri(app, openTab, testServer, { attesaMs: 2500, tema: 'dark' });
  const box = await page.locator('#foto').boundingBox();
  await page.locator('#foto').click({ button: 'right', position: { x: 300, y: 80 } });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  // A icone (#2555): un'icona della griglia o dietro il «+».
  await menuDi(page).scegli(menu.locator('button', { hasText: 'Trascrivi' }).first());

  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-stato')).toContainText('Leggo il testo', { timeout: 5000 });
  await expect(strato.locator('.sn-tr-stato .sn-rinomina-rotella')).toBeVisible();
  await strato.screenshot({ path: 'tests/.shots/trascrivi-attesa-scuro.png' }).catch(() => {});
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  await strato.screenshot({ path: 'tests/.shots/trascrivi-pronto-scuro.png' }).catch(() => {});
  await expect(strato.locator('.sn-tr-riga')).toHaveText(['Fattura numero 4821', 'Totale 1250 euro']);
  const scena = await strato.locator('.sn-tr-scena').boundingBox();
  expect(Math.abs(scena.x - box.x)).toBeLessThan(2);
  expect(Math.abs(scena.width - box.width)).toBeLessThan(2);
  expect(await letture(app)).toBe(1);

  // Un clic fuori dall'immagine chiude.
  await strato.mouse.click(5, 5);
  await expect(strato.locator('.sn-tr-overlay')).toHaveCount(0);
});

// Nelle pagine di Filo il riquadro sta nel documento: lo stesso doppio clic e lo stesso Ctrl+C.
async function immagineNelDocumento(page, dove) {
  return page.evaluate(({ dove, W, H, RIGHE, FONT }) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#222'; g.font = FONT;
    for (const [t, x, y] of RIGHE) g.fillText(t, x, y);
    const img = document.createElement('img');
    img.id = 'foto'; img.width = W; img.height = H; img.src = c.toDataURL('image/png');
    img.style.cssText = 'display:block;margin:20px';
    document.querySelector(dove).appendChild(img);
    const r0 = RIGHE[0];
    return { x: r0[1] + g.measureText('Fattura numero ').width + g.measureText('4821').width / 2, y: r0[2] - 12 };
  }, { dove, W, H, RIGHE, FONT });
}

test('nell\'Editor: tasto destro su un\'immagine, «Trascrivi», e una parola sola negli appunti', async ({ app, openTab, testServer }) => {
  const { righe } = await apri(app, openTab, testServer);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForFunction(() => !!document.querySelector('#doc') && !!window.SN_TRASCRIZIONE);
  const parola = await immagineNelDocumento(editor, '#doc');
  await lettoreFinto(app, righe);
  await editor.waitForFunction(() => document.getElementById('foto').complete);
  const box = await editor.locator('#foto').boundingBox();
  await editor.locator('#foto').click({ button: 'right', position: { x: 300, y: 80 } });
  await menuDi(editor).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  await expect(editor.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  await editor.mouse.dblclick(box.x + parola.x, box.y + parola.y);
  await editor.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe('4821');
  await editor.screenshot({ path: 'tests/.shots/trascrivi-editor.png' }).catch(() => {});
  await editor.keyboard.press('Escape');
  await expect(editor.locator('.sn-tr-overlay')).toHaveCount(0);
});

test('l\'Aiuto trascrive l\'immagine indicata, e una porzione la fa scegliere all\'utente', async ({ app, openTab, testServer }) => {
  const { righe } = await apri(app, openTab, testServer);
  const nuova = await openTab('filo://newtab/');
  await nuova.waitForFunction(() => typeof window.__filoSidebarTest?.runPageAction === 'function', null, { timeout: 8000 });
  await immagineNelDocumento(nuova, 'body');
  await lettoreFinto(app, righe);
  await nuova.waitForFunction(() => document.getElementById('foto').complete);
  expect(await nuova.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'transcribe_image', selector: '#foto' }))).toBe(true);
  await expect(nuova.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  await expect(nuova.locator('.sn-tr-riga')).toHaveText(['Fattura numero 4821', 'Totale 1250 euro']);
  await nuova.keyboard.press('Escape');
  await expect(nuova.locator('.sn-tr-overlay')).toHaveCount(0);

  expect(await nuova.evaluate(() => window.__filoSidebarTest.runPageAction({ op: 'transcribe_region' }))).toBe(true);
  await expect(nuova.locator('.sn-region-overlay')).toBeVisible({ timeout: 5000 });
  await nuova.keyboard.press('Escape');
  await expect(nuova.locator('.sn-region-overlay')).toHaveCount(0);
});

async function trascriviDalTastoDestro(app, page, sel = '#foto') {
  await page.locator(sel).click({ button: 'right', position: { x: 10, y: 10 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  return paginaDelloStrato(app, page);
}

test('una selezione su più righe si copia con le righe separate, da Ctrl+C, dal tasto destro e da Ctrl+A', async ({ app, openTab, testServer }) => {
  const { page, m } = await apri(app, openTab, testServer);
  const box = await page.locator('#foto').boundingBox();
  const strato = await trascriviDalTastoDestro(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  const r0 = m[0];
  const seleziona = async () => {
    await strato.mouse.move(box.x + r0.x + r0.parola + 1, box.y + r0.y - 12);
    await strato.mouse.down();
    await strato.mouse.move(box.x + 20 + 150, box.y + m[1].y - 12, { steps: 6 });
    await strato.mouse.up();
  };

  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await seleziona();
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).toMatch(/^4821\nTotale/);
  const conCtrlC = await appunti(app);

  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await seleziona();
  await strato.mouse.click(box.x + r0.x + r0.parola + r0.quattro / 2, box.y + r0.y - 12, { button: 'right' });
  const menu = menuDi(strato).locator('.sn-menu').first();
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('button', { hasText: /^Copia$/ }).first().click();
  // Il Copia del tasto destro dà lo stesso testo di Ctrl+C: chi copia un elenco lo ritrova a righe.
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe(conCtrlC);

  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await strato.keyboard.press('ControlOrMeta+a');
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe('Fattura numero 4821\nTotale 1250 euro');
});

test('un\'immagine SVG si trascrive come le altre: il lettore la riceve in un formato che legge', async ({ app, openTab, testServer }) => {
  const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><text x="20" y="56" font-size="32" font-family="sans-serif">Fattura numero 4821</text></svg>`);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:60px 40px">
<img id="foto" width="${W}" height="${H}" src="data:image/svg+xml,${svg}"></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').complete);
  await lettoreFinto(app, [{ testo: 'Fattura numero 4821', x1: 33, y1: 175, x2: 600, y2: 400 }]);
  const strato = await trascriviDalTastoDestro(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  await expect(strato.locator('.sn-tr-riga')).toHaveText(['Fattura numero 4821']);
  expect(await app.evaluate(() => globalThis.__letture)).toEqual([{ immagine: true }]);
});

test('un\'immagine più pesante del limite dello strato si rimpicciolisce e si apre', async ({ app, openTab, testServer }) => {
  // Rumore: non si comprime, e anche in JPEG supera il limite.
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:20px">
<img id="foto" style="width:600px;height:400px">
<script>
  const c = document.createElement('canvas'); c.width = 3600; c.height = 2400;
  const g = c.getContext('2d'); const d = g.createImageData(c.width, c.height);
  for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0;
  g.putImageData(d, 0, 0);
  document.getElementById('foto').src = c.toDataURL('image/png');
</script></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').complete && document.getElementById('foto').naturalWidth > 0, null, { timeout: 30_000 });
  await lettoreFinto(app, [{ testo: 'rumore', x1: 0, y1: 0, x2: 500, y2: 100 }]);
  const strato = await trascriviDalTastoDestro(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 30_000 });
  await expect(strato.locator('.sn-tr-riga')).toHaveText(['rumore']);
});

test('una foto sopra il tetto delle immagini date all\'Aiuto arriva al lettore ridotta come all\'Aiuto', async ({ app, openTab, testServer }) => {
  // Rumore 1500×1000: più di 4 MB, ma sotto il limite dello strato.
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:20px">
<img id="foto" style="width:600px;height:400px">
<script>
  const c = document.createElement('canvas'); c.width = 1500; c.height = 1000;
  const g = c.getContext('2d'); const d = g.createImageData(c.width, c.height);
  for (let i = 0; i < d.data.length; i++) d.data[i] = (i % 4 === 3) ? 255 : (Math.random() * 256) | 0;
  g.putImageData(d, 0, 0);
  document.getElementById('foto').src = c.toDataURL('image/png');
</script></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').complete && document.getElementById('foto').naturalWidth > 0, null, { timeout: 30_000 });
  const tetto = await app.evaluate(() => globalThis.SN_CONST.ALLEGATI_CHAT.tettoImmagineByte);
  const byte = (u) => Math.floor((u.length - u.indexOf(',') - 1) * 3 / 4);
  expect(byte(await page.evaluate(() => document.getElementById('foto').src))).toBeGreaterThan(tetto);
  await lettoreFinto(app, [{ testo: 'rumore', x1: 0, y1: 0, x2: 500, y2: 100 }]);
  const strato = await trascriviDalTastoDestro(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 30_000 });
  const [data] = await app.evaluate(() => globalThis.__immagini);
  expect(byte(data)).toBeLessThanOrEqual(tetto);
});

test('l\'Aiuto aperto su un sito trascrive l\'immagine indicata e fa scegliere una porzione della pagina sotto', async ({ app, openTab, testServer }) => {
  const { page } = await apri(app, openTab, testServer);
  const box = await page.locator('#foto').boundingBox();
  await nelMondoDiFilo(app, page, () => { globalThis.SN_SIDEBAR.open(); return 1; });
  const strato = await paginaDelloStrato(app, page);
  await strato.waitForSelector('.sn-sidebar-input textarea');

  expect(await nelloStrato(app, page, () => globalThis.__filoSidebarTest.runPageAction({ op: 'transcribe_image', selector: '#foto' }))).toBe(true);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  await expect(strato.locator('.sn-tr-riga')).toHaveText(['Fattura numero 4821', 'Totale 1250 euro']);
  await strato.keyboard.press('Escape');
  await expect(strato.locator('.sn-tr-overlay')).toHaveCount(0);

  expect(await nelloStrato(app, page, () => globalThis.__filoSidebarTest.runPageAction({ op: 'transcribe_region' }))).toBe(true);
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 10_000 });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 4 });
  await page.mouse.up();
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  await expect(strato.locator('.sn-tr-riga')).toHaveText(['Fattura numero 4821', 'Totale 1250 euro']);
});

test('nessun testo nell\'immagine: il riquadro lo dice e non offre niente da copiare', async ({ app, openTab, testServer }) => {
  const { page } = await apri(app, openTab, testServer);
  await lettoreFinto(app, []);
  await page.locator('#foto').click({ button: 'right', position: { x: 300, y: 80 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-stato')).toHaveText('Nessun testo nell\'immagine', { timeout: 10_000 });
  await expect(strato.locator('.sn-tr-copia')).toHaveCount(0);
});

// #2374.1 — Un logo con la scritta chiara su fondo trasparente, su una pagina scura: nel riquadro e al lettore resta
// leggibile, sul colore che la pagina mostrava sotto di lui.
const INSEGNA = 'BENVENUTI 2026';
const PNG_TRASPARENTE = `const c = document.createElement('canvas'); c.width = 600; c.height = 120;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('${INSEGNA}', 20, 70);
  document.getElementById('foto').src = c.toDataURL('image/png');`;
const SVG_TRASPARENTE = `document.getElementById('foto').src = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><text x="20" y="70" font-size="40" font-family="sans-serif" fill="#fff">${INSEGNA}</text></svg>');`;
const paginaScura = (disegna, fondo = '#151515') => `<!doctype html><html><head><meta charset="utf-8"><title>Scuro</title></head>
<body style="margin:0;padding:60px 20px;background:${fondo}">
<img id="foto" width="600" height="120" alt="insegna">
<script>${disegna}</script></body></html>`;

// Quanta parte dell'immagine si stacca dal suo colore più comune, vista su bianco come la mostra chi ignora la
// trasparenza: è la scritta che si vede. Una pagina bianca dà 0.
async function scrittaNellImmagine(page, png64) {
  return page.evaluate(async (src) => {
    const bmp = await createImageBitmap(await (await fetch(src)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lum = [];
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      lum.push((0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) * a + 255 * (1 - a));
    }
    const med = [...lum].sort((a, b) => a - b)[Math.floor(lum.length / 2)];
    return lum.filter((l) => Math.abs(l - med) > 60).length / lum.length;
  }, png64);
}

for (const [nome, disegnaInsegna] of [['PNG trasparente', PNG_TRASPARENTE], ['SVG', SVG_TRASPARENTE]]) {
  test(`una scritta chiara su fondo trasparente (${nome}) si vede nel riquadro e arriva leggibile al lettore`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, paginaScura(disegnaInsegna));
    await page.waitForFunction(() => document.getElementById('foto').complete && document.getElementById('foto').naturalWidth > 0);
    await lettoreFinto(app, [{ testo: INSEGNA, x1: 33, y1: 300, x2: 560, y2: 650 }]);
    const strato = await trascriviDalTastoDestro(app, page);
    await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
    const scena = await strato.locator('.sn-tr-scena').boundingBox();
    const vista = `data:image/png;base64,${(await strato.screenshot({ clip: scena })).toString('base64')}`;
    await strato.screenshot({ path: `tests/.shots/trascrivi-trasparente-${nome.split(' ')[0].toLowerCase()}.png` }).catch(() => {});
    expect(await scrittaNellImmagine(page, vista), 'la scritta si vede nel riquadro').toBeGreaterThan(0.01);
    const [letta] = await app.evaluate(() => globalThis.__immagini);
    expect(await scrittaNellImmagine(page, letta), 'la scritta arriva al lettore').toBeGreaterThan(0.01);
  });
}

test('un logo bianco trasparente su una pagina bianca si posa su un fondo scuro, che lo fa leggere', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, paginaScura(PNG_TRASPARENTE, '#ffffff'));
  await page.waitForFunction(() => document.getElementById('foto').complete && document.getElementById('foto').naturalWidth > 0);
  await lettoreFinto(app, [{ testo: INSEGNA, x1: 33, y1: 300, x2: 560, y2: 650 }]);
  const strato = await trascriviDalTastoDestro(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  const [letta] = await app.evaluate(() => globalThis.__immagini);
  expect(await scrittaNellImmagine(page, letta)).toBeGreaterThan(0.01);
});

// #2374.1 — Dentro la riga le parole stanno dove sono disegnate, anche quando il carattere non è quello di Filo.
const SW = 760;
const SH = 140;
const SPX = 26;
const SCONTRINO = ['PANE INTEGRALE KG 0,350 EUR 1,40 IVA 4%', 'TOTALE COMPLESSIVO 12,50'];
const paginaScontrino = (font) => `<!doctype html><html><head><meta charset="utf-8"><title>Scontrino</title></head>
<body style="margin:0;padding:60px 20px;background:#eee">
<img id="foto" width="${SW}" height="${SH}" alt="scontrino">
<script>
  const c = document.createElement('canvas'); c.width = ${SW}; c.height = ${SH};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${SW}, ${SH});
  g.fillStyle = '#222'; g.font = '${SPX}px ${font}';
  g.fillText(${JSON.stringify(SCONTRINO[0])}, 20, 50);
  g.fillText(${JSON.stringify(SCONTRINO[1])}, 20, 110);
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misura = (s) => g.measureText(s).width;
</script></body></html>`;

async function apriScontrino(app, openTab, testServer, font) {
  const page = await testServer.openReady(openTab, paginaScontrino(font));
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misura);
  const [w1, w2] = await page.evaluate((r) => r.map((s) => window.misura(s)), SCONTRINO);
  // Il riquadro esatto di ogni riga: lo scarto può venire solo da come il riquadro posa le parole.
  const r = (testo, y, w) => ({ testo, x1: Math.round((20 / SW) * 1000), y1: Math.round(((y - SPX) / SH) * 1000), x2: Math.round(((20 + w) / SW) * 1000), y2: Math.round(((y + 7) / SH) * 1000) });
  await lettoreFinto(app, [r(SCONTRINO[0], 50, w1), r(SCONTRINO[1], 110, w2)]);
  const box = await page.locator('#foto').boundingBox();
  const strato = await trascriviDalTastoDestro(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  return { page, strato, box };
}

// Trascina dalla prima all'ultima lettera di `parola` come appare nell'immagine, poi Ctrl+C.
async function trascinaECopia(app, page, strato, box, prima, parola) {
  const [da, lunga] = await page.evaluate(([p, q]) => [window.misura(p), window.misura(q)], [prima, parola]);
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await strato.mouse.move(box.x + 20 + da + 2, box.y + 40);
  await strato.mouse.down();
  await strato.mouse.move(box.x + 20 + da + lunga - 2, box.y + 40, { steps: 6 });
  await strato.mouse.up();
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).not.toBe('prima');
  return appunti(app);
}

test('scontrino a caratteri fissi: una parola trascinata come appare si copia intera, anche in fondo alla riga', async ({ app, openTab, testServer }) => {
  const { page, strato, box } = await apriScontrino(app, openTab, testServer, 'monospace');
  expect(await trascinaECopia(app, page, strato, box, 'PANE ', 'INTEGRALE')).toBe('INTEGRALE');
  expect(await trascinaECopia(app, page, strato, box, 'PANE INTEGRALE KG 0,350 EUR ', '1,40')).toBe('1,40');
  await strato.screenshot({ path: 'tests/.shots/trascrivi-scontrino.png' }).catch(() => {});
  // La riga intera resta una riga sola negli appunti, con i suoi spazi.
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await strato.keyboard.press('ControlOrMeta+a');
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe(SCONTRINO.join('\n'));
});

test('carattere con le grazie: il prezzo trascinato come appare si copia intero', async ({ app, openTab, testServer }) => {
  const { page, strato, box } = await apriScontrino(app, openTab, testServer, 'serif');
  expect(await trascinaECopia(app, page, strato, box, 'PANE INTEGRALE KG 0,350 EUR ', '1,40')).toBe('1,40');
  expect(await trascinaECopia(app, page, strato, box, 'PANE ', 'INTEGRALE')).toBe('INTEGRALE');
});

test('pagina ingrandita: la porzione si posa sopra l\'immagine, nel punto dove la pagina la mostra', async ({ app, openTab, testServer }) => {
  const { page } = await apri(app, openTab, testServer);
  const ZOOM = 1.25;
  await app.evaluate(({ BrowserWindow }, z) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.setZoomFactor(z);
  }, ZOOM);
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeGreaterThan(1.2);
  const box = await page.locator('#foto').boundingBox();
  const strato = await trascriviDalTastoDestro(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  const scena = await strato.locator('.sn-tr-scena').boundingBox();
  const fattore = await strato.evaluate(() => window.devicePixelRatio) / await page.evaluate(() => window.devicePixelRatio);
  for (const k of ['x', 'y', 'width', 'height']) expect(Math.abs(scena[k] - box[k] / fattore), k).toBeLessThan(2);
});

test('Copia del tasto destro su una pagina qualunque: un indirizzo su due righe resta su due righe, come con Ctrl+C', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;font:18px sans-serif">
<p id="ind">Via Roma 12<br>20121 Milano</p></body></html>`);
  await page.evaluate(() => getSelection().selectAllChildren(document.getElementById('ind')));
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await page.locator('#ind').click({ button: 'right', position: { x: 30, y: 10 } });
  await menuDi(page).locator('.sn-menu button', { hasText: /^Copia$/ }).first().click();
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe('Via Roma 12\n20121 Milano');
});
