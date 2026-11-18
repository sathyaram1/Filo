// Verifica #2374 giro 2, rilievo 1: un'immagine con lo sfondo trasparente e la scritta chiara, su una pagina scura, nel
// riquadro di Trascrivi deve mostrare la sua scritta (PNG trasparente, e SVG che il riquadro ridisegna).
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const TESTO = 'BENVENUTI 2026';

async function lettoreFinto(app) {
  await app.evaluate(async (_e, { testo }) => {
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
      return { text: JSON.stringify({ righe: [{ testo, x1: 33, y1: 300, x2: 560, y2: 650 }] }), model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto(P.c);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto(P.s);
  }, { testo: TESTO });
}

// La scritta bianca disegnata su un fondo trasparente, come i loghi e le insegne dei siti scuri.
const PNG = `const c = document.createElement('canvas'); c.width = 600; c.height = 120;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('${TESTO}', 20, 70);
  document.getElementById('foto').src = c.toDataURL('image/png');`;
const SVG = `document.getElementById('foto').src = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><text x="20" y="70" font-size="40" font-family="sans-serif" fill="#fff">${TESTO}</text></svg>');`;

const pagina = (disegna) => `<!doctype html><html><head><meta charset="utf-8"><title>Scuro</title></head>
<body style="margin:0;padding:60px 20px;background:#151515">
<img id="foto" width="600" height="120" alt="insegna">
<script>${disegna}</script></body></html>`;

// Quanta parte della scena si stacca dal suo colore più comune: è la scritta che l'utente vede.
async function scrittaVisibile(page, strato) {
  const scena = await strato.locator('.sn-tr-scena').boundingBox();
  const png = (await strato.screenshot({ clip: scena })).toString('base64');
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lum = [];
    for (let i = 0; i < d.length; i += 4) lum.push(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]);
    const med = [...lum].sort((a, b) => a - b)[Math.floor(lum.length / 2)];
    return lum.filter((l) => Math.abs(l - med) > 60).length / lum.length;
  }, png);
}

for (const [nome, disegna] of [['PNG trasparente', PNG], ['SVG', SVG]]) {
  test(`r1 una scritta chiara su fondo trasparente (${nome}) si vede nel riquadro`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, pagina(disegna));
    await page.waitForFunction(() => document.getElementById('foto').complete && document.getElementById('foto').naturalWidth > 0);
    await lettoreFinto(app);
    await page.locator('#foto').click({ button: 'right', position: { x: 5, y: 5 } });
    await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
    const strato = await paginaDelloStrato(app, page);
    await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
    expect(await scrittaVisibile(page, strato)).toBeGreaterThan(0.01);
  });
}
