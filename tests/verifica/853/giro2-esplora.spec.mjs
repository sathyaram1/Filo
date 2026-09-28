// #853 giro 2: esplorazione (link cliccati davvero, altre pagine interne, aspetto).

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('tests/.shots', { recursive: true });

async function preparaModello(app, testo, extra = {}) {
  await app.evaluate(async (_e, [t, extra]) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
        [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash',
        [C.ACTIONS.TRANSLATE]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      ...extra,
    });
    globalThis.__origP853g2 = globalThis.__origP853g2 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP853g2,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, [testo, extra]);
}

async function bersaglio(page) {
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 });
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'b853';
    p.textContent = 'La fotosintesi clorofilliana trasforma la luce in zuccheri.';
    p.style.cssText = 'position:fixed;left:40px;top:120px;z-index:2147480000;margin:0;padding:8px;'
      + 'font:16px sans-serif;background:#fff;color:#000';
    document.body.appendChild(p);
    const r = document.createRange();
    r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
}

async function menuSpiega(page) {
  await page.locator('#b853').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const corpo = menu.locator('.sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });
  return { menu, corpo };
}

async function aspettaScheda(app, url) {
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    if (app.windows().some((w) => w.url() === url)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

test('link nel menu, cliccato davvero su Editor, apre la pagina in una scheda nuova', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dest = testServer.html('<p>arrivato</p>');
  await preparaModello(app, `Vedi la [pagina](${dest}) e **grassetto**.`);
  const page = await openTab('filo://editor/');
  await bersaglio(page);
  const { corpo } = await menuSpiega(page);
  await corpo.locator('a.filo-md-link').click();
  expect(await aspettaScheda(app, dest)).toBe(true);
  expect(page.url()).toMatch(/^filo:\/\/editor/);
});

test('link nel riquadro, cliccato davvero su Editor, apre la pagina in una scheda nuova', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dest = testServer.html('<p>arrivato2</p>');
  await preparaModello(app, `Vedi la [pagina](${dest}) e **grassetto**.`);
  const page = await openTab('filo://editor/');
  await bersaglio(page);
  const { menu } = await menuSpiega(page);
  await menu.locator('.sn-menu-inline-arrow').click();
  const riq = page.locator('.sn-popup .sn-popup-body');
  await expect(riq.locator('a.filo-md-link')).toBeVisible({ timeout: 15_000 });
  await riq.locator('a.filo-md-link').click();
  expect(await aspettaScheda(app, dest)).toBe(true);
  expect(page.url()).toMatch(/^filo:\/\/editor/);
});

const PAGINE = ['history', 'options', 'preferences', 'feedback', 'decks', 'archive', 'credits',
  'downloads', 'board', 'transparency', 'security', 'spellcheck', 'admin-defaults', 'redteam', 'home', 'newtab'];
for (const p of PAGINE) {
  test(`pagina interna ${p}: menu del tasto destro con grassetto reso`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await preparaModello(app, 'Il **grassetto** e la [guida](https://example.com/g).\n\n- uno\n- due');
    const page = await openTab(`filo://${p}/`);
    const stato = await page.evaluate(() => ({
      cs: document.documentElement.dataset.filoContentScripts,
      md: typeof (window.SN_MARKDOWN && window.SN_MARKDOWN.render),
    }));
    console.log(p, JSON.stringify(stato));
    await bersaglio(page);
    const { corpo } = await menuSpiega(page);
    await expect(corpo.locator('strong')).toHaveText('grassetto');
    await expect(corpo.locator('a.filo-md-link')).toHaveCount(1);
  });
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}: menu e riquadro con titolo, elenco, codice e link`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const testo = '## Fotosintesi\nProcesso con cui le piante usano la **luce**.\n\n'
      + '1. assorbono la luce\n2. producono *zuccheri*\n\n'
      + 'Codice `<b>` e blocco:\n```\nconst x = "<img src=x>";\n```\n'
      + 'Fonte: https://it.wikipedia.org/wiki/Fotosintesi_clorofilliana — un indirizzo lungo lunghissimo.';
    await preparaModello(app, testo, { theme: tema });
    const page = await openTab('filo://editor/');
    await bersaglio(page);
    const { menu } = await menuSpiega(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/853-g2-menu-${tema}.png` });
    const menuBox = await menu.boundingBox();
    const view = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    console.log(tema, 'menu', JSON.stringify(menuBox), JSON.stringify(view));
    await menu.locator('.sn-menu-inline-arrow').click();
    const riq = page.locator('.sn-popup .sn-popup-body');
    await expect(riq.locator('a.filo-md-link')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/853-g2-riquadro-${tema}.png` });
  });
}
