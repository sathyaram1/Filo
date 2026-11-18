// Verifica #2374 giro 1, rilievo 1: una selezione che passa da una riga all'altra del riquadro di Trascrivi si copia
// con le righe separate, e senza le scritte dei tasti del riquadro.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const W = 600;
const H = 140;
const RIGHE = [['Fattura numero 4821', 20, 50], ['Totale 1250 euro', 20, 110]];
const PX = 32;

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Fattura</title></head>
<body style="margin:0;padding:60px 40px;background:#eee">
<img id="foto" width="${W}" height="${H}" alt="fattura">
<script>
  const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${W}, ${H});
  g.fillStyle = '#222'; g.font = '${PX}px sans-serif';
  const R = ${JSON.stringify(RIGHE)};
  for (const [t, x, y] of R) g.fillText(t, x, y);
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misure = R.map(([t, x, y]) => ({ t, x, y, w: g.measureText(t).width, prima: g.measureText('Fattura ').width }));
</script></body></html>`;

async function lettoreFinto(app, righe) {
  await app.evaluate(async (_e, { righe }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSCRIBE_IMAGE]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.__veri || (globalThis.__veri = { c: globalThis.SN_PROVIDERS.completeWithFallback, s: globalThis.SN_PROVIDERS.streamCompleteWithFallback });
    const finto = (vero) => async (opts) => {
      if (!JSON.stringify(opts.messages || '').includes('Trascrivi ESATTAMENTE il testo')) return vero(opts);
      return { text: JSON.stringify({ righe }), model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto(P.c);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto(P.s);
  }, { righe });
}

async function apri(app, openTab, testServer) {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misure);
  const m = await page.evaluate(() => window.misure);
  await lettoreFinto(app, m.map((r) => ({
    testo: r.t,
    x1: Math.round((r.x / W) * 1000), y1: Math.round(((r.y - PX) / H) * 1000),
    x2: Math.round(((r.x + r.w) / W) * 1000), y2: Math.round(((r.y + 9) / H) * 1000),
  })));
  const box = await page.locator('#foto').boundingBox();
  await page.locator('#foto').click({ button: 'right', position: { x: 10, y: 10 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  return { strato, box, m };
}

// Da «numero» della prima riga a metà della seconda: è il pezzo che serve, su due righe.
async function selezionaDueRighe(strato, box, m) {
  await strato.mouse.move(box.x + 20 + m[0].prima + 1, box.y + 40);
  await strato.mouse.down();
  await strato.mouse.move(box.x + 20 + 200, box.y + 100, { steps: 6 });
  await strato.mouse.up();
}

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const vuota = (app) => app.evaluate(({ clipboard }) => clipboard.writeText('prima'));

test('r1 una selezione su due righe, copiata con Ctrl+C, tiene le righe separate', async ({ app, openTab, testServer }) => {
  const { strato, box, m } = await apri(app, openTab, testServer);
  await vuota(app);
  await selezionaDueRighe(strato, box, m);
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).not.toBe('prima');
  const copiato = await appunti(app);
  expect(copiato.startsWith('numero 4821')).toBe(true);
  expect(copiato).toMatch(/4821\s+Totale/);
});

test('r1 la stessa selezione copiata dal tasto destro tiene le righe separate', async ({ app, openTab, testServer }) => {
  const { strato, box, m } = await apri(app, openTab, testServer);
  await vuota(app);
  await selezionaDueRighe(strato, box, m);
  await strato.mouse.click(box.x + 20 + m[0].prima + 30, box.y + 40, { button: 'right' });
  const menu = menuDi(strato).locator('.sn-menu').first();
  await expect(menu).toBeVisible({ timeout: 5000 });
  await menu.locator('button', { hasText: /^Copia$/ }).first().click();
  await expect.poll(() => appunti(app), { timeout: 5000 }).not.toBe('prima');
  expect(await appunti(app)).toMatch(/4821\s+Totale/);
});

test('r1 Ctrl+A e Ctrl+C nel riquadro copiano il testo dell\'immagine, a righe, senza la scritta del tasto', async ({ app, openTab, testServer }) => {
  const { strato } = await apri(app, openTab, testServer);
  await vuota(app);
  await strato.keyboard.press('ControlOrMeta+a');
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).not.toBe('prima');
  const copiato = await appunti(app);
  expect(copiato).not.toContain('Copia tutto');
  expect(copiato).toMatch(/^Fattura numero 4821\s+Totale 1250 euro$/);
});
