// #505 giro 3 — sonda esplorativa: quali altre forme di ripiegatura si pagano.
import { test, expect } from '../../fixtures/electron.mjs';

const parola = (k) => `ZQ${k}TOKEN`;
const frase = (k, d) => `Section ${parola(k)} hidden text about ${d} which nobody has opened yet.`;

const FORME = [
  ['A', 'contenitore visibility:hidden con figlio visibility:visible (SI VEDE)'],
  ['B', 'cassetto in flusso traslato fuori da un contenitore che ritaglia'],
  ['C', 'clip rect legacy su posizionato assoluto'],
  ['D', 'filter opacity(0)'],
  ['E', 'dialog chiuso'],
  ['F', 'popover non aperto'],
  ['G', 'aria-expanded=false sul pannello'],
  ['H', 'contenitore overflow hidden h=0 statico con figlio assoluto (SI VEDE)'],
  ['I', 'scheda in secondo piano con height 0 e overflow auto'],
  ['J', 'pannello con transform scale(0.0000001)'],
  ['K', 'testo dentro un contenitore con content-visibility hidden'],
];

const PAGINA = `<!doctype html><html lang="en"><body style="font:16px sans-serif;padding:20px">
  <h1 id="titolo">Visible heading of the page</h1>
  <p id="intro">A visible paragraph that every reader sees without clicking anything at all.</p>

  <div style="visibility:hidden"><div id="pA" style="visibility:visible">${frase('A', 'a')}</div></div>
  <div style="overflow:hidden;width:300px;height:60px"><div id="pB" style="transform:translateX(-400px)">${frase('B', 'b')}</div></div>
  <div id="pC" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">${frase('C', 'c')}</div>
  <div id="pD" style="filter:opacity(0)">${frase('D', 'd')}</div>
  <dialog id="pE">${frase('E', 'e')}</dialog>
  <div id="pF" popover>${frase('F', 'f')}</div>
  <div id="pG" aria-expanded="false">${frase('G', 'g')}</div>
  <div style="overflow:hidden;height:0"><div id="pH" style="position:absolute;top:400px;left:20px">${frase('H', 'h')}</div></div>
  <div id="pI" style="height:0;overflow:auto">${frase('I', 'i')}</div>
  <div id="pJ" style="transform:scale(0.0000001)">${frase('J', 'j')}</div>
  <div style="content-visibility:hidden"><div id="pK">${frase('K', 'k')}</div></div>
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

test('sonda: quali forme si pagano', async ({ app, openTab, testServer }) => {
  await stubTranslationProvider(app);
  const page = await testServer.openReady(openTab, PAGINA);
  await watchToasts(page);
  const btn = await apriMenu(page, '#intro');
  await btn.click();
  await expect(page.locator('#intro')).toHaveText(/^IT /, { timeout: 30000 });
  await expect.poll(async () => (await toasts(page)).includes('Pagina tradotta'), { timeout: 30000 }).toBe(true);

  const inviato = await spedito(app);
  const righe = FORME.map(([k, d]) => `${k} ${inviato.includes(parola(k)) ? 'PAGATA ' : 'rimandata'} — ${d}`);
  console.log('\n===SONDA===\n' + righe.join('\n') + '\n===FINE===\n');
  expect(true).toBe(true);
});
