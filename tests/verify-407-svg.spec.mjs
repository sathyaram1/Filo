// VERIFIER #407 — controllo indipendente della regressione SVG.
//
// La lamentela dell'ultimo giro: "Traduci la pagina" ora traduce tutto il testo,
// ma ROMPE le illustrazioni: un disegno SVG che porta con sé il proprio foglio
// di stile (<style> dentro l'<svg>) veniva scambiato per testo dell'articolo,
// mandato al modello e sostituito con la traduzione → il rettangolo giallo
// diventava NERO e l'etichetta spariva, con l'avviso comunque "Pagina tradotta".
//
// Qui verifico da fuori (black-box, come l'utente):
//  A) il testo NORMALE attorno cambia lingua (la feature originale funziona);
//  B) il colore EFFETTIVAMENTE dipinto del rettangolo NON cambia (giallo prima,
//     giallo dopo) — misurato sul fill calcolato, non sul testo dello stile;
//  C) l'etichetta dentro l'SVG e la formula MathML restano intatte;
//  D) il contenuto interno dell'SVG (stile, etichetta, eventuale script) NON
//     viene mai spedito al modello.

import { test, expect } from './fixtures/electron.mjs';

// Pagina: testo normale + un SVG con <style> interno (giallo/viola) + <script>
// interno + una formula MathML. I colori arrivano dal <style> DENTRO l'svg: se
// quel testo viene "tradotto", il CSS si rompe e il rettangolo perde il giallo.
const PAGE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="title">Quarterly results overview</h1>
  <p id="body">This paragraph explains the chart shown below in plain prose text.</p>
  <svg id="chart" width="200" height="120" xmlns="http://www.w3.org/2000/svg">
    <style>
      .box { fill: rgb(255, 221, 0); }
      .lbl { fill: rgb(128, 0, 200); font-size: 14px; }
    </style>
    <script>window.__svgScriptRan = 'yes';</script>
    <rect id="rect" class="box" x="10" y="10" width="180" height="100"></rect>
    <text id="lbl" class="lbl" x="20" y="60">Revenue growth label</text>
  </svg>
  <p id="after">A closing paragraph after the illustration, also in English prose.</p>
  <math id="math" xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>
</body></html>`;

// Stub del provider: "IT " davanti a ogni pezzo, e REGISTRA ogni chunk spedito,
// così posso verificare che il contenuto dell'SVG non sia mai partito.
async function stubProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_PAGE]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__sentChunks = [];
    const orig = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return orig(args);
      const i = prompt.indexOf('Testo:\n\n');
      const chunk = i >= 0 ? prompt.slice(i + 'Testo:\n\n'.length) : prompt;
      globalThis.__sentChunks.push(chunk);
      const SEP = '\n@@@SN_SEP@@@\n';
      const out = chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP);
      return { text: out, provider: 'test', model: 'test-translate', usage: {} };
    };
  });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) {
          window.__toasts.push(n.textContent || '');
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function clickTranslate(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  await btn.click();
}

// Legge il colore fill EFFETTIVAMENTE calcolato del rettangolo (non il testo CSS).
const rectFill = (page) => page.evaluate(() =>
  window.getComputedStyle(document.getElementById('rect')).fill);

test('#407 regressione SVG: il testo si traduce ma l\'illustrazione resta intatta', async ({ app, openTab, testServer }) => {
  await stubProvider(app);
  const page = await testServer.openReady(openTab, PAGE);
  await watchToasts(page);

  const fillBefore = await rectFill(page);
  expect(fillBefore).toBe('rgb(255, 221, 0)'); // giallo, di partenza

  await clickTranslate(page, '#body');

  // A) il testo normale cambia lingua
  await expect(page.locator('#title')).toHaveText(/^IT /);
  await expect(page.locator('#body')).toHaveText(/^IT /);
  await expect(page.locator('#after')).toHaveText(/^IT /);

  // B) il colore dipinto del rettangolo NON è cambiato (era qui che si rompeva)
  const fillAfter = await rectFill(page);
  expect(fillAfter).toBe('rgb(255, 221, 0)');

  // C) etichetta SVG e formula MathML intatte (non tradotte, non alterate)
  await expect(page.locator('#lbl')).toHaveText('Revenue growth label');
  await expect(page.locator('#math')).toHaveText('x+1');
  // Il testo del <style> interno dev'essere ancora CSS valido, non "IT .box…"
  const styleText = await page.evaluate(() => document.querySelector('#chart style').textContent);
  expect(styleText).toContain('fill: rgb(255, 221, 0)');
  expect(styleText).not.toContain('IT ');

  // D) niente contenuto dell'SVG spedito al modello
  const sent = await app.evaluate(() => (globalThis.__sentChunks || []).join('\n---\n'));
  expect(sent).not.toContain('.box');
  expect(sent).not.toContain('Revenue growth label');
  expect(sent).not.toContain('__svgScriptRan');

  await page.screenshot({ path: 'tests/.shots/verify-407-svg.png' }).catch(() => {});

  const t = await page.evaluate(() => window.__toasts || []);
  expect(t.join(' ')).toContain('Pagina tradotta');
});
