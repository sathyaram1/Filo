// Esplorazione della verifica #1465 giro 1: porte che lo spec del lavoro non prova.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const m of globalThis.SN_CONTATORI.MISURE_RIQUADRI) {
      for (const [chiave, conti] of Object.entries(ora[m] || {})) {
        const a = ((out[m] = out[m] || {})[chiave] = (out[m] || {})[chiave] || conti.map(() => 0));
        conti.forEach((n, i) => { a[i] += n; });
      }
    }
  }
  return out;
});
const voceOra = async (app, misura, chiave) => {
  const conti = ((await oggi(app))[misura] || {})[chiave];
  if (!conti) return null;
  const nomi = await app.evaluate((_e, m) => globalThis.SN_CONTATORI.RIQUADRI[m].gruppi.flat(), misura);
  return Object.fromEntries(nomi.map((n, i) => [n, conti[i]]).filter(([, n]) => n > 0));
};

async function modelliFinti(app) {
  await app.evaluate(async () => {
    const A = globalThis.SN_CONST.ACTIONS;
    const m = 'deepseek-flash';
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [A.EXPLAIN]: m, [A.EXPLAIN_LINK]: m, [A.EXPLAIN_DEEP]: m, [A.TRANSCRIBE_IMAGE]: m },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__partite = 0;
    globalThis.__liberaTutte = [];
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...P,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => { globalThis.__liberaTutte.push(r); });
        onDelta('Una pagina.');
        return { text: 'Una pagina.', usage: {} };
      },
    };
    const PS = globalThis.SN_PROVIDERS;
    PS.completeWithFallback = async () => {
      globalThis.__partite++;
      await new Promise((r) => { globalThis.__liberaTutte.push(r); });
      return { text: 'Un felino domestico.', provider: 'test', model: m, usage: {} };
    };
  });
}
const liberaTutte = (app) => app.evaluate(() => { for (const r of globalThis.__liberaTutte.splice(0)) r(); });

test('spiega nel menu chiusa prima della risposta, con l’anticipo in volo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelliFinti(app);
  const page = await testServer.openReady(openTab, '<!doctype html><html lang="it"><body style="padding:40px;font:20px sans-serif">'
    + '<p>Il <span id="parola">gatto</span> dorme.</p></body></html>');
  await page.locator('#parola').dblclick();
  await expect.poll(() => app.evaluate(() => globalThis.__partite), { timeout: 10_000 }).toBe(1);
  await page.locator('#parola').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-inline-explain')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await expect.poll(() => voceOra(app, 'riquadro_chiuso_prima', 'explain'), { timeout: 10_000 }).not.toBeNull();
  await liberaTutte(app);
  await expect.poll(() => voceOra(app, 'anticipo_al_gesto', 'spiega'), { timeout: 10_000 }).toEqual({ in_volo: 1 });
});

test('spiega link chiusa prima della risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelliFinti(app);
  const page = await testServer.openReady(openTab, '<!doctype html><html lang="it"><body style="padding:40px;font:20px sans-serif">'
    + '<p><a id="l" href="/altro">un collegamento</a></p></body></html>');
  await page.locator('#l').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.locator('.sn-menu-inline').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await expect.poll(() => voceOra(app, 'riquadro_chiuso_prima', 'explain-link'), { timeout: 10_000 }).not.toBeNull();
  await liberaTutte(app);
});

test('OCR annullato', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelliFinti(app);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px">testo</body></html>');
  await nelMondoDiFilo(app, page, () => { globalThis.SN_ACTIONS.transcribeRegion(); return true; });
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await expect.poll(() => voceOra(app, 'ocr', 'annullato'), { timeout: 10_000 }).toEqual({ n: 1 });
});
