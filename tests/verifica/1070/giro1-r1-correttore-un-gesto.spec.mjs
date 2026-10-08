// #1070 giro 1, rilievo 1: un solo gesto vero non deve pagare a una pagina decine di controlli del correttore.
// Lo script aspetta un clic qualunque e poi scrive nel campo parole sempre nuove con eventi `input` finti.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="font:20px sans-serif;padding:30px;margin:0">
<p id="p1">La fotosintesi clorofilliana trasforma la luce in energia chimica dentro le foglie.</p>
<textarea id="ta" style="display:block;width:640px;height:80px;font:20px monospace"></textarea>
</body>`;

async function fornitoreFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.EXPLAIN]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash',
        [C.ACTIONS.SPELLCHECK_WORD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__conti = { spiega: 0, scan: 0, parola: 0, altro: 0 };
    const finto = async ({ messages }) => {
      const t = JSON.stringify(messages);
      let tipo = 'altro';
      let text = 'ok';
      if (t.includes('ha selezionato un testo')) { tipo = 'spiega'; text = 'Spiegazione di prova'; }
      else if (t.includes('Analizza il testo qui sotto')) { tipo = 'scan'; text = '{"annotated":"","issues":[]}'; }
      else if (t.includes('col tasto destro su una parola')) { tipo = 'parola'; text = '{"misspelled":false,"correction":""}'; }
      globalThis.__conti[tipo] += 1;
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}
const conti = (app) => app.evaluate(() => ({ ...globalThis.__conti }));
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

test('r1 un clic vero paga al più un controllo del correttore, non uno per ogni input finto che segue', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await fornitoreFinto(app);
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  // Lo script aspetta un gesto qualunque e poi scrive parole sempre nuove nel campo.
  await page.evaluate(() => {
    window.addEventListener('mouseup', () => {
      const ta = document.getElementById('ta');
      ta.focus();
      for (let i = 0; i < 40; i++) {
        ta.value += ` xqzparola${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))} `;
        ta.selectionStart = ta.selectionEnd = ta.value.length;
        ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
      }
    }, { once: true });
  });
  await page.mouse.click(700, 20);
  await pausa(3000);
  const c = await conti(app);
  expect(c.parola).toBeLessThanOrEqual(1);
});
