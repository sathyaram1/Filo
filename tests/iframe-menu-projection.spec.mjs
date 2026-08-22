// #445 — il menu del tasto destro dentro un riquadro incorporato basso.
//
// Da #405 il tasto destro funziona anche dentro gli iframe, ma il menu nasceva
// LÌ DENTRO e non poteva uscire dai bordi del riquadro: su un player o una
// pubblicità alti 100-350 px si vedeva la fila di icone e una voce sola, il
// resto dietro una barra di scorrimento. Ora, quando non ci sta, il menu lo
// disegna la PAGINA sopra al riquadro, con tutta l'altezza della finestra —
// e le voci restano quelle dell'elemento cliccato dentro il riquadro.
//
// Questi spec asseriscono il successo dal punto di vista dell'utente: il menu
// si vede TUTTO, e le sue azioni agiscono sull'elemento del riquadro. Senza il
// lavoro tornano rossi: il menu resterebbe dentro l'iframe, scorrevole.

import { test, expect } from './fixtures/electron.mjs';

const INNER = `<!doctype html><html><body style="margin:0;padding:8px;font:14px sans-serif">
  <p id="inner-text">Testo dentro il riquadro incorporato, abbastanza lungo da selezionarlo.</p>
  <a id="inner-link" href="https://example.com/pagina-del-riquadro">un collegamento nel riquadro</a>
</body></html>`;

// Riquadro basso come un player o un banner: è il caso del feedback.
function outer(src, { width = 480, height = 110 } = {}) {
  return `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif">
    <p id="outer-text">Testo della pagina, fuori dal riquadro.</p>
    <iframe id="embed" src="${src}" width="${width}" height="${height}"
            style="border:1px solid #333"></iframe>
    <div style="height:400px"></div>
  </body></html>`;
}

test('in un riquadro basso il menu si vede TUTTO: lo disegna la pagina, non il riquadro', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  await page.frameLocator('#embed').locator('#inner-text').click({ button: 'right' });

  // Il menu è nella PAGINA, non dentro il riquadro.
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 8000 });
  await expect(page.frameLocator('#embed').locator('.sn-menu')).toHaveCount(0);

  // E si vede tutto: niente barra di scorrimento, ultima voce compresa.
  await expect(menu.getByText('Invia feedback', { exact: true })).toBeVisible();
  const shown = await menu.evaluate((el) => ({
    clipped: el.scrollHeight > el.clientHeight + 1,
    inView: el.getBoundingClientRect().bottom <= window.innerHeight + 1,
  }));
  expect(shown.clipped).toBe(false);
  expect(shown.inView).toBe(true);

  // È alto più del riquadro: è esattamente ciò che dentro non ci stava.
  const menuH = await menu.evaluate((el) => el.getBoundingClientRect().height);
  expect(menuH).toBeGreaterThan(110);
});

test('il menu nasce sopra al riquadro, non in un angolo qualunque della pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  await page.frameLocator('#embed').locator('#inner-text').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 8000 });

  const { menuBox, frameBox } = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu').getBoundingClientRect();
    const f = document.querySelector('#embed').getBoundingClientRect();
    return {
      menuBox: { left: m.left, top: m.top, right: m.right, bottom: m.bottom },
      frameBox: { left: f.left, top: f.top, right: f.right, bottom: f.bottom },
    };
  });
  // Il menu parte da dentro l'orizzontale del riquadro (il clic era lì) e la
  // sua verticale interseca quella del riquadro: nasce dove si è cliccato.
  expect(menuBox.left).toBeGreaterThanOrEqual(frameBox.left - 40);
  expect(menuBox.left).toBeLessThanOrEqual(frameBox.right);
  expect(menuBox.bottom).toBeGreaterThan(frameBox.top);
  expect(menuBox.top).toBeLessThan(frameBox.bottom + 40);
});

test('le voci del menu agiscono sull\'elemento del riquadro, non sulla pagina', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  await page.frameLocator('#embed').locator('#inner-link').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 8000 });

  // Le azioni del collegamento sono quelle del link DENTRO il riquadro.
  await menu.getByText('Copia URL', { exact: true }).click();
  await expect(menu).toHaveCount(0);

  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toContain('example.com/pagina-del-riquadro');
});

test('un clic dentro il riquadro chiude il menu disegnato dalla pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  await page.frameLocator('#embed').locator('#inner-text').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  // Gli eventi del mouse non attraversano il confine dell'iframe: senza un
  // avviso esplicito il menu resterebbe appeso sopra il riquadro mentre lo si usa.
  await page.frameLocator('#embed').locator('#inner-text').click();
  await expect(page.locator('.sn-menu')).toHaveCount(0);
});

test('in un riquadro ALTO il menu resta dentro il riquadro (niente delega inutile)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER), { width: 620, height: 700 }));
  const frame = page.frameLocator('#embed');
  await frame.locator('#inner-text').click({ button: 'right' });
  await expect(frame.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.sn-menu')).toHaveCount(0);
});

test('la spiegazione inline compare nel menu disegnato dalla pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
  const frame = page.frames().find((f) => f !== page.mainFrame() && f.url().includes('http'));
  // Monta Filo nel riquadro e seleziona il testo lì dentro.
  await page.frameLocator('#embed').locator('#inner-text').click();
  await frame.evaluate(() => {
    const p = document.querySelector('#inner-text');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.frameLocator('#embed').locator('#inner-text').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 8000 });
  // La sezione della spiegazione è prodotta dal riquadro (è lui a conoscere la
  // selezione) ma disegnata qui: se il ponte non passasse anche le sezioni
  // dinamiche, il menu proiettato ne resterebbe senza.
  await expect(menu.locator('.sn-menu-inline')).toBeVisible();
  const txt = (await menu.textContent()) || '';
  expect(txt).toContain('Copia');
});

test('con la pagina ingrandita il menu compare comunque sotto al cursore', async ({ app, openTab, testServer }) => {
  // Le coordinate che il main conosce sono in pixel della scheda NON ingrandita,
  // quelle dei frame in pixel CSS: con lo zoom sono due misure diverse. Senza la
  // conversione il menu si spostava in proporzione allo zoom e a 1.5× finiva
  // mezzo fuori dalla finestra.
  const inner = `<!doctype html><html><body style="margin:0;padding:0;background:#111">
    <div id="bersaglio" style="position:absolute;left:100px;top:40px;width:20px;height:20px;background:#0f0"></div>
  </body></html>`;
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:0">
    <iframe id="embed" src="${testServer.html(inner)}" width="520" height="110"
            style="border:0;position:absolute;left:60px;top:50px"></iframe>
    <div style="height:900px"></div></body></html>`);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs.tabs;
    tabs[tabs.length - 1].view.webContents.setZoomFactor(1.5);
  });
  await page.waitForTimeout(400);
  await page.frameLocator('#embed').locator('#bersaglio').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 8000 });

  const pos = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu').getBoundingClientRect();
    return { left: m.left, top: m.top, right: m.right, vw: window.innerWidth };
  });
  // Il centro del bersaglio è a (60+110, 50+50) = (170, 100) nella pagina.
  expect(Math.abs(pos.left - 170)).toBeLessThan(12);
  expect(Math.abs(pos.top - 100)).toBeLessThan(12);
  expect(pos.right).toBeLessThanOrEqual(pos.vw);
});

test('«Incolla» dal menu disegnato dalla pagina scrive nel campo del riquadro', async ({ app, openTab, testServer }) => {
  // Il campo su cui si sta scrivendo vive nel RIQUADRO, il menu nella PAGINA:
  // se il clic sul menu portasse via il fuoco (o il punto in cui si scriveva),
  // l'incolla finirebbe nel vuoto.
  const inner = `<!doctype html><html><body style="margin:0;padding:6px;font:14px sans-serif">
    <textarea id="campo" rows="2" cols="40">ciao </textarea>
  </body></html>`;
  const page = await testServer.openReady(openTab, outer(testServer.html(inner)));
  await app.evaluate(({ clipboard }) => clipboard.writeText('mondo'));

  const frame = page.frameLocator('#embed');
  await frame.locator('#campo').click();
  await page.keyboard.press('End');
  await frame.locator('#campo').click({ button: 'right' });

  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 8000 });
  await menu.getByText('Incolla', { exact: true }).click();

  await expect.poll(async () => frame.locator('#campo').inputValue(), { timeout: 6000 })
    .toContain('mondo');
});
