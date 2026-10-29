import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { riquadroDelSegno, stileDelSegno } from '../../helpers/segniDelCorrettore.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
<main>
  <div class="chat">
    <p>Anna: ciao! ci vediamo martedì?</p>
    <p>Tu: sì, alle 18 davanti al cinema</p>
    <p>Anna: perfetto, porto io i biglietti</p>
  </div>
  <textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>
</main>
</body>`;

// `__ocraRisposta` è quello che il modello finto risponde al controllo ragionato, scritto come gli `issues` di una volta
// e tradotto qui nelle righe [pezzo][correzione][motivo][tipo]; il controllo rapido non trova mai niente.
async function apri(app, openTab, testServer, risposta, html = PAGINA) {
  await app.evaluate(async (_e, risposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
    });
    globalThis.__ocra = [];
    globalThis.__ocraRisposta = risposta;
    const righe = (json) => {
      let issues = [];
      try { issues = JSON.parse(json).issues || []; } catch (_) {}
      return issues.map((i) => (i.tipo === 'contraddizione'
        ? `[${i.testo}][${i.correzione || ''}][${i.spiegazione || ''}][contraddizione][${i.citazione || ''}]`
        : `[${i.testo}][${i.correzione || ''}][${i.spiegazione || ''}][suggerimento]`)).join('\n') || '[][][][nessuno]';
    };
    globalThis.__righeOcra = righe;
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      const fine = (text) => ({ text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} });
      if (t.includes('proponi SUGGERIMENTI')) {
        globalThis.__ocra.push(messages[messages.length - 1].content);
        return fine(righe(globalThis.__ocraRisposta));
      }
      return fine('[][][][nessuno]');
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, risposta);
  const page = await testServer.openReady(openTab, html, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}

const ocra = (page) => page.locator('.sn-spell-overlay .sn-suggerimento');

test('esplora: lo strato a riposo si ridisegna?', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const html = PAGINA
    .replace('<textarea id="ta" spellcheck="true" lang="it" style="display:block;width:760px;height:140px;font:22px monospace"></textarea>',
      '<div id="ce" contenteditable="true" style="width:760px;min-height:140px;border:1px solid #999;font:22px sans-serif"></div>')
    .replace('<main>', '<style>div div { color: #c00; border: 1px solid #c00; }</style><main>');
  const page = await apri(app, openTab, testServer, JSON.stringify({ issues: [
    { tipo: 'contraddizione', testo: 'mercoledì', citazione: 'ci vediamo martedì?', spiegazione: 'Prima si era detto martedì.', correzione: 'martedì' },
    { tipo: 'poco_chiara', testo: 'lui gli', citazione: '', spiegazione: 'Non si capisce chi porta cosa.', correzione: '' },
  ] }), html);
  await page.locator('#ce').click();
  await page.keyboard.type('ok!');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sì ci vediamo mercoledì');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('e lui gli porta');
  await expect(ocra(page)).toHaveText(['mercoledì', 'lui gli'], { timeout: 12_000 });
  const conti = await page.evaluate(async () => {
    const o = document.querySelector('.sn-spell-overlay');
    const misura = async (ms) => {
      let n = 0;
      const mo = new MutationObserver((l) => { n += l.length; });
      mo.observe(o, { childList: true, subtree: true });
      await new Promise((r) => setTimeout(r, ms));
      mo.disconnect();
      return n;
    };
    const subito = await misura(1500);
    const dopo = await misura(3000);
    let vuoti = 0, letture = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      const el = document.querySelector('.sn-spell-overlay div');
      const cs = getComputedStyle(el);
      letture++;
      if (cs.color !== 'rgba(0, 0, 0, 0)') vuoti++;
      await new Promise((r) => setTimeout(r, 5));
    }
    return { subito, dopo, letture, vuoti, colore: getComputedStyle(document.querySelector('.sn-spell-overlay div')).color };
  });
  console.log('CONTI', JSON.stringify(conti), 'chiamate', await app.evaluate(() => globalThis.__ocra.length));
});
