// VERIFICA #444 round 5 — velo a tutta finestra sopra le forme reali di scheda.
import { test, expect } from './fixtures/electron.mjs';

const LINK_LABELS = ['Apri in nuova tab', 'Copia URL', 'Salva link per dopo', 'Condividi link'];
const MEDIA = ['Copia URL video', 'Salva video come'];
const has = (l, n) => l.some((x) => x.includes(n));
async function labelsOf(page) {
  await expect(page.locator('.sn-menu')).toBeVisible();
  return page.locator('.sn-menu button').allInnerTexts();
}
async function rc(page, x, y) { await page.mouse.move(x, y); await page.mouse.click(x, y, { button: 'right' }); }

const veloPagina = '<div id="velo" style="position:fixed;inset:0;z-index:999"></div>';

// Forma 1 (la più comune): copertina e anteprima ANNIDATE nel collegamento.
const annidata = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <a id="l" href="https://example.com/scheda" style="display:block;width:320px;text-decoration:none;color:#000">
    <span style="position:relative;display:block;width:320px;height:180px">
      <img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" style="position:absolute;inset:0;width:320px;height:180px;background:#456">
      <video id="clip" src="/clip.mp4" style="position:absolute;inset:0;width:320px;height:180px;background:#333"></video>
    </span>
    <span style="display:block;padding:8px 0">Titolo della scheda</span>
  </a>${veloPagina}</body></html>`;

// Forma 2: collegamento STESO SOPRA la copertina, dentro la scheda.
const stesa = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <div style="position:relative;width:320px;height:220px">
    <img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" style="position:absolute;left:0;top:0;width:320px;height:180px;background:#456">
    <video id="clip" src="/clip.mp4" style="position:absolute;left:0;top:0;width:320px;height:180px;background:#333"></video>
    <span style="position:absolute;left:0;bottom:0;height:36px">Titolo</span>
    <a id="l" href="https://example.com/scheda" style="position:absolute;inset:0;z-index:5"></a>
  </div>${veloPagina}</body></html>`;

// Forma 3 (quella che in G6 perdeva il link): collegamento SOTTO la copertina.
const sotto = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <div style="position:relative;width:320px;height:220px">
    <a id="l" href="https://example.com/scheda" style="position:absolute;inset:0;z-index:1"></a>
    <video id="clip" src="/clip.mp4" style="position:absolute;left:0;top:0;width:320px;height:180px;z-index:2;background:#333"></video>
  </div>${veloPagina}</body></html>`;

for (const [nome, html] of [['annidata', annidata], ['stesa sopra', stesa], ['sotto la copertina', sotto]]) {
  test(`H — velo a tutta finestra sopra una scheda «${nome}»`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, html);
    await page.waitForTimeout(200);
    const b = await page.locator('#clip').boundingBox();
    await rc(page, b.x + b.width / 2, b.y + b.height / 2);
    const labels = await labelsOf(page);
    const link = LINK_LABELS.filter((l) => has(labels, l));
    const media = MEDIA.filter((l) => has(labels, l));
    console.log(`H[${nome}] link=${link.length}/4 media=${media.length}/2`);
    await page.screenshot({ path: `tests/.shots/v444-H-${nome.replace(/ /g, '-')}.png` }).catch(() => {});
    expect(link.length, `link mancanti su «${nome}» — ${labels}`).toBe(4);
  });
}

// Senza velo, la forma 3 funziona? (controprova per capire se il colpevole è il velo)
test('H4 — forma «sotto la copertina» SENZA velo di pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, sotto.replace(veloPagina, ''));
  const b = await page.locator('#clip').boundingBox();
  await rc(page, b.x + b.width / 2, b.y + b.height / 2);
  const labels = await labelsOf(page);
  console.log('H4 link:', LINK_LABELS.filter((l) => has(labels, l)).length + '/4');
  expect(LINK_LABELS.filter((l) => has(labels, l)).length).toBe(4);
});
