// VERIFICA #444 — spec del verificatore, scritto black-box dal sintomo utente.
// Va cancellato a fine verifica.
import { test, expect } from './fixtures/electron.mjs';

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];
const MEDIA_LABELS = ['Riproduci', 'Velocità', 'Ripeti in continuo', 'Copia URL video', 'Salva video come'];

async function menuLabels(page) {
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu.locator('button').allInnerTexts();
}

async function rightClickAt(page, x, y) {
  await page.mouse.move(x, y);
  await page.mouse.click(x, y, { button: 'right' });
}

function has(labels, needle) {
  return labels.some((l) => l.includes(needle));
}

// ---------------------------------------------------------------
// 1) IL SINTOMO: anteprima video dentro un collegamento
// ---------------------------------------------------------------

// (a) filmato annidato nell'<a>
const nested = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <a id="card" href="https://example.com/scheda"><video id="clip" src="/clip.mp4" width="320" height="180" style="background:#333;display:block"></video></a>
</body></html>`;

// (b) la forma delle home video/social: il link della scheda sta SOTTO, la
// copertina e l'anteprima si stendono sopra, e sopra a tutto un velo trasparente
// che regge il titolo. NON annidati.
const layered = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <div id="card" style="position:relative;width:320px;height:220px">
    <a id="link" href="https://example.com/scheda" style="position:absolute;inset:0;z-index:1;color:#000;text-decoration:none"><span style="position:absolute;bottom:4px;left:4px">Titolo della scheda</span></a>
    <img id="cover" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" style="position:absolute;left:0;top:0;width:320px;height:180px;z-index:2;background:#456">
    <video id="clip" src="/clip.mp4" style="position:absolute;left:0;top:0;width:320px;height:180px;z-index:3;background:#333;display:none"></video>
    <span id="veil" style="position:absolute;left:0;top:0;width:320px;height:180px;z-index:4;background:rgba(0,0,0,.02)"></span>
  </div>
  <script>
    window.startPreview = () => { document.getElementById('clip').style.display = 'block'; };
    window.stopPreview = () => { document.getElementById('clip').style.display = 'none'; };
  </script>
</body></html>`;

test('A1 — filmato annidato in un link: media + link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, nested);
  await page.locator('#clip').click({ button: 'right', position: { x: 40, y: 40 } });
  const labels = await menuLabels(page);
  for (const l of MEDIA_LABELS) expect(has(labels, l), `manca media "${l}" — ${labels}`).toBe(true);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});

test('A2 — anteprima STESA SOPRA il link della scheda (velo in cima): media + link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, layered);
  await page.evaluate(() => window.startPreview());
  const box = await page.locator('#clip').boundingBox();
  await rightClickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const labels = await menuLabels(page);
  await page.screenshot({ path: 'tests/.shots/v444-A2-preview-on.png' }).catch(() => {});
  for (const l of MEDIA_LABELS) expect(has(labels, l), `manca media "${l}" — ${labels}`).toBe(true);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});

test('A3 — STESSO PIXEL con anteprima ferma: il menu non deve svuotarsi', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, layered);
  await page.evaluate(() => window.stopPreview());
  const box = await page.locator('#cover').boundingBox();
  await rightClickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const labels = await menuLabels(page);
  await page.screenshot({ path: 'tests/.shots/v444-A3-preview-off.png' }).catch(() => {});
  for (const l of ['Copia immagine', 'Salva immagine come']) expect(has(labels, l), `manca img "${l}" — ${labels}`).toBe(true);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});

test('A4 — audio-anteprima stesa sopra il link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px">
    <div style="position:relative;width:320px;height:180px">
      <a href="https://example.com/podcast" style="position:absolute;inset:0;z-index:1">episodio</a>
      <audio id="pod" src="/pod.mp3" style="position:absolute;left:0;top:0;width:320px;height:180px;z-index:2;background:#333"></audio>
    </div></body></html>`);
  const box = await page.locator('#pod').boundingBox();
  await rightClickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const labels = await menuLabels(page);
  expect(has(labels, 'Copia URL audio'), `${labels}`).toBe(true);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});

// ---------------------------------------------------------------
// 2) ADVERSARIALE: quello che NON deve essere adottato
// ---------------------------------------------------------------

test('B1 — barra fissa opaca sopra dei titoli: il menu NON deve parlare del link sepolto', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;height:2000px;font:16px sans-serif">
    <div id="bar" style="position:fixed;top:0;left:0;right:0;height:60px;background:#fff;z-index:99">Barra del sito</div>
    <div style="padding-top:20px"><a id="buried" href="https://malizioso.example/nascosto">Titolo scivolato sotto la barra</a></div>
  </body></html>`);
  await rightClickAt(page, 300, 30);
  const labels = await menuLabels(page);
  for (const l of LINK_LABELS) expect(has(labels, l), `ADOTTATO un link sepolto: "${l}" — ${labels}`).toBe(false);
});

test('B2 — manto invisibile a tutta pagina sopra un paragrafo con link', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <p style="padding:200px 20px 20px">testo normale</p>
    <a id="l" href="https://malizioso.example/mantello" style="position:absolute;left:20px;top:210px">link piccolo</a>
    <div id="manto" style="position:fixed;inset:0;z-index:99"></div>
  </body></html>`);
  await rightClickAt(page, 600, 500);
  const labels = await menuLabels(page);
  for (const l of LINK_LABELS) expect(has(labels, l), `ADOTTATO link sotto il manto: "${l}" — ${labels}`).toBe(false);
});

test('B3 — video di sfondo a tutta pagina: cliccando un link normale niente comandi del filmato', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;font:16px sans-serif">
    <video id="bg" src="/bg.mp4" style="position:fixed;inset:0;width:100%;height:100%;z-index:0;background:#111"></video>
    <a id="l" href="https://example.com/vero" style="position:relative;z-index:5;display:inline-block;margin:200px;background:#fff;padding:8px">Un collegamento normale</a>
  </body></html>`);
  const box = await page.locator('#l').boundingBox();
  await rightClickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const labels = await menuLabels(page);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
  for (const l of ['Copia URL video', 'Salva video come']) expect(has(labels, l), `INTRUSO video di sfondo: "${l}" — ${labels}`).toBe(false);
});

test('B4 — due schede diverse impilate: il menu non deve mischiare filmato di A e link di B', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
    <div style="position:relative;width:900px;height:400px">
      <a id="altro" href="https://altra.example/scheda-B" style="position:absolute;left:0;top:0;width:900px;height:400px;z-index:1">scheda B larga</a>
      <video id="clip" src="/clip.mp4" style="position:absolute;left:600px;top:300px;width:120px;height:70px;z-index:2;background:#333"></video>
    </div></body></html>`);
  const box = await page.locator('#clip').boundingBox();
  await rightClickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const labels = await menuLabels(page);
  await page.screenshot({ path: 'tests/.shots/v444-B4.png' }).catch(() => {});
  console.log('B4 labels:', JSON.stringify(labels));
});

// ---------------------------------------------------------------
// 3) INPUT LIMITE
// ---------------------------------------------------------------

test('C1 — href javascript: dentro una scheda a strati', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px">
    <div style="position:relative;width:320px;height:180px">
      <a id="l" href="javascript:alert(1)" style="position:absolute;inset:0;z-index:1">x</a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>
    </div></body></html>`);
  const box = await page.locator('#clip').boundingBox();
  await rightClickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const labels = await menuLabels(page);
  console.log('C1 labels:', JSON.stringify(labels));
});

test('C2 — href lunghissimo (10k) e titolo con HTML: il menu regge', async ({ openTab, testServer }) => {
  const long = 'x'.repeat(10000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px">
    <div style="position:relative;width:320px;height:180px">
      <a id="l" href="https://example.com/${long}" title="&lt;script&gt;alert(1)&lt;/script&gt;" style="position:absolute;inset:0;z-index:1">&lt;script&gt;alert(1)&lt;/script&gt;</a>
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>
    </div></body></html>`);
  const box = await page.locator('#clip').boundingBox();
  await rightClickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  const labels = await menuLabels(page);
  await page.screenshot({ path: 'tests/.shots/v444-C2-long-href.png' }).catch(() => {});
  for (const l of LINK_LABELS) expect(has(labels, l), `${labels}`).toBe(true);
  const noScript = await page.evaluate(() => !document.querySelector('.sn-menu script'));
  expect(noScript).toBe(true);
});

test('C3 — aperture rapide ripetute sullo stesso pixel: esito stabile', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, layered);
  await page.evaluate(() => window.startPreview());
  const box = await page.locator('#clip').boundingBox();
  const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    await rightClickAt(page, cx, cy);
    const labels = await menuLabels(page);
    seen.push(labels.length);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
  }
  console.log('C3 conteggi:', JSON.stringify(seen));
  expect(new Set(seen).size, `menu instabile: ${seen}`).toBe(1);
});

test('C4 — alternanza anteprima ON/OFF sullo stesso pixel: il link non sparisce mai', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, layered);
  const box = await page.locator('#cover').boundingBox();
  const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
  for (let i = 0; i < 4; i++) {
    await page.evaluate((on) => (on ? window.startPreview() : window.stopPreview()), i % 2 === 0);
    await page.waitForTimeout(80);
    await rightClickAt(page, cx, cy);
    const labels = await menuLabels(page);
    for (const l of LINK_LABELS) expect(has(labels, l), `giro ${i} (anteprima ${i % 2 === 0 ? 'ON' : 'OFF'}) manca "${l}" — ${labels}`).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(60);
  }
});

test('C5 — scheda a strati DENTRO uno shadow root', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px">
    <div id="host"></div>
    <script>
      const r = document.getElementById('host').attachShadow({ mode: 'open' });
      r.innerHTML = '<div style="position:relative;width:320px;height:180px">'
        + '<a id="l" href="https://example.com/shadow" style="position:absolute;inset:0;z-index:1">t</a>'
        + '<video id="clip" src="/clip.mp4" style="position:absolute;inset:0;z-index:2;background:#333"></video>'
        + '<span style="position:absolute;inset:0;z-index:3;background:rgba(0,0,0,.02)"></span></div>';
    </script></body></html>`);
  await rightClickAt(page, 40 + 160, 40 + 90);
  const labels = await menuLabels(page);
  await page.screenshot({ path: 'tests/.shots/v444-C5-shadow.png' }).catch(() => {});
  for (const l of MEDIA_LABELS) expect(has(labels, l), `manca media "${l}" — ${labels}`).toBe(true);
  for (const l of LINK_LABELS) expect(has(labels, l), `manca link "${l}" — ${labels}`).toBe(true);
});
