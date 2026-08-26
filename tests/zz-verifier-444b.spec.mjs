// VERIFICA #444 round 2 — pattern realistici. Da cancellare a fine verifica.
import { test, expect } from './fixtures/electron.mjs';

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];
const MEDIA_LABELS = ['Riproduci', 'Copia URL video', 'Salva video come'];

async function menuLabels(page) {
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu.locator('button').allInnerTexts();
}
async function rightClickAt(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.click(x, y, { button: 'right' });
}
const has = (labels, needle) => labels.some((l) => l.includes(needle));

// Riga di risultati: miniatura-filmato piccola a sinistra, testo a destra,
// il collegamento steso su tutta la riga con un ::after (il pattern più diffuso).
const rowAfter = `<!doctype html><html><body style="margin:0;padding:30px;font:16px sans-serif">
  <div class="row" style="position:relative;width:760px;height:120px;display:flex;gap:16px;align-items:center">
    <video id="clip" src="/clip.mp4" style="width:170px;height:96px;background:#333;flex:none"></video>
    <div style="flex:1">
      <a id="l" href="https://example.com/risultato" style="text-decoration:none;color:#123">Titolo del risultato</a>
      <p style="margin:6px 0 0;color:#555">Tre righe di descrizione che accompagnano il risultato, come su qualunque motore.</p>
    </div>
  </div>
  <style>.row a::after{content:"";position:absolute;inset:0}</style>
</body></html>`;

// Stessa riga, ma il collegamento è un <a> VUOTO steso sopra a tutto.
const rowOverlay = `<!doctype html><html><body style="margin:0;padding:30px;font:16px sans-serif">
  <div style="position:relative;width:760px;height:120px;display:flex;gap:16px;align-items:center">
    <video id="clip" src="/clip.mp4" style="width:170px;height:96px;background:#333;flex:none"></video>
    <div style="flex:1"><b>Titolo del risultato</b><p style="margin:6px 0 0;color:#555">Descrizione.</p></div>
    <a id="l" href="https://example.com/risultato" style="position:absolute;inset:0;z-index:5"></a>
  </div>
</body></html>`;

// Scheda social: player vero (controls) dentro il link, l'overlay del player in
// shadow DOM intercetta il clic.
const playerCard = `<!doctype html><html><body style="margin:0;padding:30px">
  <a id="l" href="https://example.com/post"><video id="clip" src="/clip.mp4" controls style="width:360px;height:200px;background:#333;display:block"></video></a>
</body></html>`;

test('D1 — riga di risultati, link steso con ::after: filmato E collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, rowAfter);
  const b = await page.locator('#clip').boundingBox();
  await rightClickAt(page, b.x + b.width / 2, b.y + b.height / 2);
  const labels = await menuLabels(page);
  await page.screenshot({ path: 'tests/.shots/v444-D1.png' }).catch(() => {});
  for (const l of MEDIA_LABELS) expect(has(labels, l), `manca media "${l}" — ${labels}`).toBe(true);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});

test('D1b — la stessa riga, cliccando sul TESTO: stesse voci del collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, rowAfter);
  const b = await page.locator('#l').boundingBox();
  await rightClickAt(page, b.x + b.width / 2, b.y + b.height / 2);
  const labels = await menuLabels(page);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
  console.log('D1b labels:', JSON.stringify(labels));
});

test('D2 — riga di risultati, <a> vuoto steso sopra: filmato E collegamento', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, rowOverlay);
  const b = await page.locator('#clip').boundingBox();
  await rightClickAt(page, b.x + b.width / 2, b.y + b.height / 2);
  const labels = await menuLabels(page);
  await page.screenshot({ path: 'tests/.shots/v444-D2.png' }).catch(() => {});
  for (const l of MEDIA_LABELS) expect(has(labels, l), `manca media "${l}" — ${labels}`).toBe(true);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});

test('D3 — player vero con controls dentro un link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, playerCard);
  const b = await page.locator('#clip').boundingBox();
  await rightClickAt(page, b.x + b.width / 2, b.y + b.height / 2 - 30);
  const labels = await menuLabels(page);
  for (const l of MEDIA_LABELS) expect(has(labels, l), `manca media "${l}" — ${labels}`).toBe(true);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});

test('D4 — "Copia URL" sul menu di una scheda a strati copia l\'href della SCHEDA', async ({ app, openTab, testServer }) => {
  const href = 'https://example.com/scheda-a-strati';
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px">
    <div style="position:relative;width:320px;height:180px">
      <a id="l" href="${href}" style="position:absolute;inset:0;z-index:1"></a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>
      <span style="position:absolute;inset:0;z-index:3;background:rgba(0,0,0,.02)"></span>
    </div></body></html>`);
  await rightClickAt(page, 40 + 160, 40 + 90);
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'video' }).first().click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 8000 }).toBe(href);
});

test('D5 — "Salva link per dopo" agisce sulla scheda adottata (non fallisce)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px">
    <div style="position:relative;width:320px;height:180px">
      <a id="l" href="https://example.com/da-salvare" style="position:absolute;inset:0;z-index:1"></a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>
      <span style="position:absolute;inset:0;z-index:3;background:rgba(0,0,0,.02)"></span>
    </div></body></html>`);
  await rightClickAt(page, 40 + 160, 40 + 90);
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await menu.locator('button', { hasText: 'Salva link per dopo' }).first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tests/.shots/v444-D5-save.png' }).catch(() => {});
  const toast = await page.evaluate(() => document.body.innerText.includes('Salvato') || !!document.querySelector('.sn-toast'));
  console.log('D5 toast:', toast);
});

test('D6 — banner cookie opaco sopra una scheda-video: nessuna voce rubata', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
    <div style="position:relative;width:320px;height:180px">
      <a id="l" href="https://malizioso.example/scheda" style="position:absolute;inset:0;z-index:1"></a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>
    </div>
    <div id="cookie" style="position:fixed;left:0;right:0;bottom:0;top:0;background:#fff;z-index:99;padding:20px">Usiamo i cookie</div>
  </body></html>`);
  await rightClickAt(page, 40 + 160, 40 + 90);
  const labels = await menuLabels(page);
  for (const l of LINK_LABELS) expect(has(labels, l), `RUBATO dal banner: "${l}" — ${labels}`).toBe(false);
  for (const l of ['Copia URL video']) expect(has(labels, l), `RUBATO dal banner: "${l}" — ${labels}`).toBe(false);
});

test('D7 — testo selezionato sopra una scheda-video: vince la selezione', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
    <div style="position:relative;width:400px;height:180px">
      <a id="l" href="https://example.com/scheda" style="position:absolute;inset:0;z-index:1"></a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>
      <p id="cap" style="position:absolute;left:0;bottom:-40px;z-index:3">Una didascalia selezionabile</p>
    </div></body></html>`);
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('cap'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  const b = await page.locator('#cap').boundingBox();
  await rightClickAt(page, b.x + 10, b.y + b.height / 2);
  const labels = await menuLabels(page);
  console.log('D7 labels:', JSON.stringify(labels));
  expect(has(labels, 'Cerca'), `${labels}`).toBe(true);
});
