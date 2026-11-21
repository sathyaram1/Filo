// #2374.1 giro 1 — una scritta da destra a sinistra (ebraico): la parola trascinata come appare nell'immagine
// deve finire negli appunti, come per le scritte da sinistra a destra.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const W = 600;
const H = 120;
const PX = 36;
const TESTO = 'שלום עולם טוב';
const DESTRA = 560;
const BASE = 70;

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>Ebraico</title></head>
<body style="margin:0;padding:60px 20px;background:#eee">
<img id="foto" width="${W}" height="${H}" alt="scritta">
<script>
  const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${W}, ${H});
  g.fillStyle = '#222'; g.font = '${PX}px sans-serif'; g.direction = 'rtl'; g.textAlign = 'right';
  g.fillText(${JSON.stringify(TESTO)}, ${DESTRA}, ${BASE});
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misura = (s) => { g.direction = 'rtl'; return g.measureText(s).width; };
</script></body></html>`;

test('r1 scritta da destra a sinistra: la prima parola, disegnata a destra, trascinata come appare si copia lei', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misura);
  const [tutta, prima] = await page.evaluate(([t, p]) => [window.misura(t), window.misura(p)], [TESTO, 'שלום']);
  const riga = {
    testo: TESTO,
    x1: Math.round(((DESTRA - tutta) / W) * 1000), y1: Math.round(((BASE - PX) / H) * 1000),
    x2: Math.round((DESTRA / W) * 1000), y2: Math.round(((BASE + 10) / H) * 1000),
  };
  await app.evaluate(async (_e, righe) => {
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
  }, [riga]);

  const box = await page.locator('#foto').boundingBox();
  await page.locator('#foto').click({ button: 'right', position: { x: 10, y: 10 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });

  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await strato.mouse.move(box.x + DESTRA - 2, box.y + BASE - 12);
  await strato.mouse.down();
  await strato.mouse.move(box.x + DESTRA - prima + 2, box.y + BASE - 12, { steps: 6 });
  await strato.mouse.up();
  await strato.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5000 }).not.toBe('prima');
  await strato.screenshot({ path: 'tests/.shots/verifica-2374.1-rtl.png' }).catch(() => {});
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('שלום');
});
