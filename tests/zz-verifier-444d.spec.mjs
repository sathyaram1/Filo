// VERIFICA #444 round 4 — resa visiva e limiti di forma. Da cancellare.
import { test, expect } from './fixtures/electron.mjs';

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];
const has = (labels, needle) => labels.some((l) => l.includes(needle));

async function labelsOf(page) {
  await expect(page.locator('.sn-menu')).toBeVisible();
  return page.locator('.sn-menu button').allInnerTexts();
}
async function rc(page, x, y) { await page.mouse.move(x, y); await page.mouse.click(x, y, { button: 'right' }); }

const cardAt = (top) => `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <div style="position:relative;width:320px;height:200px;margin-left:40px;margin-top:${top}px">
    <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;background:#333"></video>
    <a id="l" href="https://example.com/file.pdf" style="position:absolute;inset:0;z-index:5"></a>
  </div>
  <div style="height:1200px"></div></body></html>`;

test('G1 — menu su una scheda-video in FONDO alla finestra: resta tutto raggiungibile', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, cardAt(20));
  const vp = page.viewportSize() || { width: 1280, height: 800 };
  await page.evaluate((h) => {
    const c = document.querySelector('div');
    c.style.marginTop = (h - 120) + 'px';
  }, vp.height);
  await page.waitForTimeout(150);
  const b = await page.locator('#clip').boundingBox();
  await rc(page, b.x + 60, b.y + 30);
  const labels = await labelsOf(page);
  await page.screenshot({ path: 'tests/.shots/v444-G1-fondo.png' }).catch(() => {});
  for (const l of LINK_LABELS) expect(has(labels, l), `manca "${l}" — ${labels}`).toBe(true);
  // Nessuna voce deve finire fuori dalla finestra.
  const fuori = await page.evaluate(() => {
    const m = document.querySelector('.sn-menu');
    if (!m) return 'nessun menu';
    const r = m.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight,
             scroll: m.scrollHeight > m.clientHeight + 1 };
  });
  console.log('G1 geometria menu:', JSON.stringify(fuori));
});

test('G2 — link a un FILE dentro una scheda-video: compare anche «Salva file»', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, cardAt(20));
  const b = await page.locator('#clip').boundingBox();
  await rc(page, b.x + 60, b.y + 30);
  const labels = await labelsOf(page);
  console.log('G2 labels:', JSON.stringify(labels));
  expect(has(labels, 'Salva file'), `${labels}`).toBe(true);
});

test('G3 — tema scuro: il menu della scheda-video resta leggibile', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' });
  });
  const page = await testServer.openReady(openTab, cardAt(40));
  await page.waitForTimeout(400);
  const b = await page.locator('#clip').boundingBox();
  await rc(page, b.x + 60, b.y + 30);
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v444-G3-scuro.png' }).catch(() => {});
  const labels = await labelsOf(page);
  for (const l of LINK_LABELS) expect(has(labels, l), `${labels}`).toBe(true);
});

test('G4 — riga di risultati con collegamento steso DIPINTO (sfumatura): cosa resta', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:30px;font:16px sans-serif">
    <div style="position:relative;width:760px;height:120px;display:flex;gap:16px;align-items:center">
      <video id="clip" src="/clip.mp4" style="width:170px;height:96px;background:#333;flex:none"></video>
      <div style="flex:1"><b>Titolo</b><p style="margin:6px 0 0">Descrizione.</p></div>
      <a id="l" href="https://example.com/riga" style="position:absolute;inset:0;z-index:5;background:linear-gradient(transparent,rgba(0,0,0,.35))"></a>
    </div></body></html>`);
  const b = await page.locator('#clip').boundingBox();
  await rc(page, b.x + b.width / 2, b.y + b.height / 2);
  const labels = await labelsOf(page);
  console.log('G4 labels:', JSON.stringify(labels));
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});

test('G5 — copertina come <div> con background-image (niente <img>) + link steso', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:30px;font:16px sans-serif">
    <div style="position:relative;width:320px;height:220px">
      <div id="cover" style="position:absolute;left:0;top:0;width:320px;height:180px;background-image:url(data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==);background-size:cover"></div>
      <video id="clip" src="/clip.mp4" style="position:absolute;left:0;top:0;width:320px;height:180px;background:#333"></video>
      <a id="l" href="https://example.com/scheda" style="position:absolute;inset:0;z-index:5"></a>
    </div></body></html>`);
  const b = await page.locator('#clip').boundingBox();
  await rc(page, b.x + b.width / 2, b.y + b.height / 2);
  const labels = await labelsOf(page);
  console.log('G5 labels:', JSON.stringify(labels));
  for (const l of LINK_LABELS) expect(has(labels, l), `${labels}`).toBe(true);
  for (const l of ['Copia URL video', 'Salva video come']) expect(has(labels, l), `manca media "${l}" — ${labels}`).toBe(true);
});

test('G6 — 120 veli trasparenti impilati sopra la scheda: il collegamento sopravvive', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <div style="position:relative;width:320px;height:200px;margin:40px">
      <a href="https://example.com/x" style="position:absolute;inset:0;z-index:1"></a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>
    </div>
    <script>for(let i=0;i<120;i++){const d=document.createElement('div');d.style.cssText='position:fixed;inset:0;z-index:'+(10+i);document.body.appendChild(d);}</script>
  </body></html>`);
  await page.waitForTimeout(200);
  await rc(page, 200, 140);
  const labels = await labelsOf(page);
  console.log('G6 labels:', JSON.stringify(labels));
});
