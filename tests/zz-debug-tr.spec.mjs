import { test, expect } from './fixtures/electron.mjs';
import { paginaDelloStrato } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const SW = 760;
const SH = 140;
const SPX = 26;
const SCONTRINO = ['PANE INTEGRALE KG 0,350 EUR 1,40 IVA 4%', 'TOTALE COMPLESSIVO 12,50'];
const pagina = `<!doctype html><html><head><meta charset="utf-8"><title>Scontrino</title></head>
<body style="margin:0;padding:60px 20px;background:#eee">
<img id="foto" width="${SW}" height="${SH}" alt="scontrino">
<script>
  const c = document.createElement('canvas'); c.width = ${SW}; c.height = ${SH};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${SW}, ${SH});
  g.fillStyle = '#222'; g.font = '${SPX}px monospace';
  g.fillText(${JSON.stringify(SCONTRINO[0])}, 20, 50);
  g.fillText(${JSON.stringify(SCONTRINO[1])}, 20, 110);
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misura = (s) => g.measureText(s).width;
</script></body></html>`;

test('debug', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pagina);
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misura);
  const [w1, w2] = await page.evaluate((r) => r.map((s) => window.misura(s)), SCONTRINO);
  const r = (testo, y, w) => ({ testo, x1: Math.round((20 / SW) * 1000), y1: Math.round(((y - SPX) / SH) * 1000), x2: Math.round(((20 + w) / SW) * 1000), y2: Math.round(((y + 7) / SH) * 1000) });
  const righe = [r(SCONTRINO[0], 50, w1), r(SCONTRINO[1], 110, w2)];
  await app.evaluate(async (_e, { righe }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.TRANSCRIBE_IMAGE]: 'gemma' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    const P = globalThis.__veri || (globalThis.__veri = { c: globalThis.SN_PROVIDERS.completeWithFallback, s: globalThis.SN_PROVIDERS.streamCompleteWithFallback });
    const finto = (vero) => async (opts) => {
      if (!JSON.stringify(opts.messages || '').includes('Trascrivi ESATTAMENTE il testo')) return vero(opts);
      return { text: JSON.stringify({ righe }), model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto(P.c);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto(P.s);
  }, { righe });
  const box = await page.locator('#foto').boundingBox();
  await page.locator('#foto').click({ button: 'right', position: { x: 10, y: 10 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  const strato = await paginaDelloStrato(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  const da = await page.evaluate(() => window.misura('PANE '));
  const info = await strato.evaluate(({ x, y }) => {
    const o = document.querySelector('.sn-tr-overlay');
    const root = o.getRootNode();
    const e = (root.elementFromPoint || document.elementFromPoint).call(root, x, y);
    return {
      html: o.querySelector('.sn-tr-testo').innerHTML.slice(0, 3000),
      punto: e && (e.className + ' ' + e.textContent.slice(0, 20)),
      scena: o.querySelector('.sn-tr-scena').getBoundingClientRect().toJSON(),
    };
  }, { x: box.x + 20 + da + 2, y: box.y + 40 });
  console.log(JSON.stringify({ punto: info.punto }, null, 1));
  const lunga = await page.evaluate(() => window.misura('INTEGRALE'));
  await strato.mouse.move(box.x + 20 + da + 2, box.y + 40);
  await strato.mouse.down();
  await strato.mouse.move(box.x + 20 + da + lunga - 2, box.y + 40, { steps: 6 });
  await strato.mouse.up();
  const sel = await strato.evaluate(() => {
    const o = document.querySelector('.sn-tr-overlay');
    const root = o.getRootNode();
    const s = (root.getSelection && root.getSelection()) || document.getSelection();
    return { s: s.toString(), d: document.getSelection().toString(), tipo: s.type, a: s.anchorNode && s.anchorNode.textContent, f: s.focusNode && s.focusNode.textContent };
  });
  console.log(JSON.stringify(sel));
  await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
  await strato.keyboard.press('ControlOrMeta+c');
  await new Promise((r) => setTimeout(r, 1000));
  console.log('appunti', await app.evaluate(({ clipboard }) => clipboard.readText()));
  await strato.screenshot({ path: 'tests/.shots/debug-tr.png' });
});
