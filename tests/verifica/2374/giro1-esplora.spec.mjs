// Esplorazione del verificatore #2374: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const W = 900;
const H = 120;

function pagina(righe, font) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Prova</title></head>
<body style="margin:0;padding:60px 40px;background:#eee">
<img id="foto" width="${W}" height="${H}" alt="prova">
<script>
  const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, ${W}, ${H});
  g.fillStyle = '#222'; g.font = '${font}';
  const R = ${JSON.stringify(righe)};
  for (const [t, x, y] of R) g.fillText(t, x, y);
  document.getElementById('foto').src = c.toDataURL('image/png');
  window.misure = R.map(([t, x, y]) => ({ t, x, y, w: g.measureText(t).width }));
  window.prima = (t, parola) => { const i = t.indexOf(parola); return { a: g.measureText(t.slice(0, i)).width, w: g.measureText(parola).width }; };
</script></body></html>`;
}

async function lettoreFinto(app, righe, attesaMs = 0) {
  await app.evaluate(async (_e, { righe, attesaMs }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSCRIBE_IMAGE]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__letture = 0;
    const P = globalThis.__veri || (globalThis.__veri = { c: globalThis.SN_PROVIDERS.completeWithFallback, s: globalThis.SN_PROVIDERS.streamCompleteWithFallback });
    const finto = (vero) => async (opts) => {
      const t = JSON.stringify(opts.messages || '');
      if (!t.includes('Trascrivi ESATTAMENTE il testo')) return vero(opts);
      globalThis.__letture++;
      if (attesaMs) await new Promise((r) => setTimeout(r, attesaMs));
      return { text: JSON.stringify({ righe }), model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto(P.c);
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto(P.s);
  }, { righe, attesaMs });
}

async function prepara(app, openTab, testServer, righeImg, font, attesaMs = 0) {
  const page = await testServer.openReady(openTab, pagina(righeImg, font));
  await page.waitForFunction(() => document.getElementById('foto').complete && window.misure);
  const m = await page.evaluate(() => window.misure);
  const px = parseInt(font, 10);
  const righe = m.map((r) => ({
    testo: r.t,
    x1: Math.round((r.x / W) * 1000), y1: Math.round(((r.y - px) / H) * 1000),
    x2: Math.round(((r.x + r.w) / W) * 1000), y2: Math.round(((r.y + px * 0.3) / H) * 1000),
  }));
  await lettoreFinto(app, righe, attesaMs);
  return { page, m, righe };
}

async function apriSuImmagine(app, page) {
  await page.locator('#foto').click({ button: 'right', position: { x: 10, y: 10 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  return paginaDelloStrato(app, page);
}

const appunti = (app) => app.evaluate(({ clipboard }) => clipboard.readText());

for (const [nome, font, testo, parola] of [
  ['monospace', '28px monospace', 'docker run -it --rm ubuntu:22.04 bash -c "ls -la"', 'bash'],
  ['serif', '30px serif', 'Il pagamento va effettuato entro il quindici marzo', 'quindici'],
  ['bold sans', 'bold 30px sans-serif', 'Codice cliente WWMM-41120 rinnovo annuale', 'rinnovo'],
]) {
  test(`esplora ${nome}: doppio clic su «${parola}»`, async ({ app, openTab, testServer }) => {
    const { page } = await prepara(app, openTab, testServer, [[testo, 20, 70]], font);
    const box = await page.locator('#foto').boundingBox();
    const p = await page.evaluate(({ t, w }) => window.prima(t, w), { t: testo, w: parola });
    const strato = await apriSuImmagine(app, page);
    await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
    await app.evaluate(({ clipboard }) => clipboard.writeText('prima'));
    await strato.mouse.dblclick(box.x + 20 + p.a + p.w / 2, box.y + 60);
    await strato.keyboard.press('ControlOrMeta+c');
    await page.waitForTimeout(500);
    console.log(nome, 'COPIATO:', JSON.stringify(await appunti(app)));
    await strato.screenshot({ path: `tests/.shots/v2374-${nome.replace(' ', '-')}.png` });
  });
}

test('esplora: trascinamento su due parole, Ctrl+A, menu della selezione', async ({ app, openTab, testServer }) => {
  const righeImg = [['Fattura numero 4821', 20, 50], ['Totale 1250 euro', 20, 100]];
  const { page } = await prepara(app, openTab, testServer, righeImg, '32px sans-serif');
  const box = await page.locator('#foto').boundingBox();
  const a = await page.evaluate(() => window.prima('Fattura numero 4821', 'numero'));
  const strato = await apriSuImmagine(app, page);
  await expect(strato.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  await strato.mouse.move(box.x + 20 + a.a + 1, box.y + 40);
  await strato.mouse.down();
  await strato.mouse.move(box.x + 20 + a.a + a.w + 60, box.y + 40, { steps: 6 });
  await strato.mouse.up();
  await strato.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(400);
  console.log('TRASCINA:', JSON.stringify(await appunti(app)));
  await strato.screenshot({ path: 'tests/.shots/v2374-trascina.png' });

  await strato.mouse.click(box.x + 20 + a.a + 20, box.y + 40, { button: 'right' });
  const menu = menuDi(strato).locator('.sn-menu').first();
  await expect(menu).toBeVisible({ timeout: 5000 });
  console.log('VOCI:', JSON.stringify(await menu.locator('button').allInnerTexts()));
  await strato.screenshot({ path: 'tests/.shots/v2374-menu.png' });
  await strato.keyboard.press('Escape');

  await strato.keyboard.press('ControlOrMeta+a');
  await strato.keyboard.press('ControlOrMeta+c');
  await page.waitForTimeout(400);
  console.log('CTRL+A:', JSON.stringify(await appunti(app)));
});

test('esplora: Esc mentre legge, poi la risposta arriva', async ({ app, openTab, testServer }) => {
  const righeImg = [['Fattura numero 4821', 20, 50]];
  const { page } = await prepara(app, openTab, testServer, righeImg, '32px sans-serif', 2500);
  const strato = await apriSuImmagine(app, page);
  await expect(strato.locator('.sn-tr-stato')).toBeVisible({ timeout: 5000 });
  await strato.keyboard.press('Escape');
  await expect(strato.locator('.sn-tr-overlay')).toHaveCount(0);
  await page.waitForTimeout(3500);
  console.log('DOPO ESC overlay:', await strato.locator('.sn-tr-overlay').count());
  // Riaperto subito dopo: funziona?
  const s2 = await apriSuImmagine(app, page);
  await expect(s2.locator('.sn-tr-overlay.sn-tr-pronto')).toBeVisible({ timeout: 10_000 });
  console.log('RIAPERTO ok');
});
