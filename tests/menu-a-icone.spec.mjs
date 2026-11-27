// #2555 — il tasto destro è a icone: un'icona per verbo, le rare dietro il «+» nello stesso menu, la riga del nome
// «nome · oggetto · tasto», il menu dell'icona con le varianti, il contorno dell'oggetto, il tasto singolo; testo solo
// per spiegazioni, proposte e dati. Su link, immagine, immagine in un link, filmato, testo selezionato, messaggio della
// chat e il menu proprio di una pagina di Filo.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi, nelMondoDelMenu } from './helpers/menuContestuale.mjs';
import { home, modelloFinto, chiedi } from './helpers/chatFinta.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '.shots');
mkdirSync(SHOTS, { recursive: true });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQImWP8z8DwnwEJMDKgAQYGAH8IBAFwbpVFAAAAAElFTkSuQmCC', 'base64');
const SITO = (img) => `<!doctype html><html><head><title>Icone</title></head>
  <body style="margin:0;padding:40px;font:16px sans-serif;height:1400px">
  <p id="testo">Un paragrafo di prova da selezionare col mouse.</p>
  <p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
  <img id="foto" src="${img}" width="160" height="90" alt="foto">
  <p><a id="scheda" href="https://esempio.it/altra"><img id="copertina" src="${img}" width="160" height="90" alt="copertina"></a></p>
  <video id="film" width="240" height="135" style="background:#222"></video>
  <div id="vuoto" style="height:200px"></div>
  </body></html>`;

// Lo stato del menu aperto, letto dove è disegnato: le icone (anche quelle dietro il «+»), i testi rimasti fuori dalla
// griglia, la riga del nome.
function statoMenu(menu) {
  return menu.valuta(() => {
    const m = document.querySelector('.sn-menu:not(.sn-menu-sub)');
    if (!m) return null;
    const icone = [...m.querySelectorAll('.sn-menu-griglia .sn-menu-row-btn:not(.sn-menu-row-overflow)')].map((b) => ({
      verbo: b.dataset.snVerbo || '', id: b.dataset.snIconId || '', nome: b.getAttribute('aria-label') || '',
      tasto: b.dataset.snTasto || '', varianti: b.dataset.snVarianti === '1', rara: !!b.closest('.sn-menu-altro'),
    }));
    // Righe di testo fuori dalla griglia che non sono una spiegazione, una proposta o un dato.
    const testo = [...m.querySelectorAll('.sn-menu-item, .sn-menu-split, .sn-menu-paste')].filter((x) => x.getClientRects().length)
      .map((x) => x.textContent.trim());
    return { icone, testo, nome: m.querySelector('.sn-menu-nome')?.textContent || '' };
  });
}

const verbi = (s) => s.icone.map((i) => i.verbo).filter(Boolean);
const nomi = (s) => s.icone.map((i) => i.nome);

async function variantiDi(page, menu, verbo) {
  await menu.locator(`.sn-menu-griglia [data-sn-verbo="${verbo}"]`).click({ button: 'right' });
  const sub = menu.locator('.sn-menu-sub');
  await expect(sub).toBeVisible();
  return sub.locator('.sn-menu-item').allTextContents();
}

test('ogni menu di una pagina è a icone, senza azioni doppie, e niente di quello che c\'era si perde', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);

  // Collegamento.
  await page.locator('#vai').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  let s = await statoMenu(menu);
  expect(s.testo, 'nessuna riga di testo fuori da spiegazioni e dati').toEqual([]);
  expect(new Set(verbi(s)).size).toBe(verbi(s).length);
  for (const n of ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link', 'Invia feedback']) expect(nomi(s)).toContain(n);
  await page.screenshot({ path: resolve(SHOTS, 'menu-a-icone-link.png') });
  await page.keyboard.press('Escape');

  // Immagine: salva, copia (con l'indirizzo fra le varianti), cerca, trascrivi, chiedi.
  await page.locator('#foto').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  s = await statoMenu(menu);
  expect(s.testo).toEqual([]);
  expect(new Set(verbi(s)).size).toBe(verbi(s).length);
  for (const n of ['Salva immagine come…', 'Copia immagine', 'Cerca immagine', 'Trascrivi']) expect(nomi(s)).toContain(n);
  expect(await variantiDi(page, menu, 'copy')).toEqual(['Copia URL immagine']);
  await page.keyboard.press('Escape');

  // Immagine dentro un collegamento: apri apre il collegamento, salva l'immagine; il collegamento si copia dalle varianti.
  await page.locator('#copertina').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  s = await statoMenu(menu);
  expect(s.testo).toEqual([]);
  expect(new Set(verbi(s)).size, 'un verbo, un\'icona').toBe(verbi(s).length);
  expect(s.icone.find((i) => i.verbo === 'openTab').nome).toBe('Apri in nuova tab');
  expect(s.icone.find((i) => i.verbo === 'save').nome).toBe('Salva immagine come…');
  expect(await variantiDi(page, menu, 'copy')).toEqual(['Copia URL immagine', 'Copia URL']);
  await page.screenshot({ path: resolve(SHOTS, 'menu-a-icone-immagine-link.png') });
  await page.keyboard.press('Escape');

  // Filmato: i controlli stanno dietro il «+», scelta dell'owner; la velocità è il suo valore.
  await page.locator('#film').click({ button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  s = await statoMenu(menu);
  expect(s.testo).toEqual([]);
  expect(new Set(verbi(s)).size).toBe(verbi(s).length);
  expect(s.icone.find((i) => i.verbo === 'controls').rara).toBe(true);
  await expect(menu.locator('[data-sn-verbo="speed"] .sn-menu-valore')).toHaveText('1×');
  await menu.locator('.sn-menu-row-overflow').click();
  await expect(menu.locator('.sn-menu-altro')).toBeVisible();
  await page.screenshot({ path: resolve(SHOTS, 'menu-a-icone-film.png') });
  // La rotella sulla velocità la cambia senza aprire niente.
  await menu.locator('[data-sn-verbo="speed"]').hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.evaluate(() => document.getElementById('film').playbackRate)).toBeGreaterThan(1);
  await expect(menu.locator('[data-sn-verbo="speed"] .sn-menu-valore')).not.toHaveText('1×');
  await expect(menu.locator('.sn-menu-sub')).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('la riga del nome dice nome, oggetto e tasto senza ritardo, e il tasto singolo esegue l\'icona', async ({ app, openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);
  await page.locator('#vai').click({ button: 'right' });
  const copia = menu.locator('.sn-menu-griglia [data-sn-verbo="copy"]');
  await expect(copia).toBeVisible();
  await copia.hover();
  await expect(menu.locator('.sn-menu-nome')).toHaveText('Copia · il collegamento · C', { timeout: 300 });
  // Il contorno dell'oggetto, sulla pagina.
  await expect(menu.locator('.sn-menu-bersaglio').first()).toBeVisible();
  // Il tasto C copia il collegamento.
  await page.keyboard.press('c');
  await expect(menu.pannelli).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://esempio.it/pagina');
});

test('il messaggio della chat nel filo: rispondi, copia, nascondi e togli come icone, e copia copia il messaggio', async ({ app }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, [{ text: 'Il capitolo sui licheni va accorciato.' }]);
  const casa = await home(app);
  await chiedi(casa, 'come va il capitolo?');
  const bolla = casa.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('licheni', { timeout: 15_000 });
  await bolla.click({ button: 'right' });
  const menu = menuDi(casa);
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  const s = await statoMenu(menu);
  expect(s.testo, 'nessuna riga di testo').toEqual([]);
  expect(new Set(verbi(s)).size).toBe(verbi(s).length);
  expect(verbi(s)).toEqual(expect.arrayContaining(['reply', 'copy', 'hide', 'remove']));
  const copia = menu.locator('.sn-menu-griglia [data-sn-verbo="copy"]');
  await copia.hover();
  await expect(menu.locator('.sn-menu-nome')).toHaveText('Copia · il messaggio · C');
  await expect(menu.locator('.sn-menu-bersaglio').first()).toBeVisible();
  await casa.screenshot({ path: resolve(SHOTS, 'menu-a-icone-messaggio.png') });
  await copia.click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('licheni');

  // Con un pezzo selezionato «copia» copia la selezione, e il messaggio intero sta nel menu dell'icona.
  await bolla.evaluate((b) => {
    const t = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    let n = t.nextNode();
    while (n && !n.nodeValue.includes('licheni')) n = t.nextNode();
    const i = n.nodeValue.indexOf('licheni');
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + 'licheni'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  const box = await casa.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await casa.mouse.click(box.x, box.y, { button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  expect(await variantiDi(casa, menu, 'copy')).toContain('Copia il messaggio');
  await casa.keyboard.press('Escape');
  await casa.mouse.click(box.x, box.y, { button: 'right' });
  await menu.locator('.sn-menu-griglia [data-sn-verbo="copy"]').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('licheni');
});

test('il menu proprio di una pagina di Filo (il titolo dell\'Editor) è a icone, con le varianti dello stesso verbo', async ({ openTab }) => {
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#docbar').click({ button: 'right' });
  const menu = menuDi(editor);
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  await expect(editor.locator('.ed-title-ctxmenu')).toHaveCount(0);
  const s = await statoMenu(menu);
  expect(s.testo).toEqual([]);
  expect(new Set(verbi(s)).size).toBe(verbi(s).length);
  expect(verbi(s)).toEqual(expect.arrayContaining(['reload', 'history', 'rename', 'duplicate', 'delete']));
  // «Rigenera titolo» e «Rigenera riassunto» sono lo stesso verbo: un'icona, e l'altro nel suo menu.
  expect(await variantiDi(editor, menu, 'reload')).toEqual(['Rigenera riassunto']);
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('Escape');
  // Il tasto singolo vale anche qui: R… di Rinomina, mostrato nella riga del nome.
  await editor.locator('#docbar').click({ button: 'right' });
  await menu.locator('.sn-menu-griglia [data-sn-verbo="rename"]').hover();
  const nome = await menu.locator('.sn-menu-nome').textContent();
  const tasto = nome.split(' · ').pop();
  expect(tasto).toMatch(/^[A-Z0-9]$/);
  await editor.keyboard.press(tasto.toLowerCase());
  await expect(menu.pannelli).toHaveCount(0);
  await editor.screenshot({ path: resolve(SHOTS, 'menu-a-icone-editor.png') });
});

test('un filmato su un sito col suo menu: «Menu di …» ha l\'icona del sito, l\'audio si vede acceso', async ({ openTab, testServer }) => {
  const icona = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Video</title>
    <meta property="og:site_name" content="YouTube"><link rel="icon" href="${icona}"></head>
    <body style="margin:0;padding:40px;background:#0f0f0f">
    <div id="lettore"><video id="film" width="480" height="270" style="background:#222"></video></div>
    <script>document.getElementById('lettore').addEventListener('contextmenu', (e) => e.preventDefault());</script>
    </body></html>`);
  const menu = menuDi(page);
  // L'icona del sito la scarica la fila delle schede: si aspetta che ci sia prima di aprire il menu.
  await expect.poll(async () => {
    await page.locator('#film').click({ button: 'right' });
    await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
    const c = await menu.locator('[data-sn-verbo="siteMenu"] img').count();
    await page.keyboard.press('Escape');
    return c;
  }, { timeout: 15_000 }).toBe(1);
  await page.locator('#film').click({ button: 'right' });
  await expect(menu.locator('[data-sn-verbo="siteMenu"]')).toHaveAttribute('aria-label', 'Menu di YouTube');
  await expect(menu.locator('[data-sn-verbo="mute"]')).toHaveAttribute('aria-pressed', 'true');
  await menu.locator('[data-sn-verbo="siteMenu"]').hover();
  await expect(menu.locator('.sn-menu-nome')).toContainText('Menu del sito · YouTube');
  await page.screenshot({ path: resolve(SHOTS, 'menu-a-icone-youtube.png') });
});

test.describe('col menu nello strato sopra la scheda', () => {
  test.use({ stratoDelMenu: true });

  test('griglia, riga del nome, contorno sulla pagina e menu dell\'icona come nella pagina', async ({ app, openTab, testServer }) => {
    const img = testServer.asset(PNG, 'image/png');
    const page = await testServer.openReady(openTab, SITO(img));
    await page.locator('#copertina').click({ button: 'right' });
    const menu = menuDi(page);
    await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
    expect(menu.superficie.url()).toMatch(/^filo:\/\/menu\//);
    const s = await statoMenu(menu);
    expect(s.testo).toEqual([]);
    const copia = menu.locator('.sn-menu-griglia [data-sn-verbo="copy"]');
    await copia.hover();
    await expect(menu.locator('.sn-menu-nome')).toHaveText('Copia · l\'immagine · C');
    // Il contorno sta nello strato, sopra l'immagine della pagina.
    const foto = await page.locator('#copertina').boundingBox();
    const contorno = await menu.locator('.sn-menu-bersaglio').first().boundingBox();
    expect(Math.abs(contorno.x + 2 - foto.x)).toBeLessThan(4);
    expect(Math.abs(contorno.y + 2 - foto.y)).toBeLessThan(4);
    expect(await variantiDi(page, menu, 'copy')).toEqual(['Copia URL immagine', 'Copia URL']);
    await menu.locator('.sn-menu-sub .sn-menu-item', { hasText: 'Copia URL' }).last().click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://esempio.it/altra');
    // Il tasto singolo, premuto sulla scheda: a menu aperto è del menu, anche nello strato.
    await page.locator('#vai').click({ button: 'right' });
    await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
    await page.keyboard.press('c');
    await expect(menu.pannelli).toHaveCount(0);
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://esempio.it/pagina');
  });
});

test('«copia» copia la selezione quando c\'è, l\'elemento quando non c\'è', async ({ app, openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, SITO(img));
  const menu = menuDi(page);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('testo'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  const t = await page.locator('#testo').boundingBox();
  await page.mouse.click(t.x + 30, t.y + t.height / 2, { button: 'right' });
  await expect(menu.locator('.sn-menu-griglia')).toBeVisible();
  const s = await statoMenu(menu);
  expect(s.testo).toEqual([]);
  expect(verbi(s)).toEqual(expect.arrayContaining(['copy', 'translate', 'search', 'readAloud']));
  await page.screenshot({ path: resolve(SHOTS, 'menu-a-icone-testo.png') });
  await menu.locator('.sn-menu-griglia [data-sn-verbo="copy"]').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Un paragrafo di prova da selezionare col mouse.');
  // Senza selezione, sul collegamento: il collegamento.
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator('#vai').click({ button: 'right' });
  await menu.locator('.sn-menu-griglia [data-sn-verbo="copy"]').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://esempio.it/pagina');
});
