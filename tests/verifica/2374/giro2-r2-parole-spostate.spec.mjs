// Verifica #2374 giro 2, rilievo 2: nel riquadro di Trascrivi una parola trascinata dalla sua prima alla sua ultima
// lettera, come appaiono nell'immagine, si copia intera anche quando l'immagine usa un carattere diverso da quello di Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const W = 760;
const H = 140;
const PX = 26;
const RIGA = 'PANE INTEGRALE KG 0,350 EUR 1,40 IVA 4%';

const pagina = (font) => `<!doctype html><html><head><meta charset="utf-8"><title>Scontrino</title></head>
<body style="margin:0;padding:60px 20px;background:#eee">
<img id="foto" width="${W}" height="${H}" alt="scontrino">
<script>
  const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${W}, ${H});
  g.fillStyle = '#222'; g.font = '${PX}px ${font}';
  g.fillText(${JSON.stringify(RIGA)}, 20, 50);
  g.fillText('TOTALE COMPLESSIVO 12,50', 20, 110);
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misura = (s) => g.measureText(s).width;
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

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

// Il lettore dà il riquadro esatto di ogni riga: lo scarto viene solo da come il riquadro posa le parole dentro la riga.
async function apri(app, openTab, testServer, font) {
  const page = await testServer.openReady(openTab, pagina(font));
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misura);
  const w1 = await page.evaluate((r) => window.misura(r), RIGA);
  const w2 = await page.evaluate(() => window.misura('TOTALE COMPLESSIVO 12,50'));
  const r = (testo, y, w) => ({ testo, x1: Math.round((20 / W) * 1000), y1: Math.round(((y - PX) / H) * 1000), x2: Math.round(((20 + w) / W) * 1000), y2: Math.round(((y + 7) / H) * 1000) });
  await lettoreFinto(app, [r(RIGA, 50, w1), r('TOTALE COMPLESSIVO 12,50', 110, w2)]);
  const box = await page.locator('#foto').boundingBox();
  await page.locator('#foto').click({ button: 'right', position: { x: 5, y: 5 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  return { page, strato, box };
}

async function trascinaECopia(app, page, strato, box, prima, parola) {
  const da = await page.evaluate((s) => window.misura(s), prima);
  const lunga = await page.evaluate((s) => window.misura(s), parola);
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await strato.mouse.move(box.x + 20 + da + 2, box.y + 40);
  await strato.mouse.down();
  await strato.mouse.move(box.x + 20 + da + lunga - 2, box.y + 40, { steps: 6 });
  await strato.mouse.up();
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => appunti(app), { timeout: 5000 }).not.toBe('prima');
  return appunti(app);
}

test('r2 scontrino a caratteri fissi: «INTEGRALE» trascinata come appare si copia intera', async ({ app, openTab, testServer }) => {
  const { page, strato, box } = await apri(app, openTab, testServer, 'monospace');
  expect(await trascinaECopia(app, page, strato, box, 'PANE ', 'INTEGRALE')).toBe('INTEGRALE');
});

test('r2 carattere con le grazie: il prezzo «1,40» trascinato come appare si copia intero', async ({ app, openTab, testServer }) => {
  const { page, strato, box } = await apri(app, openTab, testServer, 'serif');
  expect(await trascinaECopia(app, page, strato, box, 'PANE INTEGRALE KG 0,350 EUR ', '1,40')).toBe('1,40');
});
