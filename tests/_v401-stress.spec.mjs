// TEMP (verifier #401) — stress test black-box sul menu contestuale di una
// miniatura racchiusa in un collegamento. Da rimuovere a fine verifica.

import { test, expect } from './fixtures/electron.mjs';

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function card(href, extra = '') {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <a id="card" href="${href}"${extra}><img id="thumb" src="${PX}" width="140" height="140" style="background:#e07b39"></a>
  </body></html>`;
}

async function openMenuOn(page, selector, pos = { x: 8, y: 8 }) {
  await page.locator(selector).click({ button: 'right', position: pos });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function labels(menu) {
  return menu.locator('button').allInnerTexts();
}

// A — l'obiettivo esatto dell'utente: aprire la miniatura in una nuova scheda.
test('A: "Apri in nuova tab" sulla miniatura apre DAVVERO la pagina del link', async ({ app, openTab, testServer }) => {
  const destUrl = testServer.html('<!doctype html><title>Destinazione</title><h1 id="dest">Articolo</h1>');
  const page = await testServer.openReady(openTab, card(destUrl));
  const menu = await openMenuOn(page, '#thumb');
  await menu.locator('button', { hasText: 'Apri in nuova tab' }).first().click();

  await expect.poll(async () => {
    const urls = app.windows().map((w) => { try { return w.url(); } catch (_) { return ''; } });
    return urls.filter((u) => u === destUrl).length;
  }, { timeout: 10000 }).toBeGreaterThan(0);
});

// B — href assurdo: 10.000 caratteri + emoji + caratteri speciali.
test('B: href lunghissimo con emoji e caratteri speciali — il menu regge e copia l\'URL giusto', async ({ app, openTab, testServer }) => {
  const long = 'https://example.com/a?q=' + 'x'.repeat(10000) + '&e=%F0%9F%98%80&s=%3Cscript%3E';
  const page = await testServer.openReady(openTab, card(long));
  const menu = await openMenuOn(page, '#thumb');
  const txt = (await labels(menu)).join('|');
  expect(txt).toContain('Copia immagine');
  expect(txt).toContain('Apri in nuova tab');
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' }).first().click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 }).toBe(long);
});

// C — link ostile: javascript: non deve eseguire nulla nella pagina.
test('C: miniatura dentro un link javascript: — nessuno script eseguito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, card('javascript:void(window.__pwned=1)'));
  const menu = await openMenuOn(page, '#thumb');
  const has = (await labels(menu)).join('|');
  if (has.includes('Apri in nuova tab')) {
    await menu.locator('button', { hasText: 'Apri in nuova tab' }).first().click();
  }
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__pwned || null)).toBeNull();
});

// C2 — testo HTML dentro l'attributo title/testo del link: niente esecuzione.
test('C2: link con <script> nel testo — il menu non lo esegue né lo interpreta', async ({ openTab, testServer }) => {
  const html = `<!doctype html><html><body style="padding:24px">
    <a id="card" href="https://example.com/x"><img id="thumb" src="${PX}" width="140" height="140" alt="&lt;script&gt;window.__x=1&lt;/script&gt;" style="background:#e07b39"></a>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  const menu = await openMenuOn(page, '#thumb');
  await expect(menu.getByText('Apri in nuova tab', { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => window.__x || null)).toBeNull();
  expect(await menu.locator('script').count()).toBe(0);
});

// D — miniatura in fondo alla pagina: il menu è più alto di prima, deve restare
// interamente dentro la finestra (niente voci tagliate fuori schermo).
test('D: miniatura in fondo allo schermo — il menu resta dentro la finestra', async ({ openTab, testServer }) => {
  const html = `<!doctype html><html><body style="margin:0">
    <div style="height:100vh;position:relative">
      <a id="card" href="https://example.com/articolo" style="position:absolute;right:8px;bottom:8px">
        <img id="thumb" src="${PX}" width="80" height="80" style="background:#e07b39">
      </a>
    </div>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  const menu = await openMenuOn(page, '#thumb', { x: 40, y: 40 });
  await page.screenshot({ path: 'tests/.shots/v401-menu-bottom.png' }).catch(() => {});
  const box = await menu.boundingBox();
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(box).not.toBeNull();
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.h + 2);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.w + 2);
  // e la prima e l'ultima voce del menu sono davvero raggiungibili col mouse
  const btns = menu.locator('button');
  await expect(btns.first()).toBeVisible();
  await expect(btns.last()).toBeVisible();
});

// E — aperture ripetute rapide e cambio di bersaglio.
test('E: aperture ripetute e cambio bersaglio — il menu resta coerente', async ({ openTab, testServer }) => {
  const html = `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <a id="card" href="https://example.com/articolo"><img id="thumb" src="${PX}" width="140" height="140" style="background:#e07b39"></a>
    <p id="plain" style="margin-top:40px">Solo testo senza contesto</p>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  for (let i = 0; i < 4; i++) {
    const menu = await openMenuOn(page, '#thumb');
    const t = (await labels(menu)).join('|');
    expect(t).toContain('Copia immagine');
    expect(t).toContain('Apri in nuova tab');
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-menu')).toHaveCount(0, { timeout: 4000 });
  }
  // alternanza rapida miniatura → testo senza aspettare la chiusura:
  // il menu non deve restare "appiccicato" al bersaglio precedente
  await page.locator('#thumb').click({ button: 'right', position: { x: 8, y: 8 } });
  await page.locator('#plain').click({ button: 'right', position: { x: 4, y: 4 } });
  await expect(page.locator('.sn-menu')).toHaveCount(1);
  const t3 = (await labels(page.locator('.sn-menu'))).join('|');
  expect(t3).not.toContain('Copia immagine');
  expect(t3).not.toContain('Apri in nuova tab');
});

// F — link a un file (PDF) che avvolge una miniatura: convivono "Salva immagine
// come" e "Salva file", ognuno sul proprio bersaglio.
test('F: miniatura dentro un link a un PDF — compaiono sia Salva immagine sia Salva file', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, card('https://example.com/report.pdf'));
  const menu = await openMenuOn(page, '#thumb');
  const t = (await labels(menu)).join('|');
  expect(t).toContain('Salva immagine come');
  expect(t).toContain('Salva file');
});

// G — clic destro sul link ma FUORI dall'immagine: solo azioni del link.
test('G: clic destro sull\'area del link fuori dalla miniatura — solo azioni del collegamento', async ({ openTab, testServer }) => {
  const html = `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <a id="card" href="https://example.com/articolo" style="display:inline-block;padding:40px;background:#eee">
      <img id="thumb" src="${PX}" width="80" height="80" style="background:#e07b39">
    </a>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  const menu = await openMenuOn(page, '#card', { x: 6, y: 6 });
  const t = (await labels(menu)).join('|');
  expect(t).toContain('Apri in nuova tab');
  expect(t).not.toContain('Copia immagine');
});

// H — <a> senza href attorno all'immagine: nessuna voce link fantasma.
test('H: <a> senza href attorno alla miniatura — nessuna voce di collegamento', async ({ openTab, testServer }) => {
  const html = `<!doctype html><html><body style="padding:24px">
    <a id="card"><img id="thumb" src="${PX}" width="140" height="140" style="background:#e07b39"></a>
  </body></html>`;
  const page = await testServer.openReady(openTab, html);
  const menu = await openMenuOn(page, '#thumb');
  const t = (await labels(menu)).join('|');
  expect(t).toContain('Copia immagine');
  expect(t).not.toContain('Apri in nuova tab');
});

// I — <a href=""> (link vuoto, ricarica la pagina): non deve rompere il menu.
test('I: link con href vuoto attorno alla miniatura — menu costruito senza errori', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, card(''));
  const menu = await openMenuOn(page, '#thumb');
  const t = (await labels(menu)).join('|');
  expect(t).toContain('Copia immagine');
});
