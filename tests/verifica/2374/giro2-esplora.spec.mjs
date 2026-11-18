// Verifica #2374 giro 2: esplorazione (parole nel loro punto con un font diverso, menu della selezione, aspetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const W = 760;
const H = 140;
const PX = 26;

function pagina(font, righe) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Scontrino</title></head>
<body style="margin:0;padding:60px 20px;background:#eee">
<img id="foto" width="${W}" height="${H}" alt="scontrino">
<script>
  const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${W}, ${H});
  g.fillStyle = '#222'; g.font = '${PX}px ${font}';
  const R = ${JSON.stringify(righe)};
  for (const [t, x, y] of R) g.fillText(t, x, y);
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misura = (s) => g.measureText(s).width;
  window.misure = R.map(([t, x, y]) => ({ t, x, y, w: g.measureText(t).width }));
</script></body></html>`;
}

async function lettoreFinto(app, righe, tema = 'light') {
  await app.evaluate(async (_e, { righe, tema }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSCRIBE_IMAGE]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: tema,
    });
    const P = globalThis.__veri || (globalThis.__veri = { c: globalThis.SN_PROVIDERS.completeWithFallback, s: globalThis.SN_PROVIDERS.streamCompleteWithFallback });
    const finto = (vero) => async (opts) => {
      if (!JSON.stringify(opts.messages || '').includes('Trascrivi ESATTAMENTE il testo')) return vero(opts);
      return { text: JSON.stringify({ righe }), model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto(P.c);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto(P.s);
  }, { righe, tema });
}

async function apri(app, openTab, testServer, font, righe, tema) {
  const page = await testServer.openReady(openTab, pagina(font, righe));
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misure);
  const m = await page.evaluate(() => window.misure);
  await lettoreFinto(app, m.map((r) => ({
    testo: r.t,
    x1: Math.round((r.x / W) * 1000), y1: Math.round(((r.y - PX) / H) * 1000),
    x2: Math.round(((r.x + r.w) / W) * 1000), y2: Math.round(((r.y + 7) / H) * 1000),
  })), tema);
  const box = await page.locator('#foto').boundingBox();
  await page.locator('#foto').click({ button: 'right', position: { x: 5, y: 5 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  return { page, strato, box, m };
}

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const vuota = (app) => app.evaluate(({ clipboard }) => clipboard.writeText('prima'));

// Uno scontrino, in caratteri a larghezza fissa: si trascina dall'inizio alla fine di «INTEGRALE» come appare.
for (const font of ['monospace', 'serif']) {
  test(`esplora: una parola trascinata come appare nell'immagine (${font})`, async ({ app, openTab, testServer }) => {
    const riga = 'PANE INTEGRALE KG 0,350 EUR 1,40 IVA 4%';
    const { page, strato, box, m } = await apri(app, openTab, testServer, font, [[riga, 20, 50], ['TOTALE COMPLESSIVO 12,50', 20, 110]]);
    const prima = await page.evaluate(() => window.misura('PANE '));
    const lunga = await page.evaluate(() => window.misura('INTEGRALE'));
    const dopo = await page.evaluate(() => window.misura('PANE INTEGRALE KG 0,350 EUR '));
    const prezzo = await page.evaluate(() => window.misura('1,40'));
    // Dove cadono le parole nel riquadro, rispetto a dove sono disegnate.
    const scarti = await strato.locator('.sn-tr-riga').first().evaluate((n, parole) => {
      const t = n.firstChild; const out = {};
      for (const p of parole) {
        const i = t.data.indexOf(p); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + p.length);
        const q = r.getBoundingClientRect(); out[p] = { x: q.left, w: q.width };
      }
      return out;
    }, ['INTEGRALE', '1,40']);
    const scena = await strato.locator('.sn-tr-scena').boundingBox();
    console.log(font, 'INTEGRALE disegnata', box.x + 20 + prima, 'nel testo', scarti.INTEGRALE.x, '| 1,40 disegnata', box.x + 20 + dopo, 'nel testo', scarti['1,40'].x, '| scena', scena.x, box.x);
    await vuota(app);
    await strato.mouse.move(box.x + 20 + prima + 2, box.y + 40);
    await strato.mouse.down();
    await strato.mouse.move(box.x + 20 + prima + lunga - 2, box.y + 40, { steps: 6 });
    await strato.mouse.up();
    await strato.screenshot({ path: `tests/.shots/2374-g2-${font}.png` });
    await strato.keyboard.press('ControlOrMeta+c');
    await expect.poll(() => appunti(app), { timeout: 5000 }).not.toBe('prima');
    const preso = await appunti(app);
    console.log(font, 'copiato:', JSON.stringify(preso));
    await vuota(app);
    await strato.mouse.move(box.x + 20 + dopo + 1, box.y + 40);
    await strato.mouse.down();
    await strato.mouse.move(box.x + 20 + dopo + prezzo - 1, box.y + 40, { steps: 6 });
    await strato.mouse.up();
    await strato.keyboard.press('ControlOrMeta+c');
    await expect.poll(() => appunti(app), { timeout: 5000 }).not.toBe('prima');
    console.log(font, 'prezzo copiato:', JSON.stringify(await appunti(app)));
    expect(preso).toBe('INTEGRALE');
  });
}

test('esplora: menu della selezione e aspetto nei due temi', async ({ app, openTab, testServer }) => {
  for (const tema of ['light', 'dark']) {
    const { strato, box } = await apri(app, openTab, testServer, 'sans-serif', [['Fattura numero 4821', 20, 50], ['Totale 1250 euro', 20, 110]], tema);
    await strato.mouse.dblclick(box.x + 60, box.y + 40);
    await strato.screenshot({ path: `tests/.shots/2374-g2-${tema}.png` });
    await strato.mouse.click(box.x + 60, box.y + 40, { button: 'right' });
    const menu = menuDi(strato).locator('.sn-menu').first();
    await expect(menu).toBeVisible({ timeout: 5000 });
    const voci = await menu.locator('button').allInnerTexts();
    console.log(tema, 'voci:', JSON.stringify(voci));
    await strato.screenshot({ path: `tests/.shots/2374-g2-${tema}-menu.png` });
    await strato.keyboard.press('Escape');
    await strato.keyboard.press('Escape');
    await expect(strato.locator('.sn-tr-overlay')).toHaveCount(0);
  }
});
