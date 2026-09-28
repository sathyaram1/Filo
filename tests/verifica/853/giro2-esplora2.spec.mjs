// #853 giro 2: esplorazione (Traduci da scorciatoia, confronto con pagina web).

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

mkdirSync('tests/.shots', { recursive: true });

async function preparaModello(app, testo) {
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
        [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash',
        [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origP853g2b = globalThis.__origP853g2b || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origP853g2b,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, testo);
}

async function bersaglio(page, pronto = 'filoContentScripts') {
  await page.waitForFunction((k) => document.documentElement.dataset[k] === '1', pronto, { timeout: 15_000 });
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

test('Traduci con la scorciatoia su Gestione: grassetto e link resi, HTML come testo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await preparaModello(app, 'La **fotosintesi** vedi [qui](https://example.com/q) e <img id="spia" src="https://filo-853.invalid/x.png">');
  const page = await openTab('filo://manage/manage.html');
  await bersaglio(page);
  await page.locator('#b853').click();
  await page.evaluate(() => {
    const p = document.querySelector('#b853');
    const r = document.createRange(); r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await app.evaluate(({ webContents }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://manage'));
    wc.send('shortcut:triggered', { command: 'translate-selection' });
  });
  const riq = page.locator('.sn-popup .sn-popup-body');
  await expect(riq.locator('strong')).toHaveText('fotosintesi', { timeout: 20_000 });
  await expect(riq.locator('a.filo-md-link')).toHaveAttribute('href', 'https://example.com/q');
  await expect(riq).toContainText('<img id="spia"');
  expect(await page.locator('#spia').count()).toBe(0);
});

test('confronto pagina web: stesso testo, menu e riquadro', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const testo = '## Fotosintesi\nProcesso con cui le piante usano la **luce**.\n\n'
    + '1. assorbono la luce\n2. producono *zuccheri*\n\n'
    + 'Codice `<b>` e blocco:\n```\nconst x = "<img src=x>";\n```\n'
    + 'Fonte: https://it.wikipedia.org/wiki/Fotosintesi_clorofilliana — un indirizzo lungo lunghissimo.';
  await preparaModello(app, testo);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="background:#f4efe6"><h1>Pagina</h1></body></html>');
  await bersaglio(page, 'filoReady');
  await page.locator('#b853').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  const corpo = menu.locator('.sn-menu-inline-explain .sn-menu-inline-body');
  await expect(corpo).not.toHaveText(/Spiegazione…/, { timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/853-g2-web-menu.png' });
  const misure = await corpo.evaluate((el) => {
    const h = el.querySelector('h4, h3, h5');
    const cs = h ? getComputedStyle(h) : null;
    return { tag: h && h.tagName, mt: cs && cs.marginTop, top: h && (h.getBoundingClientRect().top - el.getBoundingClientRect().top) };
  });
  console.log('web', JSON.stringify(misure));
});
