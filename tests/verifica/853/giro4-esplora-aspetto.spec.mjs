// Esplorazione giro 4 (#853): aspetto di una risposta ricca nel menu e nel riquadro.
import { test, expect } from '../../fixtures/electron.mjs';

const LUNGO = 'https://example.com/' + 'percorso-molto-lungo-senza-spazi-'.repeat(5) + 'fine';
const RISPOSTA = [
  '### Titolo della spiegazione',
  'Il **grassetto** e il *corsivo* e il `codice` in riga.',
  '',
  '1. primo punto',
  '2. secondo punto',
  '- puntato',
  '',
  '```',
  'const unaRigaDiCodiceMoltoLunga = document.querySelectorAll(".classe-lunghissima > div > span");',
  '```',
  `Link lungo: ${LUNGO} e [guida](https://example.com/guida).`,
].join('\n');

async function preparaModello(app, testo, tema) {
  await app.evaluate(async (_e, [t, tema]) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      theme: tema,
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__orig853 = globalThis.__orig853 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__orig853,
      complete: async () => ({ text: t, toolCalls: [], reasoningDetails: [], usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, [testo, tema]);
}

const PAGINE = [
  ['editor', 'filo://editor/'],
  ['manage', 'filo://manage/manage.html'],
  ['feedback', 'filo://feedback/feedback.html'],
  ['options', 'filo://options/options.html'],
];

for (const tema of ['light', 'dark']) {
  for (const [nome, url] of PAGINE) {
    test(`aspetto ${nome} ${tema}`, async ({ app, openTab }) => {
      test.setTimeout(60_000);
      await preparaModello(app, RISPOSTA, tema);
      const page = await openTab(url);
      await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const p = document.createElement('p');
        p.id = 'b853';
        p.textContent = 'La fotosintesi clorofilliana trasforma la luce in zuccheri.';
        p.style.cssText = 'position:fixed;left:40px;top:60px;z-index:2147480000;margin:0;padding:8px;font:16px sans-serif;background:#fff;color:#000';
        document.body.appendChild(p);
        const r = document.createRange(); r.selectNodeContents(p);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      });
      await page.locator('#b853').click({ button: 'right' });
      const menu = page.locator('.sn-menu');
      await expect(menu).toBeVisible();
      const corpo = menu.locator('.sn-menu-inline-explain .sn-menu-inline-body');
      await expect(corpo.locator('strong')).toHaveCount(1, { timeout: 15_000 });
      const misure = await page.evaluate(() => {
        const m = document.querySelector('.sn-menu');
        const b = document.querySelector('.sn-menu-inline-explain .sn-menu-inline-body');
        const mr = m.getBoundingClientRect();
        const fuori = [...b.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > mr.right + 1).map((e) => e.tagName);
        const cs = (sel) => { const e = b.querySelector(sel); if (!e) return null; const s = getComputedStyle(e); return { fs: s.fontSize, m: s.margin, p: s.padding, ls: s.listStyleType, c: s.color, bg: s.backgroundColor, ff: s.fontFamily.slice(0, 30) }; };
        return { theme: document.documentElement.dataset.snTheme, menuW: mr.width, scrollW: m.scrollWidth, fuori, h: cs('h3'), ol: cs('ol'), ul: cs('ul'), pre: cs('pre'), code: cs('p code'), a: cs('a') };
      });
      console.log(nome, tema, JSON.stringify(misure));
      await page.screenshot({ path: `tests/.shots/853-g4-aspetto-${nome}-${tema}-menu.png` });
      await menu.locator('.sn-menu-inline-arrow').click();
      await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
      await page.screenshot({ path: `tests/.shots/853-g4-aspetto-${nome}-${tema}-riquadro.png` });
    });
  }
}

test('aspetto pagina web light (riferimento)', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await preparaModello(app, RISPOSTA, 'light');
  const page = await openTab(testServer.url('/'));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'b853';
    p.textContent = 'La fotosintesi clorofilliana trasforma la luce in zuccheri.';
    p.style.cssText = 'position:fixed;left:40px;top:60px;z-index:2147480000;margin:0;padding:8px;font:16px sans-serif;background:#fff;color:#000';
    document.body.appendChild(p);
    const r = document.createRange(); r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#b853').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-menu-inline-explain .sn-menu-inline-body strong')).toHaveCount(1, { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/853-g4-aspetto-web-menu.png' });
  await menu.locator('.sn-menu-inline-arrow').click();
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });
  await page.screenshot({ path: 'tests/.shots/853-g4-aspetto-web-riquadro.png' });
});
