// #505 giro 3 — sonda esplorativa: quali altre forme di ripiegatura si pagano.
import { test, expect } from '../../fixtures/electron.mjs';

const parola = (k) => `ZQ${k}TOKEN`;
const frase = (k, d) => `Section ${parola(k)} hidden text about ${d} which nobody has opened yet.`;

const FORME = [
  ['A', 'pannello chiuso con la proprieta scale: 0'],
  ['B', 'pannello chiuso con la proprieta scale: 1 0'],
  ['C', 'cassetto in flusso chiuso con la proprieta translate: -200% 0'],
  ['D', 'etichetta girata con la proprieta rotate: 90deg (SI VEDE)'],
  ['E', 'pannello chiuso con transform: scale(1, 0) (gia coperto)'],
  ['F', 'testo normale di controllo'],
];

const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="titolo">Visible heading of the page</h1>
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>
  <div id="tanti"></div>
  <script>
    const c = document.getElementById('tanti');
    let h = '';
    for (let i = 0; i < 5; i++) h += '<div style="max-height:0;overflow:hidden"><p>Collapsed section number ' + i + ' with a sentence of English prose inside it that nobody opened.</p></div>';
    c.innerHTML = h;
  <\/script>
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
          if (n.nodeType === 1 && n.classList && n.classList.contains('sn-toast')) window.__toasts.push(n.textContent || '');
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

test('sonda: quanto costa aprire il menu con tante sezioni ripiegate', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  const btn = await apriMenu(page, '#intro');
  await btn.click();
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 60000 });
  await expect.poll(async () => (await toasts(page)).some((t) => /tradotta/.test(t)), { timeout: 60000 }).toBe(true);
  await page.keyboard.press('Escape');

  const tempi = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const b = await apriMenu(page, '#intro');
    tempi.push(Date.now() - t0);
    await b.getAttribute('aria-label');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  const avvisi = await toasts(page);
  console.log(['', '===SONDA===', 'avvisi: ' + JSON.stringify(avvisi), 'tempi apertura menu (ms): ' + tempi.join(', '), '===FINE===', ''].join('\n'));
  expect(true).toBe(true);
});
