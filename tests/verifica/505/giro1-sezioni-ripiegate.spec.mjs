// #505 giro 1 — le sezioni ripiegate devono comportarsi TUTTE allo stesso modo.
//
// Il sito sceglie COME ripiega una sezione (fisarmonica del browser, pannello
// schiacciato a zero, blocco spento, attributo di accessibilità): da quella
// scelta non possono dipendere né cosa vede l'utente né quanto paga. Qui si
// prova una pagina che ripiega la stessa identica cosa in undici modi diversi
// e si guarda COSA È PARTITO davvero verso il modello.

import { test, expect } from '../../fixtures/electron.mjs';

// Ogni forma porta una parola sua, irripetibile: è così che si legge nel testo
// spedito al modello quali sezioni sono state pagate.
const FORME = [
  ['A', 'dettagli chiusi, contenuto dentro un blocco'],
  ['B', 'dettagli chiusi, testo nudo senza blocco'],
  ['C', 'pannello schiacciato con max-height zero'],
  ['D', 'pannello spento con display none'],
  ['E', 'pannello con attributo hidden'],
  ['F', 'pannello marcato aria-hidden'],
  ['G', 'pannello schiacciato con scaleY zero'],
  ['H', 'pannello spinto fuori schermo a sinistra'],
  ['I', 'pannello con content-visibility hidden'],
  ['J', 'pannello reso trasparente con opacity zero'],
  ['K', 'pannello con altezza zero e overflow hidden'],
];

const parola = (k) => `ZQ${k}TOKEN`;
const frase = (k, d) => `Section ${parola(k)} hidden text about ${d} which nobody has opened yet.`;

const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="titolo">Visible heading of the page</h1>
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>

  <details id="dA"><summary id="sA">Open section A</summary>
    <div id="pA">${frase('A', FORME[0][1])}</div>
  </details>

  <details id="dB"><summary id="sB">Open section B</summary>
    ${frase('B', FORME[1][1])}
  </details>

  <div id="tC">Toggle C</div>
  <div id="pC" style="max-height:0;overflow:hidden">${frase('C', FORME[2][1])}</div>

  <div id="pD" style="display:none">${frase('D', FORME[3][1])}</div>
  <div id="pE" hidden>${frase('E', FORME[4][1])}</div>
  <div id="pF" aria-hidden="true">${frase('F', FORME[5][1])}</div>
  <div id="pG" style="transform:scaleY(0)">${frase('G', FORME[6][1])}</div>
  <div id="pH" style="position:absolute;left:-9999px;top:0">${frase('H', FORME[7][1])}</div>
  <div id="pI" style="content-visibility:hidden">${frase('I', FORME[8][1])}</div>
  <div id="pJ" style="opacity:0">${frase('J', FORME[9][1])}</div>
  <div id="pK" style="height:0;overflow:hidden">${frase('K', FORME[10][1])}</div>
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
      const APRE = '<<<TESTO_IN_PAGINA>>>\n';
      const CHIUDE = '\n<<<FINE_TESTO_IN_PAGINA>>>';
      const i = prompt.indexOf(APRE);
      const fine = prompt.lastIndexOf(CHIUDE);
      const chunk = i >= 0 && fine > i ? prompt.slice(i + APRE.length, fine) : '';
      const SEP = '\n@@@SN_SEP@@@\n';
      globalThis.__filoTranslatePrompts.push(chunk);
      return {
        text: chunk.split(/\n?@@@SN_SEP@@@\n?/).map((p) => `IT ${p}`).join(SEP),
        provider: 'test', model: 'test-translate', usage: {},
      };
    };
  });
}

async function watchToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) {
            window.__toasts.push(n.textContent || '');
          }
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
}

const toasts = (page) => page.evaluate(() => window.__toasts || []);
const spedito = (app) => app.evaluate(() => (globalThis.__filoTranslatePrompts || []).join('\n'));

async function apriMenu(page, anchor) {
  await page.locator(anchor).first().click({ button: 'right', position: { x: 5, y: 5 } });
  const btn = page.locator('[data-sn-icon-id="translate"]');
  await expect(btn).toBeVisible();
  return btn;
}

async function traduci(page, anchor = '#intro') {
  const btn = await apriMenu(page, anchor);
  await btn.click();
}

test('nessuna sezione ripiegata viene pagata prima che l’utente la apra', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduci(page);

  // Il testo che si vede è tradotto: è la precondizione dello scenario.
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.locator('#titolo')).toHaveText(/^IT /, { timeout: 30000 });
  await expect(page.locator('#sA')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  // …e NESSUNA delle undici forme di ripiegatura è finita nel conto.
  const inviato = await spedito(app);
  const pagate = FORME.filter(([k]) => inviato.includes(parola(k))).map(([k, d]) => `${k} (${d})`);
  expect(pagate, `forme ripiegate spedite al modello e quindi pagate: ${pagate.join(', ')}`).toEqual([]);
});

test('aperta la sezione, il menu offre di tradurre solo quella — per ogni forma di ripiegatura', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduci(page);
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  // A traduzione completa e ferma l'icona torna all'originale: se già qui
  // offrisse "il testo nuovo", il passo dopo non proverebbe niente.
  await expect(await apriMenu(page, '#intro')).toHaveAttribute('aria-label', 'Mostra originale');
  await page.keyboard.press('Escape');

  const mancate = [];
  for (const [k, descr] of FORME) {
    // Scoprire la sezione: ogni forma si apre come la aprirebbe il suo sito.
    await page.evaluate((key) => {
      const d = document.getElementById('d' + key);
      if (d) { d.open = true; return; }
      const el = document.getElementById('p' + key);
      if (!el) return;
      el.removeAttribute('hidden');
      el.removeAttribute('aria-hidden');
      el.setAttribute('style', '');
    }, k);
    await page.waitForTimeout(120);

    const btn = await apriMenu(page, '#intro');
    const label = await btn.getAttribute('aria-label');
    if (label !== 'Traduci il testo nuovo') mancate.push(`${k} (${descr}) → "${label}"`);
    await page.keyboard.press('Escape');

    // Richiude, così ogni forma si prova da sola.
    await page.evaluate((key) => {
      const d = document.getElementById('d' + key);
      if (d) { d.open = false; return; }
      const el = document.getElementById('p' + key);
      if (el) el.style.display = 'none';
    }, k);
    await page.waitForTimeout(120);
  }

  expect(mancate, `forme che, una volta aperte, non fanno offrire la traduzione: ${mancate.join(' | ')}`).toEqual([]);
});

test('tradurre il testo scoperto non ripaga la pagina intera', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduci(page);
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  const primoGiro = await spedito(app);
  expect(primoGiro).toContain('visible paragraph');

  await page.evaluate(() => { document.getElementById('dA').open = true; });
  await page.waitForTimeout(150);
  const btn = await apriMenu(page, '#intro');
  await expect(btn).toHaveAttribute('aria-label', 'Traduci il testo nuovo');
  await btn.click();

  // SUCCESSO per l'utente: la sezione appena aperta è in italiano…
  await expect(page.locator('#pA')).toHaveText(/^IT /, { timeout: 30000 });
  // …e il paragrafo già tradotto NON è tornato al modello una seconda volta.
  const dopo = await spedito(app);
  const secondoGiro = dopo.slice(primoGiro.length);
  expect(secondoGiro).toContain(parola('A'));
  expect(secondoGiro, 'la pagina già tradotta è stata rispedita al modello').not.toContain('visible paragraph');
});
