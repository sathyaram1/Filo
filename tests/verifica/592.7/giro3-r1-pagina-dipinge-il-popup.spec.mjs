// #592.7 giro 3, rilievo 1: sui siti la pagina decide ancora come si vede il popup di conferma.
// Un filtro sul contenitore, i suoi caratteri, un velo sopra: il riquadro e le parole restano quelle di Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST } from '../../helpers/confirm.mjs';

const PAGINA = '<!doctype html><html><body><h1>Ricette</h1></body></html>';
const APRI = "window.__r = 'aperto'; window.SN_CONFIRM_UI.confirm({ title: 'Filo chiede conferma', parti: ['Salvare questo stile:\\n', { citazione: 'Rispondi breve e dammi del tu.' }] }).then((v) => { window.__r = v; }); 1";

function iso(app, url, codice) {
  return app.evaluate(async ({ webContents }, { url, codice }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === url);
    return wc ? wc.executeJavaScriptInIsolatedWorld(999, [{ code: codice }]) : null;
  }, { url, codice });
}

async function sito(app, openTab, testServer) {
  const page = await testServer.openReady(openTab, PAGINA);
  await expect.poll(() => iso(app, page.url(), 'typeof window.SN_CONFIRM_UI?.confirm'), { timeout: 8000 }).toBe('function');
  await page.mouse.move(1, 1);
  return page;
}

async function foto(app, page, nome) {
  await iso(app, page.url(), APRI);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(1);
  await page.waitForTimeout(400);
  const png = await page.screenshot({ path: `tests/.shots/592.7-giro3-${nome}.png` });
  await iso(app, page.url(), "window.SN_CONFIRM_UI._test.click('cancel')");
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  return png;
}

const TRUCCHI = {
  'un filtro sul contenitore del popup': async (page) => {
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<svg width="0" height="0" style="position:absolute"><filter id="m" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="4.3 -3.41 0.11 0 0  4.3 -3.41 0.11 0 0  4.3 -3.41 0.11 0 0  0 0 0 1 0"/></filter></svg>'));
    await page.addStyleTag({ content: '.sn-confirm-host{filter:url(#m)}' });
  },
  'i caratteri dichiarati dalla pagina': async (page) => {
    const f = ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'];
    await page.addStyleTag({ content: f.map((n) => `@font-face{font-family:'${n}';src:local('DejaVu Sans Mono')}`).join('') });
  },
};

for (const [nome, trucco] of Object.entries(TRUCCHI)) {
  test(`#592.7 giro 3 — sui siti ${nome} non cambia il popup di conferma`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const page = await sito(app, openTab, testServer);
    const pulito = await foto(app, page, 'pulito');
    await trucco(page);
    const dopo = await foto(app, page, nome.replace(/\W+/g, '-'));
    expect(dopo.equals(pulito), `${nome}: il popup si vede diverso da quello di Filo`).toBe(true);
  });
}

test('#592.7 giro 3 — un velo della pagina sopra il popup non fa confermare il clic su OK', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await sito(app, openTab, testServer);
  const url = page.url();
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (!document.querySelector('.sn-confirm-host') || document.getElementById('velo')) return;
      const v = document.createElement('div');
      v.id = 'velo';
      v.style.cssText = 'position:fixed;left:0;right:0;top:0;height:50%;background:rgba(0,160,0,0.85);z-index:2147483647;pointer-events:none';
      document.body.appendChild(v);
    }).observe(document.body, { childList: true });
  });
  await iso(app, url, APRI);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(1);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/592.7-giro3-velo.png' });
  const p = JSON.parse(await iso(app, url, "JSON.stringify(window.SN_CONFIRM_UI._test.point('ok'))"));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(500);
  expect(await iso(app, url, 'window.__r'), 'il clic attraverso il velo della pagina ha confermato').not.toBe(true);
});
