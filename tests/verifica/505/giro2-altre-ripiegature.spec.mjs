// #505 giro 2 — le ripiegature che il giro 1 non aveva provato.
//
// Stessa domanda del giro 1: il sito sceglie COME ripiega una sezione, e da
// quella scelta non possono dipendere né cosa vede l'utente né quanto paga.
// Qui si provano i cassetti che escono di lato, il ritaglio con clip-path, e
// lo stesso identico menu a tendina chiuso messo in cima e in fondo alla
// pagina.

import { test, expect } from '../../fixtures/electron.mjs';

const parola = (k) => `ZQ${k}TOKEN`;
const frase = (k, d) => `Section ${parola(k)} hidden text about ${d} which nobody has opened yet.`;

const FORME = [
  ['L', 'cassetto fisso spinto fuori a destra con right negativo'],
  ['M', 'cassetto fisso spinto fuori a destra da una traslazione'],
  ['N', 'pannello ritagliato via con clip-path inset 100%'],
];

const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="titolo">Visible heading of the page</h1>
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>

  <div id="pL" style="position:fixed;top:0;right:-9999px;width:300px">${frase('L', FORME[0][1])}</div>
  <div id="pM" style="position:fixed;top:0;right:0;width:300px;transform:translateX(100%)">${frase('M', FORME[1][1])}</div>
  <div id="pN" style="clip-path:inset(100%)">${frase('N', FORME[2][1])}</div>
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
    globalThis.__filoTranslatePrompts = [];
    const origComplete = P.completeWithFallback;
    P.completeWithFallback = async (args) => {
      const { messages } = args;
      const last = [...messages].reverse().find((m) => typeof m.content === 'string');
      const prompt = (last && last.content) || '';
      if (prompt.indexOf('@@@SN_SEP@@@') < 0) return origComplete(args);
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

test('cassetti di lato e ritaglio: nessuno si paga da chiuso', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduci(page);

  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  const inviato = await spedito(app);
  const pagate = FORME.filter(([k]) => inviato.includes(parola(k))).map(([k, d]) => `${k} (${d})`);
  expect(pagate, `forme ripiegate spedite al modello e quindi pagate: ${pagate.join(', ')}`).toEqual([]);
});

test('aperte, quelle sezioni fanno offrire la traduzione del testo nuovo', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  await traduci(page);
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  await expect(await apriMenu(page, '#intro')).toHaveAttribute('aria-label', 'Mostra originale');
  await page.keyboard.press('Escape');

  const mancate = [];
  for (const [k, descr] of FORME) {
    await page.evaluate((key) => {
      const el = document.getElementById('p' + key);
      if (el) el.setAttribute('style', '');
    }, k);
    await page.waitForTimeout(150);
    const btn = await apriMenu(page, '#intro');
    const label = await btn.getAttribute('aria-label');
    if (label !== 'Traduci il testo nuovo') mancate.push(`${k} (${descr}) → "${label}"`);
    await page.keyboard.press('Escape');
    await page.evaluate((key) => {
      const el = document.getElementById('p' + key);
      if (el) el.style.display = 'none';
    }, k);
    await page.waitForTimeout(150);
  }
  expect(mancate, `forme che, una volta aperte, non fanno offrire la traduzione: ${mancate.join(' | ')}`).toEqual([]);
});

// Lo stesso identico menu a tendina chiuso, due volte nella stessa pagina: uno
// dentro la prima schermata, uno sotto. Se il conto cambia con la posizione,
// è di nuovo "stesso gesto, due conti".
const DUE_TENDINE = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>
  <div id="sopra" style="opacity:0">Menu ZQSOPRATOKEN entry that is closed and invisible near the top.</div>
  <div style="height:3000px">Filler.</div>
  <div id="sotto" style="opacity:0">Menu ZQSOTTOTOKEN entry that is closed and invisible near the bottom.</div>
</body></html>`;

test('la stessa tendina chiusa costa uguale in cima e in fondo alla pagina', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, DUE_TENDINE);
  await watchToasts(page);
  await traduci(page);
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  const inviato = await spedito(app);
  const sopra = inviato.includes('ZQSOPRATOKEN');
  const sotto = inviato.includes('ZQSOTTOTOKEN');
  expect(sotto, `la stessa tendina chiusa: in cima pagata=${sopra}, in fondo pagata=${sotto}`).toBe(sopra);
});
