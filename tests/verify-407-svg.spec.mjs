// Verifier #407 — controllo indipendente (black-box).
// (a) Il sintomo originale: titolo in <header>, sommario in <div>, link → tradotti.
// (b) Regressione segnalata al giro precedente: un'illustrazione SVG che porta il
//     proprio <style> NON deve rompersi (colori intatti) e il suo contenuto NON
//     deve finire al modello.

import { test, expect } from './fixtures/electron.mjs';

const ARTICLE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <header><h1 id="title">The end of an era in European football</h1></header>
  <div id="summary">A short standfirst explaining what this article is about here.</div>
  <article>
    <p id="p1">First paragraph of the body text, long enough to be picked up here.</p>
    <p id="p2">Second paragraph with a <a id="inlink" href="#x">linked phrase</a> inside it.</p>
  </article>
</body></html>`;

// SVG con foglio di stile INTERNO: sfondo giallo (#ffdd00) ed etichetta viola
// (#7700cc). Se il codice tratta il <style> dell'SVG come testo di pagina, lo
// manda al modello e lo sostituisce: le regole CSS si rompono e il rettangolo
// diventa nero (fill di default).
const SVG_PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="hd">An English heading that should be translated</h1>
  <p id="par">A paragraph of real body text, long enough to be translated by the tool.</p>
  <svg id="chart" width="200" height="120" xmlns="http://www.w3.org/2000/svg">
    <style id="svgstyle">
      .bg { fill: #ffdd00; }
      .lbl { fill: #7700cc; font: 16px sans-serif; }
    </style>
    <rect id="bg" class="bg" x="0" y="0" width="200" height="120"></rect>
    <text id="lbl" class="lbl" x="20" y="60">Quarterly sales figure</text>
  </svg>
</body></html>`;

async function stubTranslationProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__filoTranslateCalls = 0;
    globalThis.__filoTranslatePrompts = [];
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
      globalThis.__filoTranslateCalls++;
      globalThis.__filoTranslatePrompts.push(prompt);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP);
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

async function clickTranslateIcon(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

test('(a) sintomo originale: titolo/sommario/link tradotti', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, ARTICLE);
  await clickTranslateIcon(page, '#p1');
  await expect(page.locator('#p1')).toHaveText(/^IT /);
  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect(page.locator('#summary')).toHaveText(/^IT /);
  await expect(page.locator('#inlink')).toHaveText(/^IT /);
  await expect(page.locator('#p2 a#inlink')).toHaveAttribute('href', '#x');
});

test('(b) SVG con <style> interno: colori intatti, contenuto NON inviato al modello', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, SVG_PAGE);

  const bgBefore = await page.locator('#bg').evaluate((el) => getComputedStyle(el).fill);
  await clickTranslateIcon(page, '#par');

  // Il testo di pagina DEVE essere tradotto (la feature funziona).
  await expect(page.locator('#hd')).toHaveText(/^IT /);
  await expect(page.locator('#par')).toHaveText(/^IT /);

  // Attendi che la traduzione abbia processato tutto.
  await expect.poll(async () => app.evaluate(() => globalThis.__filoTranslateCalls)).toBeGreaterThan(0);
  await page.waitForTimeout(300);

  // Il rettangolo dell'illustrazione DEVE avere ancora il suo giallo.
  const bgAfter = await page.locator('#bg').evaluate((el) => getComputedStyle(el).fill);
  await page.screenshot({ path: 'tests/.shots/verify-407-svg.png' }).catch(() => {});
  expect(bgAfter).toBe(bgBefore);
  expect(bgAfter).toBe('rgb(255, 221, 0)');

  // Lo <style> interno NON deve essere stato riscritto.
  await expect(page.locator('#svgstyle')).toContainText('.bg');
  await expect(page.locator('#svgstyle')).not.toContainText('IT ');

  // Il contenuto dell'SVG (CSS ed etichetta) NON deve essere finito al modello.
  const prompts = await app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n---\n'));
  expect(prompts).not.toContain('fill:');
  expect(prompts).not.toContain('#ffdd00');
  expect(prompts).not.toContain('Quarterly sales figure');
});
