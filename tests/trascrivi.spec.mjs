// #2374 — Trascrivi lascia la porzione a schermo con sopra il suo testo, selezionabile come in un PDF: si copia solo la
// parola che serve, «Copia tutto» copia tutto, e il tasto destro su un'immagine apre lo stesso riquadro.
// Su un sito il riquadro sta nello strato sopra la scheda: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';
import { paginaDelloStrato } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const W = 600;
const H = 160;
const RIGHE = [['Fattura numero 4821', 20, 56], ['Totale 1250 euro', 20, 126]];
const FONT = '32px sans-serif';

// Un testo noto disegnato dentro un'immagine: le parole non sono nel DOM, solo nei pixel.
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Fattura</title></head>
<body style="margin:0;padding:60px 40px;font:16px sans-serif;background:#eee">
<img id="foto" width="${W}" height="${H}" alt="fattura">
<script>
  const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${W}, ${H});
  g.fillStyle = '#222'; g.font = '${FONT}';
  for (const [t, x, y] of ${JSON.stringify(RIGHE)}) g.fillText(t, x, y);
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misure = ${JSON.stringify(RIGHE)}.map(([t, x, y]) => ({ t, x, y, w: g.measureText(t).width, parola: g.measureText('Fattura numero ').width, quattro: g.measureText('4821').width }));
</script></body></html>`;

// Il lettore finto risponde come quello vero: le righe col riquadro in 0..1000 dell'immagine.
async function lettoreFinto(app, righe, { attesaMs = 0, tema = 'light' } = {}) {
  await app.evaluate(async (_e, { righe, attesaMs, tema }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSCRIBE_IMAGE]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: tema,
    });
    globalThis.__letture = [];
    const P = globalThis.__veri || (globalThis.__veri = { c: globalThis.SN_PROVIDERS.completeWithFallback, s: globalThis.SN_PROVIDERS.streamCompleteWithFallback });
    const finto = (vero) => async (opts) => {
      const t = JSON.stringify(opts.messages || '');
      if (!t.includes('Trascrivi ESATTAMENTE il testo')) return vero(opts);
      globalThis.__letture.push({ immagine: /data:image\/(png|jpeg)/.test(t) });
      if (attesaMs) await new Promise((r) => setTimeout(r, attesaMs));
      return { text: JSON.stringify({ righe }), model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto(P.c);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto(P.s);
  }, { righe, attesaMs, tema });
}

async function apri(app, openTab, testServer, opz) {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misure);
  const m = await page.evaluate(() => window.misure);
  const righe = m.map((r) => ({
    testo: r.t,
    x1: Math.round((r.x / 600) * 1000), y1: Math.round(((r.y - 28) / 160) * 1000),
    x2: Math.round(((r.x + r.w) / 600) * 1000), y2: Math.round(((r.y + 8) / 160) * 1000),
  }));
  await lettoreFinto(app, righe, opz);
  return { page, m, righe };
}

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());
const letture = (app) => app.evaluate(() => globalThis.__letture.length);

test('Trascrivi dalla barra: la porzione resta a schermo, una parola selezionata si copia da sola, «Copia tutto» copia tutto', async ({ app, openTab, testServer }) => {
  const { page, m } = await apri(app, openTab, testServer);
  const box = await page.locator('#foto').boundingBox();
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));

  await premiNellaBarra(app, 'transcribe');
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 10_000 });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 4 });
  await page.mouse.up();

  const strato = await paginaDelloStrato(app, page);
  const riquadro = strato.locator('.sn-tr-overlay.sn-tr-pronto');
  await expect(riquadro).toBeVisible({ timeout: 10_000 });
  expect(await letture(app)).toBe(1);
  await expect(strato.locator('.sn-tr-riga')).toHaveText(['Fattura numero 4821', 'Totale 1250 euro']);
  // L'immagine sta dove stava la porzione.
  const scena = await strato.locator('.sn-tr-scena').boundingBox();
  expect(Math.abs(scena.x - box.x)).toBeLessThan(2);
  expect(Math.abs(scena.y - box.y)).toBeLessThan(2);
  await strato.screenshot({ path: 'tests/.shots/trascrivi-riquadro.png' }).catch(() => {});

  // Doppio clic sopra «4821» disegnato nell'immagine, poi Ctrl+C: negli appunti c'è solo quella parola.
  const r0 = m[0];
  await strato.mouse.dblclick(box.x + r0.x + r0.parola + r0.quattro / 2, box.y + r0.y - 12);
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe('4821');
  await strato.screenshot({ path: 'tests/.shots/trascrivi-selezione.png' }).catch(() => {});

  await strato.locator('.sn-tr-copia').click();
  await expect.poll(() => appunti(app), { timeout: 5000 }).toBe('Fattura numero 4821\nTotale 1250 euro');

  await strato.keyboard.press('Escape');
  await expect(strato.locator('.sn-tr-overlay')).toHaveCount(0);
});

test('tasto destro su un\'immagine: «Trascrivi» apre lo stesso riquadro sopra di lei', async ({ app, openTab, testServer }) => {
  const { page } = await apri(app, openTab, testServer);
  const box = await page.locator('#foto').boundingBox();
  await page.locator('#foto').click({ button: 'right', position: { x: 300, y: 80 } });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await menu.locator('button', { hasText: 'Trascrivi' }).first().click();

  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  await expect(strato.locator('.sn-tr-riga')).toHaveText(['Fattura numero 4821', 'Totale 1250 euro']);
  const scena = await strato.locator('.sn-tr-scena').boundingBox();
  expect(Math.abs(scena.x - box.x)).toBeLessThan(2);
  expect(Math.abs(scena.width - box.width)).toBeLessThan(2);
  expect(await letture(app)).toBe(1);

  // Un clic fuori dall'immagine chiude.
  await strato.mouse.click(5, 5);
  await expect(strato.locator('.sn-tr-overlay')).toHaveCount(0);
});

test('nessun testo nell\'immagine: il riquadro lo dice e non offre niente da copiare', async ({ app, openTab, testServer }) => {
  const { page } = await apri(app, openTab, testServer);
  await lettoreFinto(app, []);
  await page.locator('#foto').click({ button: 'right', position: { x: 300, y: 80 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-stato')).toHaveText('Nessun testo nell\'immagine', { timeout: 10_000 });
  await expect(strato.locator('.sn-tr-copia')).toHaveCount(0);
});
